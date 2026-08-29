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

  function computeFitScale(page, targetCssWidth) {
    const unscaled = page.getViewport({ scale: 1 });
    return targetCssWidth / unscaled.width;
  }

  /**
   * Renders `pageNumber` (1-based) of `pdfDoc` onto `canvasEl` at the given
   * target CSS width and zoom percentage. Returns the CSS-pixel viewport,
   * which is what all screen<->PDF conversions below must use.
   */
  async function renderPage(pdfDoc, pageNumber, canvasEl, opts) {
    const { targetCssWidth, zoomPercent = 100 } = opts;
    const page = await pdfDoc.getPage(pageNumber);
    const fitScale = computeFitScale(page, targetCssWidth);
    const scale = fitScale * (zoomPercent / 100);
    const viewport = page.getViewport({ scale });

    const outputScale = window.devicePixelRatio || 1;
    canvasEl.width = Math.floor(viewport.width * outputScale);
    canvasEl.height = Math.floor(viewport.height * outputScale);
    canvasEl.style.width = Math.floor(viewport.width) + 'px';
    canvasEl.style.height = Math.floor(viewport.height) + 'px';

    const ctx = canvasEl.getContext('2d');
    const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
    await page.render({ canvasContext: ctx, transform, viewport }).promise;

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

  return { loadPdf, renderPage, computeFitScale, rectToScreen, screenToRect, screenPointToPdf };
})();
