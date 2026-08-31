/* Everything PDF — app wiring: DOM refs, file loading, toolbar/export sheet.
   The only file that touches `document` at top level (DOMContentLoaded). */
window.EPDF = window.EPDF || {};

(function () {
  const FieldModel = EPDF.FieldModel;
  const PdfRender = EPDF.PdfRender;
  const CanvasEditor = EPDF.CanvasEditor;
  const Annotations = EPDF.Annotations;
  const AnnotationEditor = EPDF.AnnotationEditor;

  const DRAW_COLORS = ['#e02020', '#e0791f', '#e0c020', '#1a9c50', '#2563eb', '#1c1d1a'];

  const $ = (sel) => document.querySelector(sel);
  const els = {};

  const ZOOM_MIN = 40;
  const ZOOM_MAX = 200;
  const ZOOM_STORAGE_KEY = 'epdf-zoom';

  function loadSavedZoom() {
    try {
      const val = parseInt(localStorage.getItem(ZOOM_STORAGE_KEY), 10);
      if (Number.isFinite(val)) return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, val));
    } catch (err) { /* localStorage unavailable (e.g. private browsing) — fall through to default */ }
    return 100;
  }

  function saveZoom(percent) {
    try { localStorage.setItem(ZOOM_STORAGE_KEY, String(percent)); } catch (err) { /* ignore */ }
  }

  const state = {
    view: 'dashboard',     // 'dashboard' | 'editor'
    pdfDoc: null,
    pageNumber: 1,
    zoomPercent: loadSavedZoom(),
    viewport: null,
    store: null,
    editor: null,
    annotationStore: null,
    annotationEditor: null,
    pageRotations: {},     // { [pageNumber]: additional user-applied rotation (0/90/180/270) }, on top of the page's own
    originalBytes: null,   // pristine ArrayBuffer of the loaded PDF, for pdf-lib export
    originalFileName: '',
    exportMode: 'flatten', // 'flatten' | 'editable'
    referencePhotoUrl: null, // object URL of the currently loaded reference photo, or null
    refView: { scale: 1, rotation: 0, tx: 0, ty: 0 },
    currentTemplateId: null, // id of the saved template this session came from, or null (one-off edit)
    pendingConfirmAction: null, // fn to run if the shared confirm-sheet's Confirm button is clicked, or null
    cropCtx: null,           // { fieldId, dispW, dispH, box } while the crop editor sheet is open
  };

  const PAPER_SIZES = [
    { name: 'Letter', w: 8.5, h: 11 },
    { name: 'Legal', w: 8.5, h: 14 },
    { name: 'A4', w: 8.27, h: 11.69 },
  ];

  function paperSizeLabel(widthPt, heightPt) {
    const wIn = widthPt / 72, hIn = heightPt / 72;
    for (const size of PAPER_SIZES) {
      const matchesPortrait = Math.abs(wIn - size.w) < 0.08 && Math.abs(hIn - size.h) < 0.08;
      const matchesLandscape = Math.abs(wIn - size.h) < 0.08 && Math.abs(hIn - size.w) < 0.08;
      if (matchesPortrait || matchesLandscape) {
        return `${size.name} · ${wIn.toFixed(1)} × ${hIn.toFixed(1)} in`;
      }
    }
    return `${wIn.toFixed(1)} × ${hIn.toFixed(1)} in`;
  }

  function cacheEls() {
    [
      'dashboard-view', 'dash-empty', 'template-grid', 'new-template-btn',
      'resume-banner', 'resume-sub', 'resume-btn', 'resume-discard-btn',
      'toolbar', 'split',
      'stage', 'dropzone', 'browse-btn', 'file-input',
      'pages-panel', 'pages-list',
      'page-wrap', 'page-canvas', 'draw-canvas', 'field-overlay', 'pagebar', 'page-info', 'paper-size',
      'page-prev', 'page-next',
      'zoom-out', 'zoom-in', 'zoom-pct', 'rotate-btn', 'duplicate-page-btn', 'delete-page-btn',
      'docname', 'docname-title', 'doc-sep', 'autosave', 'templates-btn',
      'theme-toggle', 'fullscreen-btn', 'print-btn', 'save-template-btn', 'reference-btn', 'export-btn',
      'tool-select', 'tool-text', 'tool-checkbox', 'tool-image', 'tool-draw', 'undo-btn',
      'image-file-input',
      'field-count-meta',
      'draw-toolbar', 'draw-shape-seg', 'draw-colors', 'draw-hint', 'draw-delete-btn', 'draw-clear-btn',
      'field-toolbar', 'fontsize-group', 'fontsize-dec', 'fontsize-inc', 'fontsize-value', 'fontsize-auto',
      'checkbox-greyout-btn',
      'export-scrim', 'export-sheet', 'export-title', 'export-field-count',
      'export-filename', 'export-mode-flatten', 'export-mode-editable',
      'export-summary', 'export-cancel', 'export-confirm',
      'ref-panel', 'ref-replace-btn', 'ref-popout-btn', 'ref-close-btn',
      'ref-photo', 'ref-photo-placeholder', 'ref-photo-img', 'ref-zoomctl',
      'ref-zoom-out', 'ref-zoom-in', 'ref-rotate', 'ref-fit',
      'ref-scratch', 'ref-copy-btn', 'ref-file-input',
      'template-name-scrim', 'template-name-sheet', 'template-name-input',
      'template-name-cancel', 'template-name-confirm',
      'confirm-scrim', 'confirm-sheet', 'confirm-title', 'confirm-message', 'confirm-cancel', 'confirm-ok',
      'crop-scrim', 'crop-sheet', 'crop-stage', 'crop-image', 'crop-box', 'crop-cancel', 'crop-apply',
    ].forEach((id) => { els[toCamel(id)] = document.getElementById(id); });
  }

  function toCamel(id) {
    return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  // ── file loading ────────────────────────────────────────────────

  function updateAutosaveDefault() {
    els.autosave.innerHTML = state.currentTemplateId
      ? '<i class="ph ph-bookmark-simple-fill"></i>From a saved template'
      : '<i class="ph ph-info"></i>Not saved as a template yet';
  }

  function flashAutosave(html) {
    els.autosave.innerHTML = html;
    setTimeout(updateAutosaveDefault, 2500);
  }

  // Shared by a fresh upload (loadFile) and reopening a saved template
  // (openTemplate) — the only difference is where the bytes/fields come
  // from. presetFields, when given, skips AcroForm auto-detection and
  // replays the template's saved field layout instead (values blanked,
  // unless opts.preserveValues is set — used when resuming an autosaved
  // session, where the real in-progress values matter).
  async function loadPdfIntoEditor(buffer, fileName, presetFields, opts) {
    opts = opts || {};
    // pdf.js may transfer/detach the buffer it's given, so hand it a copy
    // and keep the pristine original for pdf-lib at export time.
    state.originalBytes = buffer.slice(0);
    state.originalFileName = fileName;
    const pdfDoc = await PdfRender.loadPdf(buffer);
    state.pdfDoc = pdfDoc;
    state.pageNumber = opts.pageNumber || 1;
    state.zoomPercent = loadSavedZoom();
    state.pageRotations = opts.pageRotations || {};
    state.store = FieldModel.createStore();
    state.store.subscribe(() => { updateFieldCountMeta(); updateUndoButton(); updateFieldToolbar(); scheduleAutosave(); });
    state.annotationStore = Annotations.createStore();
    state.annotationStore.subscribe(() => { updateUndoButton(); updateDrawDeleteButton(); scheduleAutosave(); });

    let detectedCount = 0;
    if (presetFields) {
      presetFields.forEach((f) => state.store.add({
        page: f.page, rect: f.rect, name: f.name, type: f.type,
        // Image fields aren't a fillable value like text — the image itself
        // is the (always-present) content, so it always counts as "filled".
        value: f.type === 'image' ? '1' : (opts.preserveValues ? (f.value || '') : ''),
        options: f.options,
        src: f.src, crop: f.crop, naturalW: f.naturalW, naturalH: f.naturalH, lockAspect: f.lockAspect,
        fontSize: f.fontSize, disabled: f.disabled,
      }));
    } else {
      // Auto-import any real, already-embedded AcroForm fields so the user
      // can click and type immediately instead of drawing every field by
      // hand. Detected fields behave identically to hand-drawn ones from
      // here on — same model, same validation, same rendering.
      const detected = await PdfRender.detectFormFields(pdfDoc);
      detected.forEach((f) => state.store.add(f));
      detectedCount = detected.length;
    }
    state.store.select(null);
    if (opts.annotations) opts.annotations.forEach((a) => state.annotationStore.add({ ...a }));
    // Detected/preset/restored fields and annotations all go through
    // add(), which pushes undo history same as a user action — but the
    // user hasn't done anything yet at this point, so start clean.
    state.store.clearUndoHistory();
    state.annotationStore.clearUndoHistory();

    showEditor();
    els.docname.hidden = false;
    els.docSep.hidden = false;
    els.docnameTitle.textContent = state.originalFileName;
    els.templatesBtn.hidden = false;
    els.autosave.hidden = false;
    updateAutosaveDefault();
    if (detectedCount) {
      flashAutosave(`<i class="ph ph-magic-wand"></i>Detected ${detectedCount} existing field${detectedCount === 1 ? '' : 's'}`);
    }

    if (state.editor) state.editor.destroy();
    els.fieldOverlay.innerHTML = '';
    state.editor = CanvasEditor.create({
      overlayEl: els.fieldOverlay,
      store: state.store,
      getViewport: () => state.viewport,
      getPageNumber: () => state.pageNumber,
      onCropRequest: openCropEditor,
      onImagePlaced: () => setTool('select'),
    });

    if (state.annotationEditor) state.annotationEditor.destroy();
    state.annotationEditor = AnnotationEditor.create({
      canvasEl: els.drawCanvas,
      store: state.annotationStore,
      getViewport: () => state.viewport,
      getPageNumber: () => state.pageNumber,
    });
    state.annotationEditor.setColor(DRAW_COLORS[0]);

    setTool('select');

    // Only reveal the stage (and let the editor's pointer listeners see
    // real events) once the first render has actually committed a
    // viewport — otherwise a fast click-drag on a still-loading PDF could
    // start a gesture with no viewport to convert coordinates against.
    await rerenderPage();
    els.pageWrap.hidden = false;
    els.pagebar.hidden = false;
    els.exportBtn.disabled = false;
    els.exportBtn.title = '';
    els.referenceBtn.disabled = false;
    els.referenceBtn.title = '';
    els.saveTemplateBtn.disabled = false;
    els.saveTemplateBtn.title = '';
    els.printBtn.disabled = false;
    els.printBtn.title = '';
    els.fullscreenBtn.disabled = false;
    els.fullscreenBtn.title = '';
    updateFieldCountMeta();
    updateUndoButton();
    updateDrawDeleteButton();
    updateFieldToolbar();
    renderPagesPanel();
  }

  async function loadFile(file) {
    const buffer = await file.arrayBuffer();
    state.currentTemplateId = null;
    await EPDF.TemplatesDb.clearSession().catch((err) => console.error(err)); // starting fresh — any stale resumable session no longer applies
    await loadPdfIntoEditor(buffer, file.name.replace(/\.pdf$/i, ''), null);
  }

  async function rerenderPage() {
    // Cleared up front, not just reassigned once the render resolves: while
    // this await is in flight, state.viewport would otherwise still point
    // at the *previous* page's viewport, so a gesture that starts in that
    // window (e.g. a fast keyboard PageDown immediately followed by a drag)
    // would silently compute coordinates against the wrong page. Every
    // gesture start already bails out when getViewport() is falsy — this
    // just makes that guard actually cover the gap.
    state.viewport = null;
    const rotation = state.pageRotations[state.pageNumber] || 0;
    const targetCssWidth = Math.max(200, Math.min(620, els.stage.clientWidth - 40));
    const { page, viewport } = await PdfRender.renderPage(state.pdfDoc, state.pageNumber, els.pageCanvas, {
      targetCssWidth,
      zoomPercent: state.zoomPercent,
      rotation,
    });
    state.viewport = viewport;
    els.pageWrap.style.width = Math.floor(viewport.width) + 'px';
    els.pageWrap.style.height = Math.floor(viewport.height) + 'px';

    els.pageInfo.textContent = `Page ${state.pageNumber} of ${state.pdfDoc.numPages}`;
    const unscaled = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
    els.paperSize.textContent = paperSizeLabel(unscaled.width, unscaled.height);
    els.zoomPct.textContent = state.zoomPercent + '%';

    if (state.editor) state.editor.layout();
    if (state.annotationEditor) state.annotationEditor.layout();
    updatePageNavButtons();
    updatePagesPanelActive();
    updateFieldCountMeta();
  }

  function rotatePage() {
    const current = state.pageRotations[state.pageNumber] || 0;
    state.pageRotations[state.pageNumber] = (current + 90) % 360;
    rerenderPage();
    scheduleAutosave();
  }

  // ── duplicate / delete page ───────────────────────────────────────
  // Both actually rewrite the underlying PDF via pdf-lib (see pdf-pages.js)
  // and reload it through pdf.js, then remap every page-indexed piece of
  // state (field/annotation `page`, pageRotations keys, state.pageNumber)
  // to match. Deliberately not routed through the field/annotation undo
  // stacks — like rotation, this changes the document's page count itself,
  // which the per-edit Undo button has no way to reverse — deletion goes
  // through a confirmation dialog instead.

  function shiftRotationsForDuplicate(rotations, page) {
    const shifted = {};
    Object.keys(rotations).forEach((key) => {
      const n = Number(key);
      shifted[n > page ? n + 1 : n] = rotations[key];
    });
    if (rotations[page]) shifted[page + 1] = rotations[page]; // the copy inherits the original's rotation
    return shifted;
  }

  function shiftRotationsForRemove(rotations, page) {
    const shifted = {};
    Object.keys(rotations).forEach((key) => {
      const n = Number(key);
      if (n === page) return;
      shifted[n > page ? n - 1 : n] = rotations[key];
    });
    return shifted;
  }

  async function duplicatePage(pageNum) {
    if (!state.pdfDoc || !state.originalBytes) return;
    const newBytes = await EPDF.PdfPages.duplicatePage(state.originalBytes, pageNum);
    state.originalBytes = newBytes;
    state.pdfDoc = await PdfRender.loadPdf(newBytes.slice(0));
    state.pageRotations = shiftRotationsForDuplicate(state.pageRotations, pageNum);
    state.store.duplicatePage(pageNum);
    state.annotationStore.duplicatePage(pageNum);
    // A page-structure change invalidates any undo entry recorded before
    // it — restoring one would silently revert this page shift (via the
    // store's own undo(), which restores its whole snapshot) while the
    // actual PDF stays duplicated, desyncing every field/shape's page from
    // the document. Clear both stacks rather than risk that.
    state.store.clearUndoHistory();
    state.annotationStore.clearUndoHistory();
    updateUndoButton();
    state.pageNumber = pageNum + 1; // jump to the new copy
    await rerenderPage();
    renderPagesPanel();
    scheduleAutosave();
  }

  async function deletePage(pageNum) {
    if (!state.pdfDoc || !state.originalBytes || state.pdfDoc.numPages <= 1) return;
    const newBytes = await EPDF.PdfPages.removePage(state.originalBytes, pageNum);
    state.originalBytes = newBytes;
    state.pdfDoc = await PdfRender.loadPdf(newBytes.slice(0));
    state.pageRotations = shiftRotationsForRemove(state.pageRotations, pageNum);
    state.store.removePage(pageNum);
    state.annotationStore.removePage(pageNum);
    // See duplicatePage()'s comment above — same desync risk applies here.
    state.store.clearUndoHistory();
    state.annotationStore.clearUndoHistory();
    updateUndoButton();
    state.pageNumber = Math.min(pageNum, state.pdfDoc.numPages);
    await rerenderPage();
    renderPagesPanel();
    scheduleAutosave();
  }

  function confirmDeletePage(pageNum) {
    if (!state.pdfDoc || state.pdfDoc.numPages <= 1) return;
    openConfirm('Delete page?', `Page ${pageNum} and everything on it will be deleted. This can't be undone.`, () => deletePage(pageNum));
  }

  // ── page navigator (prev/next + left-side thumbnail sidebar) ──────

  function goToPage(n) {
    if (!state.pdfDoc) return;
    const target = Math.max(1, Math.min(state.pdfDoc.numPages, n));
    if (target === state.pageNumber) return;
    state.pageNumber = target;
    rerenderPage();
    scheduleAutosave();
  }

  function updatePageNavButtons() {
    if (!state.pdfDoc) return;
    els.pagePrev.disabled = state.pageNumber <= 1;
    els.pageNext.disabled = state.pageNumber >= state.pdfDoc.numPages;
    // A PDF always needs at least one page — refuse to delete the last one.
    els.deletePageBtn.disabled = state.pdfDoc.numPages <= 1;
  }

  function updatePagesPanelActive() {
    els.pagesList.querySelectorAll('.page-item').forEach((item) => {
      item.classList.toggle('on', Number(item.dataset.page) === state.pageNumber);
    });
  }

  // Rebuilds the sidebar's page list for the just-loaded document, then
  // fills in each thumbnail asynchronously (rendering is cheap per page,
  // but doing all of them synchronously would delay the first paint).
  async function renderPagesPanel() {
    const numPages = state.pdfDoc.numPages;
    els.pagesPanel.hidden = numPages <= 1;
    els.pagesList.innerHTML = '';
    if (numPages <= 1) return;

    const pdfDoc = state.pdfDoc;
    for (let p = 1; p <= numPages; p++) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'page-item';
      item.dataset.page = String(p);
      item.setAttribute('aria-label', `Go to page ${p}`);
      item.innerHTML = `
        <span class="thumb"><i class="ph ph-file-pdf" aria-hidden="true"></i></span>
        <span class="label">${p}</span>`;
      els.pagesList.appendChild(item);
    }
    updatePagesPanelActive();

    for (let p = 1; p <= numPages; p++) {
      if (state.pdfDoc !== pdfDoc) return; // a different PDF loaded while thumbnails were still rendering
      try {
        const dataUrl = await PdfRender.renderPageThumbnail(pdfDoc, p, 220);
        if (state.pdfDoc !== pdfDoc) return;
        const item = els.pagesList.querySelector(`.page-item[data-page="${p}"]`);
        if (item) item.querySelector('.thumb').innerHTML = `<img src="${dataUrl}" alt="" />`;
      } catch (err) {
        console.error(err);
      }
    }
  }

  function wirePageNav() {
    els.pagePrev.addEventListener('click', () => goToPage(state.pageNumber - 1));
    els.pageNext.addEventListener('click', () => goToPage(state.pageNumber + 1));
    els.pagesList.addEventListener('click', (e) => {
      const item = e.target.closest('.page-item');
      if (item) goToPage(Number(item.dataset.page));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
      if (!state.pdfDoc) return;
      const active = document.activeElement;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable);
      if (typing) return;
      if (!els.exportSheet.hidden || !els.templateNameSheet.hidden || !els.confirmSheet.hidden) return;
      e.preventDefault();
      goToPage(state.pageNumber + (e.key === 'PageDown' ? 1 : -1));
    });
  }

  // ── autosave / resume-in-progress-work ───────────────────────────

  let autosaveTimer = null;

  function scheduleAutosave() {
    if (!state.pdfDoc) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(saveSessionNow, 800);
  }

  async function saveSessionNow() {
    if (!state.pdfDoc || !state.originalBytes) return;
    try {
      await EPDF.TemplatesDb.saveSession({
        originalBytes: state.originalBytes,
        originalFileName: state.originalFileName,
        currentTemplateId: state.currentTemplateId,
        pageNumber: state.pageNumber,
        pageRotations: state.pageRotations,
        fields: state.store ? state.store.list() : [],
        annotations: state.annotationStore ? state.annotationStore.list() : [],
      });
    } catch (err) {
      console.error(err);
    }
  }

  function timeAgo(ts) {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.floor(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }

  async function checkResumableSession() {
    try {
      const session = await EPDF.TemplatesDb.loadSession();
      els.resumeBanner.hidden = !session;
      if (session) {
        els.resumeSub.textContent = `${session.originalFileName || 'Untitled'} — ${timeAgo(session.updatedAt)}`;
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function resumeSession() {
    const session = await EPDF.TemplatesDb.loadSession();
    if (!session) return;
    state.currentTemplateId = session.currentTemplateId || null;
    await loadPdfIntoEditor(session.originalBytes.slice(0), session.originalFileName, session.fields, {
      preserveValues: true,
      annotations: session.annotations,
      pageRotations: session.pageRotations || {},
      pageNumber: session.pageNumber,
    });
    els.resumeBanner.hidden = true;
  }

  async function discardSession() {
    await EPDF.TemplatesDb.clearSession();
    els.resumeBanner.hidden = true;
  }

  // ── toolbar ─────────────────────────────────────────────────────

  function setTool(tool) {
    // 'draw' is handled entirely by the annotation editor on its own canvas
    // layer — canvas-editor only ever sees 'select'/'draw-text'/'draw-checkbox',
    // so it's told 'select' whenever draw mode is active (keeps its own
    // gestures idle without needing it to know that tool exists).
    if (state.editor) state.editor.setTool(tool === 'draw' ? 'select' : tool);
    els.toolSelect.classList.toggle('on', tool === 'select');
    els.toolText.classList.toggle('on', tool === 'draw-text');
    els.toolCheckbox.classList.toggle('on', tool === 'draw-checkbox');
    els.toolImage.classList.toggle('on', tool === 'place-image');
    els.toolDraw.classList.toggle('on', tool === 'draw');
    els.fieldOverlay.classList.toggle('tool-draw', tool === 'draw');
    els.drawToolbar.hidden = tool !== 'draw';
    if (state.annotationEditor) state.annotationEditor.setActive(tool === 'draw');
    updateFieldToolbar();
  }

  // ── draw tool (freehand/shape annotations) ──────────────────────

  function wireDrawToolbar() {
    els.toolDraw.addEventListener('click', () => setTool('draw'));

    els.drawShapeSeg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-shape]');
      if (!btn) return;
      const shape = btn.dataset.shape;
      els.drawShapeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      if (state.annotationEditor) state.annotationEditor.setShape(shape);
      const hints = {
        select: 'Click a drawing to select it — drag to move, Delete to remove',
        freehand: 'Drag on the page to draw',
        line: 'Drag to draw a straight line',
        arrow: 'Drag to draw an arrow',
        rect: 'Drag to draw a box',
        ellipse: 'Drag to draw a circle',
        text: 'Click on the page to place a text label',
      };
      els.drawHint.textContent = hints[shape] || '';
    });

    DRAW_COLORS.forEach((color, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.background = color;
      b.className = i === 0 ? 'on' : '';
      b.setAttribute('aria-label', 'Drawing color');
      b.addEventListener('click', () => {
        els.drawColors.querySelectorAll('button').forEach((btn) => btn.classList.toggle('on', btn === b));
        if (state.annotationEditor) state.annotationEditor.setColor(color);
      });
      els.drawColors.appendChild(b);
    });

    els.drawDeleteBtn.addEventListener('click', () => {
      if (!state.annotationStore) return;
      const selected = state.annotationStore.getSelected();
      if (selected) state.annotationStore.remove(selected.id);
    });

    els.drawClearBtn.addEventListener('click', () => {
      if (!state.annotationStore) return;
      state.annotationStore.clear(state.pageNumber);
    });
  }

  function updateDrawDeleteButton() {
    const selected = state.annotationStore && state.annotationStore.getSelected();
    els.drawDeleteBtn.disabled = !selected;
  }

  // ── field sub-toolbar (font size for text-like fields, grey-out for
  // checkbox/radio) — shown while a compatible field is selected with the
  // Select tool. Image fields have their own inline controls already (see
  // canvas-editor.js's .img-controls), so they don't get a row here. ──

  const FIELD_FONT_SIZE_STEP = 1;
  const DEFAULT_FIELD_FONT_SIZE = 10; // pt — mirrors canvas-editor.js's own default

  function wireFieldToolbar() {
    els.fontsizeDec.addEventListener('click', () => {
      const selected = state.store && state.store.getSelected();
      if (!selected) return;
      const current = selected.fontSize || DEFAULT_FIELD_FONT_SIZE;
      state.store.update(selected.id, { fontSize: current - FIELD_FONT_SIZE_STEP });
    });
    els.fontsizeInc.addEventListener('click', () => {
      const selected = state.store && state.store.getSelected();
      if (!selected) return;
      const current = selected.fontSize || DEFAULT_FIELD_FONT_SIZE;
      state.store.update(selected.id, { fontSize: current + FIELD_FONT_SIZE_STEP });
    });
    els.fontsizeAuto.addEventListener('click', () => {
      const selected = state.store && state.store.getSelected();
      if (!selected) return;
      state.store.update(selected.id, { fontSize: null });
    });
    els.checkboxGreyoutBtn.addEventListener('click', () => {
      const selected = state.store && state.store.getSelected();
      if (!selected) return;
      state.store.update(selected.id, { disabled: !selected.disabled });
    });
  }

  function updateFieldToolbar() {
    const selected = state.store && state.store.getSelected();
    const tool = state.editor ? state.editor.getTool() : 'select';
    const eligible = !!(selected && tool === 'select' && selected.type !== 'image');
    els.fieldToolbar.hidden = !eligible;
    if (!eligible) return;

    const isTextLike = FieldModel.TEXT_LIKE_TYPES.includes(selected.type);
    const isCheckbox = selected.type === 'checkbox';
    els.fontsizeGroup.hidden = !isTextLike;
    els.checkboxGreyoutBtn.hidden = !isCheckbox;
    if (!isTextLike && !isCheckbox) { els.fieldToolbar.hidden = true; return; } // e.g. radio — nothing to show

    if (isTextLike) {
      const size = selected.fontSize || DEFAULT_FIELD_FONT_SIZE;
      els.fontsizeValue.textContent = size + ' pt';
      els.fontsizeAuto.classList.toggle('active', !selected.fontSize);
      els.fontsizeDec.disabled = size <= FieldModel.MIN_FONT_SIZE;
      els.fontsizeInc.disabled = size >= FieldModel.MAX_FONT_SIZE;
    } else {
      els.checkboxGreyoutBtn.classList.toggle('active', !!selected.disabled);
      els.checkboxGreyoutBtn.innerHTML = selected.disabled
        ? '<i class="ph ph-eye"></i>Un-grey'
        : '<i class="ph ph-eye-slash"></i>Grey out';
    }
  }

  // ── image tool (toolbar file-pick + drag-and-drop placement) ─────

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const src = reader.result;
        const img = new Image();
        img.onload = () => resolve({ src, naturalW: img.naturalWidth, naturalH: img.naturalHeight });
        img.onerror = () => reject(new Error('Could not read that image'));
        img.src = src;
      };
      reader.readAsDataURL(file);
    });
  }

  function wireImageTool() {
    els.toolImage.addEventListener('click', () => {
      els.imageFileInput.value = '';
      els.imageFileInput.click();
    });
    els.imageFileInput.addEventListener('change', async () => {
      const file = els.imageFileInput.files[0];
      if (!file) return;
      try {
        const imgData = await readImageFile(file);
        if (!state.editor) return;
        state.editor.setPendingImage(imgData);
        setTool('place-image');
      } catch (err) {
        console.error(err);
      }
    });

    // A drop anywhere on the stage places the image immediately, at the
    // drop point, regardless of whatever tool was previously active — the
    // toolbar button above is the click-to-place alternative for anyone not
    // dragging a file in from their OS.
    ['dragenter', 'dragover'].forEach((evt) => {
      els.stage.addEventListener(evt, (e) => {
        if (!state.pdfDoc) return;
        if (!Array.from(e.dataTransfer.types || []).includes('Files')) return;
        e.preventDefault();
        els.stage.classList.add('image-dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      els.stage.addEventListener(evt, (e) => {
        e.preventDefault();
        els.stage.classList.remove('image-dragover');
      });
    });
    els.stage.addEventListener('drop', async (e) => {
      if (!state.pdfDoc || !state.editor || !state.viewport) return;
      const file = Array.from(e.dataTransfer.files || []).find((f) => f.type.startsWith('image/'));
      if (!file) return;
      try {
        const imgData = await readImageFile(file);
        const wrapRect = els.pageWrap.getBoundingClientRect();
        const point = {
          x: Math.max(0, Math.min(wrapRect.width, e.clientX - wrapRect.left)),
          y: Math.max(0, Math.min(wrapRect.height, e.clientY - wrapRect.top)),
        };
        state.editor.placeImage(imgData, point);
        setTool('select');
      } catch (err) {
        console.error(err);
      }
    });
  }

  // ── crop editor sheet (drag/resize a crop box over the full image) ──

  const CROP_STAGE_MAX = 420; // px — longer edge of the crop stage
  const CROP_MIN_PX = 24;     // px — smallest crop box the stage allows

  function renderCropBox() {
    const { box } = state.cropCtx;
    els.cropBox.style.left = box.x + 'px';
    els.cropBox.style.top = box.y + 'px';
    els.cropBox.style.width = box.w + 'px';
    els.cropBox.style.height = box.h + 'px';
  }

  function openCropEditor(fieldId) {
    const field = state.store && state.store.get(fieldId);
    if (!field || field.type !== 'image' || !field.src) return;
    const naturalW = field.naturalW || 1;
    const naturalH = field.naturalH || 1;
    let dispW = CROP_STAGE_MAX;
    let dispH = CROP_STAGE_MAX;
    if (naturalW >= naturalH) dispH = Math.round(CROP_STAGE_MAX * naturalH / naturalW);
    else dispW = Math.round(CROP_STAGE_MAX * naturalW / naturalH);

    els.cropStage.style.width = dispW + 'px';
    els.cropStage.style.height = dispH + 'px';
    els.cropImage.src = field.src;

    const crop = field.crop || { x: 0, y: 0, w: 1, h: 1 };
    state.cropCtx = {
      fieldId, dispW, dispH,
      box: { x: crop.x * dispW, y: crop.y * dispH, w: crop.w * dispW, h: crop.h * dispH },
    };
    renderCropBox();
    els.cropScrim.hidden = false;
    els.cropSheet.hidden = false;
  }

  function closeCropEditor() {
    state.cropCtx = null;
    els.cropScrim.hidden = true;
    els.cropSheet.hidden = true;
  }

  function clampCropBox(box, dispW, dispH) {
    let { x, y, w, h } = box;
    w = Math.max(CROP_MIN_PX, Math.min(w, dispW));
    h = Math.max(CROP_MIN_PX, Math.min(h, dispH));
    x = Math.max(0, Math.min(x, dispW - w));
    y = Math.max(0, Math.min(y, dispH - h));
    return { x, y, w, h };
  }

  function wireCropEditor() {
    els.cropCancel.addEventListener('click', closeCropEditor);
    els.cropScrim.addEventListener('click', closeCropEditor);

    els.cropApply.addEventListener('click', () => {
      if (!state.cropCtx || !state.store) return;
      const { fieldId, box, dispW, dispH } = state.cropCtx;
      const crop = { x: box.x / dispW, y: box.y / dispH, w: box.w / dispW, h: box.h / dispH };
      try {
        state.store.update(fieldId, { crop });
      } catch (err) {
        console.error(err);
      }
      closeCropEditor();
    });

    els.cropBox.addEventListener('pointerdown', (e) => {
      if (!state.cropCtx) return;
      e.preventDefault();
      e.stopPropagation();
      const handleEl = e.target.closest('.handle');
      const corner = handleEl ? handleEl.dataset.corner : null;
      const startX = e.clientX;
      const startY = e.clientY;
      const startBox = { ...state.cropCtx.box };
      const { dispW, dispH } = state.cropCtx;

      const onMove = (moveEvt) => {
        const dx = moveEvt.clientX - startX;
        const dy = moveEvt.clientY - startY;
        let next;
        if (corner) {
          let { x, y, w, h } = startBox;
          if (corner.includes('r')) w = startBox.w + dx;
          if (corner.includes('l')) { x = startBox.x + dx; w = startBox.w - dx; }
          if (corner.includes('b')) h = startBox.h + dy;
          if (corner.includes('t')) { y = startBox.y + dy; h = startBox.h - dy; }
          next = { x, y, w, h };
        } else {
          next = { ...startBox, x: startBox.x + dx, y: startBox.y + dy };
        }
        state.cropCtx.box = clampCropBox(next, dispW, dispH);
        renderCropBox();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    document.addEventListener('keydown', (e) => {
      if (els.cropSheet.hidden) return;
      if (e.key === 'Escape') closeCropEditor();
    });
  }

  // ── unified undo (fields + drawings share one button/history) ────

  function updateUndoButton() {
    const canUndo = (state.store && state.store.canUndo()) || (state.annotationStore && state.annotationStore.canUndo());
    els.undoBtn.disabled = !canUndo;
  }

  // Finds which page differs between two field/shape-store snapshots (both
  // are arrays of {id, page, ...}), by comparing item-for-item on id — an
  // undo can add, remove, or change a field/shape, and whichever page that
  // item lives on is the page the undo actually affected.
  function pageAffectedByChange(beforeItems, afterItems) {
    const beforeMap = new Map(beforeItems.map((it) => [it.id, it]));
    const afterMap = new Map(afterItems.map((it) => [it.id, it]));
    for (const [id, item] of afterMap) {
      const prev = beforeMap.get(id);
      if (!prev || JSON.stringify(prev) !== JSON.stringify(item)) return item.page;
    }
    for (const [id, item] of beforeMap) {
      if (!afterMap.has(id)) return item.page;
    }
    return null;
  }

  function performUndo() {
    const fieldTs = state.store ? state.store.lastUndoTimestamp() : 0;
    const annTs = state.annotationStore ? state.annotationStore.lastUndoTimestamp() : 0;
    if (!fieldTs && !annTs) return;

    const store = annTs > fieldTs ? state.annotationStore : state.store;
    const before = store.list();
    store.undo();
    const after = store.list();

    // Jump to the page the undone change actually lives on — otherwise
    // undoing an edit on a page you've since navigated away from does
    // nothing visible and looks like undo silently failed.
    const page = pageAffectedByChange(before, after);
    if (page && page !== state.pageNumber) goToPage(page);
  }

  function changeZoom(delta) {
    state.zoomPercent = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoomPercent + delta));
    saveZoom(state.zoomPercent);
    rerenderPage();
  }

  // ── toolbar field-count readout (current page only — a document-wide
  // total isn't very actionable once a form spans several pages, since the
  // page you're looking at is the one you can actually do anything about) ──

  function updateFieldCountMeta() {
    const fields = state.store ? state.store.byPage(state.pageNumber) : [];
    const filled = fields.filter((f) => f.value).length;
    els.fieldCountMeta.textContent = fields.length
      ? `${fields.length} field${fields.length === 1 ? '' : 's'} on this page · ${filled} filled`
      : '';
  }

  // ── dashboard / templates ──────────────────────────────────────────

  function showDashboard() {
    // Leaving an active edit (not the initial page-load call, which never
    // has a pdfDoc yet) means the user is deliberately walking away from a
    // one-off edit — same "nothing persists" rule that already applies to
    // its in-memory field/annotation state applies to the autosaved copy.
    const wasEditing = !!state.pdfDoc;
    state.view = 'dashboard';
    state.currentTemplateId = null;
    if (state.editor) { state.editor.destroy(); state.editor = null; }
    if (state.annotationEditor) { state.annotationEditor.destroy(); state.annotationEditor = null; }
    state.pdfDoc = null;
    state.store = null;
    state.annotationStore = null;
    state.pageRotations = {};
    if (state.referencePhotoUrl) { URL.revokeObjectURL(state.referencePhotoUrl); state.referencePhotoUrl = null; }
    els.refPanel.hidden = true;
    els.referenceBtn.classList.remove('active');

    els.dashboardView.hidden = false;
    els.toolbar.hidden = true;
    els.drawToolbar.hidden = true;
    els.split.hidden = true;
    els.pagesPanel.hidden = true;
    els.pagesList.innerHTML = '';
    els.docname.hidden = true;
    els.docSep.hidden = true;
    els.templatesBtn.hidden = true;
    els.autosave.hidden = true;
    els.referenceBtn.disabled = true;
    els.referenceBtn.title = 'Load a PDF first';
    els.exportBtn.disabled = true;
    els.exportBtn.title = 'Load a PDF first';
    els.saveTemplateBtn.disabled = true;
    els.saveTemplateBtn.title = 'Load a PDF first';
    els.printBtn.disabled = true;
    els.printBtn.title = 'Load a PDF first';
    els.fullscreenBtn.disabled = true;
    els.fullscreenBtn.title = 'Load a PDF first';
    renderTemplateGrid();
    if (wasEditing) {
      EPDF.TemplatesDb.clearSession().then(checkResumableSession).catch((err) => console.error(err));
    } else {
      checkResumableSession();
    }
  }

  function showEditor() {
    state.view = 'editor';
    els.dashboardView.hidden = true;
    els.toolbar.hidden = false;
    els.split.hidden = false;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Draws each field's rect as a tinted box, scaled to the template's real
  // page size, to overlay on top of the rendered page thumbnail. Background
  // is transparent — the rendered PDF page image sits underneath. Uses the
  // theme's --accent via the style attribute (not a presentation attribute)
  // so it recolors correctly between light/dark.
  function buildThumbnailSvg(fields, pageW, pageH) {
    const stroke = Math.max(pageW, pageH) * 0.004;
    const boxes = fields.map((f) => {
      const y = pageH - f.rect.y - f.rect.h; // PDF is bottom-left/y-up; SVG is top-left/y-down
      return `<rect x="${f.rect.x}" y="${y}" width="${f.rect.w}" height="${f.rect.h}" rx="2" style="fill:var(--accent);fill-opacity:.22;stroke:var(--accent);stroke-width:${stroke}" />`;
    }).join('');
    return `<svg viewBox="0 0 ${pageW} ${pageH}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${boxes}</svg>`;
  }

  async function renderTemplateGrid() {
    const templates = await EPDF.TemplatesDb.listTemplates();
    templates.sort((a, b) => b.updatedAt - a.updatedAt);
    els.dashEmpty.hidden = templates.length > 0;
    els.templateGrid.hidden = templates.length === 0;
    els.templateGrid.innerHTML = templates.map((tmpl) => {
      const name = escapeHtml(tmpl.name);
      return `
        <div class="tmpl-card" data-id="${tmpl.id}">
          <button type="button" class="tmpl-open" data-open-id="${tmpl.id}">
            <span class="tmpl-thumb" data-thumb-id="${tmpl.id}">
              <i class="ph ph-file-pdf tmpl-thumb-placeholder" aria-hidden="true"></i>
            </span>
            <span class="tmpl-name">${name}</span>
            <span class="tmpl-meta">${tmpl.fields.length} field${tmpl.fields.length === 1 ? '' : 's'}</span>
          </button>
          <button type="button" class="tmpl-delete" data-delete-id="${tmpl.id}" aria-label="Delete ${name}" title="Delete template">
            <i class="ph ph-trash" aria-hidden="true"></i>
          </button>
        </div>`;
    }).join('');
    templates.forEach(renderTemplateThumbnail);
  }

  // Fills in a card's thumbnail after the grid's initial synchronous paint —
  // fetching+rendering each template's source PDF is async, so cards show a
  // placeholder icon until their own render resolves.
  async function renderTemplateThumbnail(tmpl) {
    const holder = els.templateGrid.querySelector(`[data-thumb-id="${tmpl.id}"]`);
    if (!holder) return;
    try {
      const srcPdf = await EPDF.TemplatesDb.loadSourcePdf(tmpl.sourcePdfId);
      if (!srcPdf) return;
      const dataUrl = await PdfRender.renderThumbnail(srcPdf.bytes.slice(0), 1, 240);
      const pageSize = (tmpl.pageSizes && tmpl.pageSizes[0]) || { width: 612, height: 792 };
      const fieldsOnPage1 = tmpl.fields.filter((f) => f.page === 1);
      holder.innerHTML = `
        <img class="tmpl-thumb-img" src="${dataUrl}" alt="" />
        <span class="tmpl-thumb-overlay">${buildThumbnailSvg(fieldsOnPage1, pageSize.width, pageSize.height)}</span>`;
    } catch (err) {
      console.error(err);
    }
  }

  async function openTemplate(id) {
    const record = await EPDF.TemplatesDb.loadTemplate(id);
    if (!record) return;
    const srcPdf = await EPDF.TemplatesDb.loadSourcePdf(record.sourcePdfId);
    if (!srcPdf) return;
    state.currentTemplateId = record.id;
    await EPDF.TemplatesDb.clearSession().catch((err) => console.error(err)); // starting fresh — any stale resumable session no longer applies
    await loadPdfIntoEditor(srcPdf.bytes.slice(0), record.name, record.fields, {
      pageRotations: record.pageRotations || {},
    });
  }

  // Generic confirmation sheet — one shared modal, armed with whatever
  // action should run if the user confirms. Used by both template deletion
  // and page deletion below.
  function openConfirm(title, message, onConfirm) {
    state.pendingConfirmAction = onConfirm;
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmScrim.hidden = false;
    els.confirmSheet.hidden = false;
  }
  function closeConfirmSheet() {
    els.confirmScrim.hidden = true;
    els.confirmSheet.hidden = true;
    state.pendingConfirmAction = null;
  }
  async function handleConfirmOk() {
    const action = state.pendingConfirmAction;
    closeConfirmSheet();
    if (action) await action();
  }

  function openConfirmDeleteTemplate(id) {
    const nameEl = els.templateGrid.querySelector(`.tmpl-card[data-id="${id}"] .tmpl-name`);
    const name = nameEl ? nameEl.textContent : 'This template';
    openConfirm('Delete template?', `"${name}" and its saved field layout will be deleted. This can't be undone.`, async () => {
      await EPDF.TemplatesDb.deleteTemplate(id);
      renderTemplateGrid();
    });
  }

  async function openTemplateNameSheet() {
    if (!state.pdfDoc) return;
    let defaultName = state.originalFileName || 'Untitled template';
    if (state.currentTemplateId) {
      const existing = await EPDF.TemplatesDb.loadTemplate(state.currentTemplateId);
      if (existing) defaultName = existing.name;
    }
    els.templateNameInput.value = defaultName;
    els.templateNameScrim.hidden = false;
    els.templateNameSheet.hidden = false;
    els.templateNameInput.focus();
    els.templateNameInput.select();
  }
  function closeTemplateNameSheet() {
    els.templateNameScrim.hidden = true;
    els.templateNameSheet.hidden = true;
  }

  async function confirmSaveTemplate() {
    const name = (els.templateNameInput.value || '').trim();
    if (!name) { els.templateNameInput.focus(); return; }

    els.templateNameConfirm.disabled = true;
    try {
      const pageSizes = [];
      for (let p = 1; p <= state.pdfDoc.numPages; p++) {
        const page = await state.pdfDoc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        pageSizes.push({ width: vp.width, height: vp.height });
      }
      const fields = state.store.list().map((f) => {
        const saved = { page: f.page, rect: { ...f.rect }, name: f.name, type: f.type, value: '' };
        if (f.type === 'select') saved.options = f.options;
        if (FieldModel.TEXT_LIKE_TYPES.includes(f.type)) saved.fontSize = f.fontSize;
        if (f.type === 'checkbox') saved.disabled = f.disabled;
        // An image is the template's static content, not per-fill data —
        // unlike a text value, it should survive being reopened.
        if (f.type === 'image') {
          saved.value = '1';
          saved.src = f.src;
          saved.crop = f.crop;
          saved.naturalW = f.naturalW;
          saved.naturalH = f.naturalH;
          saved.lockAspect = f.lockAspect;
        }
        return saved;
      });

      // Reuse the existing source-PDF record when re-saving a template we
      // already opened, rather than storing a duplicate copy of the bytes.
      let sourcePdfId = null;
      if (state.currentTemplateId) {
        const existing = await EPDF.TemplatesDb.loadTemplate(state.currentTemplateId);
        sourcePdfId = existing && existing.sourcePdfId;
      }
      if (!sourcePdfId) {
        const stored = await EPDF.TemplatesDb.storeSourcePdf({
          bytes: state.originalBytes,
          originalFilename: `${state.originalFileName || 'template'}.pdf`,
        });
        sourcePdfId = stored.id;
      }

      const saved = await EPDF.TemplatesDb.saveTemplate({
        id: state.currentTemplateId || undefined,
        name,
        sourcePdfId,
        pageCount: state.pdfDoc.numPages,
        pageSizes,
        fields,
        pageRotations: state.pageRotations,
      });
      state.currentTemplateId = saved.id;

      closeTemplateNameSheet();
      flashAutosave('<i class="ph ph-check-circle"></i>Template saved');
    } catch (err) {
      console.error(err);
    } finally {
      els.templateNameConfirm.disabled = false;
    }
  }

  function wireDashboard() {
    els.templatesBtn.addEventListener('click', showDashboard);
    els.newTemplateBtn.addEventListener('click', () => els.fileInput.click());
    els.resumeBtn.addEventListener('click', resumeSession);
    els.resumeDiscardBtn.addEventListener('click', discardSession);
    els.templateGrid.addEventListener('click', (e) => {
      const delBtn = e.target.closest('[data-delete-id]');
      if (delBtn) { openConfirmDeleteTemplate(delBtn.dataset.deleteId); return; }
      const openBtn = e.target.closest('[data-open-id]');
      if (openBtn) openTemplate(openBtn.dataset.openId);
    });

    els.saveTemplateBtn.addEventListener('click', openTemplateNameSheet);
    els.templateNameCancel.addEventListener('click', closeTemplateNameSheet);
    els.templateNameScrim.addEventListener('click', closeTemplateNameSheet);
    els.templateNameConfirm.addEventListener('click', confirmSaveTemplate);
    els.templateNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') confirmSaveTemplate();
    });

    els.confirmCancel.addEventListener('click', closeConfirmSheet);
    els.confirmScrim.addEventListener('click', closeConfirmSheet);
    els.confirmOk.addEventListener('click', handleConfirmOk);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!els.templateNameSheet.hidden) closeTemplateNameSheet();
      else if (!els.confirmSheet.hidden) closeConfirmSheet();
    });
  }

  // ── init ────────────────────────────────────────────────────────

  function wireDropzone() {
    els.browseBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      if (els.fileInput.files[0]) loadFile(els.fileInput.files[0]);
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      els.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      els.dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        els.dropzone.classList.remove('dragover');
      });
    });
    els.dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file && file.type === 'application/pdf') loadFile(file);
    });
  }

  function wireToolbar() {
    els.toolSelect.addEventListener('click', () => setTool('select'));
    els.toolText.addEventListener('click', () => setTool('draw-text'));
    els.toolCheckbox.addEventListener('click', () => setTool('draw-checkbox'));
    els.undoBtn.addEventListener('click', performUndo);
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return; // let native input undo run
      if (els.undoBtn.disabled) return;
      e.preventDefault();
      performUndo();
    });
  }

  function wireZoom() {
    els.zoomOut.addEventListener('click', () => changeZoom(-8));
    els.zoomIn.addEventListener('click', () => changeZoom(8));
    els.rotateBtn.addEventListener('click', rotatePage);
    els.duplicatePageBtn.addEventListener('click', () => duplicatePage(state.pageNumber));
    els.deletePageBtn.addEventListener('click', () => confirmDeletePage(state.pageNumber));
  }

  function wireResize() {
    let raf = null;
    window.addEventListener('resize', () => {
      if (!state.pdfDoc) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(rerenderPage);
    });
  }

  // ── export sheet ────────────────────────────────────────────────

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function setExportMode(mode) {
    state.exportMode = mode;
    els.exportModeFlatten.querySelector('.chk').classList.toggle('on', mode === 'flatten');
    els.exportModeEditable.querySelector('.chk').classList.toggle('on', mode === 'editable');
  }

  function openExportSheet() {
    if (!state.pdfDoc || !state.originalBytes) return;
    const fields = state.store ? state.store.list() : [];
    const filled = fields.filter((f) => f.value).length;
    els.exportFieldCount.textContent = fields.length
      ? `${filled} of ${fields.length} field${fields.length === 1 ? '' : 's'} written into the page.`
      : 'No fields placed yet — exporting the page as-is.';
    els.exportFilename.value = `${state.originalFileName || 'export'}-filled`;
    setExportMode('flatten');
    els.exportSummary.textContent =
      `${state.pdfDoc.numPages} page${state.pdfDoc.numPages === 1 ? '' : 's'} · ` +
      `${els.paperSize.textContent} · est. ${formatBytes(state.originalBytes.byteLength)}`;
    els.exportScrim.hidden = false;
    els.exportSheet.hidden = false;
    els.exportFilename.focus();
    els.exportFilename.select();
  }
  function closeExportSheet() {
    els.exportScrim.hidden = true;
    els.exportSheet.hidden = true;
  }

  function triggerDownload(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
  }

  // ── print / fullscreen ─────────────────────────────────────────

  function printPdf() {
    if (!state.pdfDoc) return;
    // Open the tab synchronously, inside the click's own call stack — if we
    // waited for buildExportBytes() (async) first, some browsers drop the
    // "user gesture" context by the time window.open() runs and silently
    // block it as a popup.
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.title = 'Preparing to print…';
    buildExportBytes().then((bytes) => {
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      win.location.href = url;
      win.addEventListener('load', () => { win.focus(); win.print(); });
    }).catch((err) => {
      console.error(err);
      win.close();
    });
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => console.error(err));
    } else {
      document.exitFullscreen();
    }
  }

  function wireFullscreen() {
    els.fullscreenBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => {
      const active = !!document.fullscreenElement;
      els.fullscreenBtn.querySelector('i').className = active ? 'ph ph-arrows-in' : 'ph ph-arrows-out';
    });
  }

  function currentAnnotations() {
    return state.annotationStore ? state.annotationStore.list() : [];
  }

  function currentRotation() {
    return Object.keys(state.pageRotations)
      .map((page) => ({ page: Number(page), degrees: state.pageRotations[page] }))
      .filter((r) => r.degrees);
  }

  async function buildExportBytes() {
    const fields = state.store ? state.store.list() : [];
    const annotations = currentAnnotations();
    const rotation = currentRotation();
    return state.exportMode === 'editable'
      ? EPDF.PdfExport.exportEditable(state.originalBytes, fields, annotations, rotation)
      : EPDF.PdfExport.flattenAndExport(state.originalBytes, fields, annotations, rotation);
  }

  async function confirmExport() {
    let filename = (els.exportFilename.value || '').trim() || 'export';
    if (!filename.toLowerCase().endsWith('.pdf')) filename += '.pdf';

    els.exportConfirm.disabled = true;
    try {
      const bytes = await buildExportBytes();
      triggerDownload(bytes, filename);
      closeExportSheet();
      flashAutosave('<i class="ph ph-check-circle"></i>Exported');
      EPDF.TemplatesDb.clearSession().catch((err) => console.error(err)); // work is safely out as a real file now
    } catch (err) {
      console.error(err);
      els.exportFieldCount.textContent = `Export failed: ${err && err.message ? err.message : 'unknown error'}`;
    } finally {
      els.exportConfirm.disabled = false;
    }
  }

  function wireExportSheet() {
    els.printBtn.addEventListener('click', printPdf);
    els.exportBtn.addEventListener('click', openExportSheet);
    els.exportCancel.addEventListener('click', closeExportSheet);
    els.exportScrim.addEventListener('click', closeExportSheet);
    els.exportModeFlatten.addEventListener('click', () => setExportMode('flatten'));
    els.exportModeEditable.addEventListener('click', () => setExportMode('editable'));
    els.exportConfirm.addEventListener('click', confirmExport);
    document.addEventListener('keydown', (e) => {
      if (els.exportSheet.hidden) return;
      if (e.key === 'Escape') closeExportSheet();
    });
  }

  // ── reference photo panel ────────────────────────────────────────

  function applyRefTransform() {
    const { scale, rotation, tx, ty } = state.refView;
    els.refPhotoImg.style.transform = `translate(${tx}px, ${ty}px) rotate(${rotation}deg) scale(${scale})`;
  }

  function resetRefView() {
    state.refView = { scale: 1, rotation: 0, tx: 0, ty: 0 };
    applyRefTransform();
  }

  function loadReferencePhoto(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (state.referencePhotoUrl) URL.revokeObjectURL(state.referencePhotoUrl);
    state.referencePhotoUrl = URL.createObjectURL(file);
    els.refPhotoImg.src = state.referencePhotoUrl;
    els.refPhotoImg.hidden = false;
    els.refPhotoPlaceholder.hidden = true;
    els.refZoomctl.hidden = false;
    els.refPopoutBtn.disabled = false;
    resetRefView();
  }

  function openReferencePanel() {
    els.refPanel.hidden = false;
    els.referenceBtn.classList.add('active');
    if (state.pdfDoc) rerenderPage(); // stage width changed, refit the page
  }
  function closeReferencePanel() {
    els.refPanel.hidden = true;
    els.referenceBtn.classList.remove('active');
    if (state.pdfDoc) rerenderPage();
  }
  function toggleReferencePanel() {
    if (els.refPanel.hidden) openReferencePanel(); else closeReferencePanel();
  }

  function wireRefPan() {
    els.refPhotoImg.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startTx = state.refView.tx;
      const startTy = state.refView.ty;
      els.refPhotoImg.classList.add('panning');

      const onMove = (moveEvt) => {
        state.refView.tx = startTx + (moveEvt.clientX - startX);
        state.refView.ty = startTy + (moveEvt.clientY - startY);
        applyRefTransform();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        els.refPhotoImg.classList.remove('panning');
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });
  }

  function wireReferencePanel() {
    els.referenceBtn.addEventListener('click', toggleReferencePanel);
    els.refCloseBtn.addEventListener('click', closeReferencePanel);
    els.refReplaceBtn.addEventListener('click', () => els.refFileInput.click());
    els.refPhotoPlaceholder.addEventListener('click', () => els.refFileInput.click());
    els.refFileInput.addEventListener('change', () => {
      if (els.refFileInput.files[0]) loadReferencePhoto(els.refFileInput.files[0]);
    });
    els.refPopoutBtn.addEventListener('click', () => {
      if (state.referencePhotoUrl) window.open(state.referencePhotoUrl, '_blank');
    });
    els.refZoomIn.addEventListener('click', () => {
      state.refView.scale = Math.min(6, state.refView.scale * 1.25);
      applyRefTransform();
    });
    els.refZoomOut.addEventListener('click', () => {
      state.refView.scale = Math.max(0.2, state.refView.scale / 1.25);
      applyRefTransform();
    });
    els.refRotate.addEventListener('click', () => {
      state.refView.rotation = (state.refView.rotation + 90) % 360;
      applyRefTransform();
    });
    els.refFit.addEventListener('click', resetRefView);
    wireRefPan();

    ['dragenter', 'dragover'].forEach((evt) => {
      els.refPhoto.addEventListener(evt, (e) => { e.preventDefault(); els.refPhoto.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      els.refPhoto.addEventListener(evt, (e) => { e.preventDefault(); els.refPhoto.classList.remove('dragover'); });
    });
    els.refPhoto.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) loadReferencePhoto(file);
    });

    els.refCopyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(els.refScratch.value);
        const original = els.refCopyBtn.innerHTML;
        els.refCopyBtn.innerHTML = '<i class="ph-bold ph-check"></i>Copied';
        setTimeout(() => { els.refCopyBtn.innerHTML = original; }, 1500);
      } catch (err) {
        console.error(err);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheEls();
    wireDropzone();
    wireToolbar();
    wireZoom();
    wirePageNav();
    wireResize();
    wireExportSheet();
    wireReferencePanel();
    wireDashboard();
    wireDrawToolbar();
    wireFieldToolbar();
    wireImageTool();
    wireCropEditor();
    wireFullscreen();
    EPDFTheme.wireToggleButton(els.themeToggle);
    showDashboard();
  });
})();
