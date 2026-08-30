/* Everything PDF — pdf.js loading, rendering, and PDF <-> screen coordinate math.
   The field-overlay layer must only ever use the CSS-pixel viewport returned
   here, never canvas.width/height (the device-pixel buffer). */
window.EPDF = window.EPDF || {};

EPDF.PdfRender = (function () {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  async function loadPdf(arrayBuffer) {
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    return loadingTask.promise;
  }

  function computeFitScale(page, targetCssWidth, rotation) {
    const unscaled = page.getViewport({ scale: 1, rotation });
    return targetCssWidth / unscaled.width;
  }

  /**
   * Renders `pageNumber` (1-based) of `pdfDoc` onto `canvasEl` at the given
   * target CSS width and zoom percentage. Returns the CSS-pixel viewport,
   * which is what all screen<->PDF conversions below must use.
   */
  function renderPage(pdfDoc, pageNumber, canvasEl, opts) {
    // pdf.js throws if a second render() starts on a canvas before the
    // previous one has fully settled. Concurrent callers (a fast zoom click,
    // or the reference panel toggle, each of which triggers a render) can
    // both pass that check before either has started painting, so the guard
    // has to serialize actual execution per canvas, not just cancel-in-place.
    const previous = canvasEl._epdfRenderQueue || Promise.resolve();
    const thisRender = previous.catch(() => {}).then(() =>
      doRenderPage(pdfDoc, pageNumber, canvasEl, opts)
    );
    canvasEl._epdfRenderQueue = thisRender;
    return thisRender;
  }

  async function doRenderPage(pdfDoc, pageNumber, canvasEl, opts) {
    const { targetCssWidth, zoomPercent = 100, rotation = 0 } = opts;
    const page = await pdfDoc.getPage(pageNumber);
    // `rotation` is the user's additional turn on top of whatever the page's
    // own embedded rotation already is — getViewport's `rotation` is
    // absolute, not additive, so the two have to be combined here.
    const effectiveRotation = ((page.rotate + rotation) % 360 + 360) % 360;
    const fitScale = computeFitScale(page, targetCssWidth, effectiveRotation);
    const scale = fitScale * (zoomPercent / 100);
    const viewport = page.getViewport({ scale, rotation: effectiveRotation });

    const outputScale = window.devicePixelRatio || 1;
    canvasEl.width = Math.floor(viewport.width * outputScale);
    canvasEl.height = Math.floor(viewport.height * outputScale);
    canvasEl.style.width = Math.floor(viewport.width) + 'px';
    canvasEl.style.height = Math.floor(viewport.height) + 'px';

    const ctx = canvasEl.getContext('2d');
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    // Our own field-overlay is the only UI for every field (hand-drawn or
    // detected), so suppress pdf.js's native annotation rendering — a real
    // AcroForm widget with a saved value has its own appearance stream,
    // which would otherwise get baked onto the canvas underneath our
    // overlay text and show as ghosted double-vision.
    await page.render({
      canvasContext: ctx,
      transform,
      viewport,
      annotationMode: pdfjsLib.AnnotationMode.DISABLE,
    }).promise;

    return { page, viewport };
  }

  /**
   * Converts a PDF-user-space rect {x,y,w,h} (bottom-left origin, y-up) into
   * a screen-space box {left,top,width,height} in CSS pixels (top-left
   * origin, y-down), using all four corners so rotated pages stay correct.
   */
  function rectToScreen(viewport, rect) {
    const corners = [
      [rect.x, rect.y],
      [rect.x + rect.w, rect.y],
      [rect.x, rect.y + rect.h],
      [rect.x + rect.w, rect.y + rect.h],
    ].map(([x, y]) => viewport.convertToViewportPoint(x, y));

    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  /**
   * Converts a screen-space box {left,top,width,height} in CSS pixels back
   * into a PDF-user-space rect {x,y,w,h}, using all four corners.
   */
  function screenToRect(viewport, box) {
    const corners = [
      [box.left, box.top],
      [box.left + box.width, box.top],
      [box.left, box.top + box.height],
      [box.left + box.width, box.top + box.height],
    ].map(([sx, sy]) => viewport.convertToPdfPoint(sx, sy));

    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  /** A single CSS point -> PDF point conversion, for gesture-delta math. */
  function screenPointToPdf(viewport, sx, sy) {
    const [x, y] = viewport.convertToPdfPoint(sx, sy);
    return { x, y };
  }

  /** The reverse of screenPointToPdf — a single PDF point -> CSS point. */
  function pdfPointToScreen(viewport, x, y) {
    const [sx, sy] = viewport.convertToViewportPoint(x, y);
    return { x: sx, y: sy };
  }

  /**
   * Maps one pdf.js widget annotation to a partial field-model object
   * ({page, rect, name, type, value}), or null if it isn't a data field
   * we can represent (e.g. a plain push button). The annotation's raw
   * .rect is already in the same native/unrotated PDF-space rectToScreen
   * expects — verified empirically against a rotated test PDF — so no
   * transform is needed here beyond normalizing the two corners.
   */
  function mapAnnotationToField(annotation, pageNumber) {
    const [x1, y1, x2, y2] = annotation.rect;
    const rect = {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
    if (rect.w <= 0 || rect.h <= 0) return null;

    let type;
    let value = '';
    if (annotation.fieldType === 'Tx') {
      type = 'text';
      value = annotation.fieldValue || '';
    } else if (annotation.fieldType === 'Btn' && (annotation.checkBox || annotation.radioButton)) {
      // Radio buttons have no group concept in our model yet — imported as
      // independent checkboxes, a disclosed simplification.
      type = 'checkbox';
      value = annotation.fieldValue && annotation.fieldValue !== 'Off' ? 'true' : '';
    } else if (annotation.fieldType === 'Btn') {
      return null; // plain push button, not a data field
    } else if (annotation.fieldType === 'Ch') {
      // No dropdown/select type yet — import the current value as text.
      type = 'text';
      value = Array.isArray(annotation.fieldValue) ? (annotation.fieldValue[0] || '') : (annotation.fieldValue || '');
    } else {
      return null; // includes 'Sig' — signature fields aren't a supported type
    }

    return { page: pageNumber, rect, name: annotation.fieldName || 'Field', type, value };
  }

  /** Scans every page of pdfDoc for real, already-embedded AcroForm widget
   *  fields and returns them as partial field-model objects ready for
   *  store.add(). Returns [] for a PDF with no such fields — this only
   *  detects fields that genuinely exist, never guesses from blank space. */
  async function detectFormFields(pdfDoc) {
    const fields = [];
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const annotations = await page.getAnnotations({ intent: 'display' });
      annotations
        .filter((a) => a.subtype === 'Widget' && a.fieldType)
        .forEach((a) => {
          const field = mapAnnotationToField(a, p);
          if (field) fields.push(field);
        });
    }
    return fields;
  }

  /**
   * Renders `pageNumber` of a standalone PDF (given as raw bytes, not an
   * already-open pdfDoc) to a small PNG data URL, for template-card
   * thumbnails. Uses its own offscreen canvas — never the shared
   * page-canvas — so it can't collide with the main render queue above.
   */
  async function renderThumbnail(bytes, pageNumber, targetWidth) {
    const pdfDoc = await loadPdf(bytes);
    try {
      const page = await pdfDoc.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = targetWidth / unscaled.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({
        canvasContext: ctx,
        viewport,
        annotationMode: pdfjsLib.AnnotationMode.DISABLE,
      }).promise;
      return canvas.toDataURL('image/png');
    } finally {
      pdfDoc.destroy();
    }
  }

  return {
    loadPdf, renderPage, computeFitScale, rectToScreen, screenToRect, screenPointToPdf, pdfPointToScreen,
    detectFormFields, renderThumbnail,
  };
})();
