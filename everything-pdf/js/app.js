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
    pageRotation: 0,       // additional user-applied rotation (0/90/180/270), on top of the page's own
    originalBytes: null,   // pristine ArrayBuffer of the loaded PDF, for pdf-lib export
    originalFileName: '',
    exportMode: 'flatten', // 'flatten' | 'editable'
    referencePhotoUrl: null, // object URL of the currently loaded reference photo, or null
    refView: { scale: 1, rotation: 0, tx: 0, ty: 0 },
    currentTemplateId: null, // id of the saved template this session came from, or null (one-off edit)
    pendingDeleteId: null,   // template id awaiting delete confirmation
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
      'page-wrap', 'page-canvas', 'draw-canvas', 'field-overlay', 'pagebar', 'page-info', 'paper-size',
      'zoom-out', 'zoom-in', 'zoom-pct', 'rotate-btn',
      'docname', 'docname-title', 'doc-sep', 'autosave', 'templates-btn',
      'theme-toggle', 'fullscreen-btn', 'print-btn', 'save-template-btn', 'reference-btn', 'export-btn',
      'tool-select', 'tool-text', 'tool-checkbox', 'tool-draw', 'undo-btn',
      'field-count-meta',
      'draw-toolbar', 'draw-shape-seg', 'draw-colors', 'draw-hint', 'draw-delete-btn', 'draw-clear-btn',
      'export-scrim', 'export-sheet', 'export-title', 'export-field-count',
      'export-filename', 'export-mode-flatten', 'export-mode-editable',
      'export-summary', 'export-cancel', 'export-confirm',
      'ref-panel', 'ref-replace-btn', 'ref-popout-btn', 'ref-close-btn',
      'ref-photo', 'ref-photo-placeholder', 'ref-photo-img', 'ref-zoomctl',
      'ref-zoom-out', 'ref-zoom-in', 'ref-rotate', 'ref-fit',
      'ref-scratch', 'ref-copy-btn', 'ref-file-input',
      'template-name-scrim', 'template-name-sheet', 'template-name-input',
      'template-name-cancel', 'template-name-confirm',
      'confirm-scrim', 'confirm-sheet', 'confirm-message', 'confirm-cancel', 'confirm-ok',
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
    state.pageRotation = opts.pageRotation || 0;
    state.store = FieldModel.createStore();
    state.store.subscribe(() => { renderFieldCountMeta(state.store.list()); updateUndoButton(); scheduleAutosave(); });
    state.annotationStore = Annotations.createStore();
    state.annotationStore.subscribe(() => { updateUndoButton(); updateDrawDeleteButton(); scheduleAutosave(); });

    let detectedCount = 0;
    if (presetFields) {
      presetFields.forEach((f) => state.store.add({
        page: f.page, rect: f.rect, name: f.name, type: f.type,
        value: opts.preserveValues ? (f.value || '') : '',
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
    renderFieldCountMeta(state.store.list());
    updateUndoButton();
    updateDrawDeleteButton();
  }

  async function loadFile(file) {
    const buffer = await file.arrayBuffer();
    state.currentTemplateId = null;
    await EPDF.TemplatesDb.clearSession().catch((err) => console.error(err)); // starting fresh — any stale resumable session no longer applies
    await loadPdfIntoEditor(buffer, file.name.replace(/\.pdf$/i, ''), null);
  }

  async function rerenderPage() {
    const targetCssWidth = Math.max(200, Math.min(620, els.stage.clientWidth - 40));
    const { page, viewport } = await PdfRender.renderPage(state.pdfDoc, state.pageNumber, els.pageCanvas, {
      targetCssWidth,
      zoomPercent: state.zoomPercent,
      rotation: state.pageRotation,
    });
    state.viewport = viewport;
    els.pageWrap.style.width = Math.floor(viewport.width) + 'px';
    els.pageWrap.style.height = Math.floor(viewport.height) + 'px';

    els.pageInfo.textContent = `Page ${state.pageNumber} of ${state.pdfDoc.numPages}`;
    const unscaled = page.getViewport({ scale: 1, rotation: (page.rotate + state.pageRotation) % 360 });
    els.paperSize.textContent = paperSizeLabel(unscaled.width, unscaled.height);
    els.zoomPct.textContent = state.zoomPercent + '%';

    if (state.editor) state.editor.layout();
    if (state.annotationEditor) state.annotationEditor.layout();
  }

  function rotatePage() {
    state.pageRotation = (state.pageRotation + 90) % 360;
    rerenderPage();
    scheduleAutosave();
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
        pageRotation: state.pageRotation,
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
      pageRotation: session.pageRotation,
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
    // layer — canvas-editor only ever sees 'select'/'draw-text', so it's
    // told 'select' whenever draw mode is active (keeps its own gestures
    // idle without needing it to know a third tool exists).
    if (state.editor) state.editor.setTool(tool === 'draw' ? 'select' : tool);
    els.toolSelect.classList.toggle('on', tool === 'select');
    els.toolText.classList.toggle('on', tool === 'draw-text');
    els.toolDraw.classList.toggle('on', tool === 'draw');
    els.fieldOverlay.classList.toggle('tool-draw', tool === 'draw');
    els.drawToolbar.hidden = tool !== 'draw';
    if (state.annotationEditor) state.annotationEditor.setActive(tool === 'draw');
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

  // ── unified undo (fields + drawings share one button/history) ────

  function updateUndoButton() {
    const canUndo = (state.store && state.store.canUndo()) || (state.annotationStore && state.annotationStore.canUndo());
    els.undoBtn.disabled = !canUndo;
  }

  function performUndo() {
    const fieldTs = state.store ? state.store.lastUndoTimestamp() : 0;
    const annTs = state.annotationStore ? state.annotationStore.lastUndoTimestamp() : 0;
    if (!fieldTs && !annTs) return;
    if (annTs > fieldTs) state.annotationStore.undo();
    else state.store.undo();
  }

  function changeZoom(delta) {
    state.zoomPercent = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoomPercent + delta));
    saveZoom(state.zoomPercent);
    rerenderPage();
  }

  // ── toolbar field-count readout ─────────────────────────────────

  function renderFieldCountMeta(fields) {
    const filled = fields.filter((f) => f.value).length;
    els.fieldCountMeta.textContent = fields.length
      ? `${fields.length} field${fields.length === 1 ? '' : 's'} · ${filled} filled`
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
    state.pageRotation = 0;
    if (state.referencePhotoUrl) { URL.revokeObjectURL(state.referencePhotoUrl); state.referencePhotoUrl = null; }
    els.refPanel.hidden = true;
    els.referenceBtn.classList.remove('active');

    els.dashboardView.hidden = false;
    els.toolbar.hidden = true;
    els.drawToolbar.hidden = true;
    els.split.hidden = true;
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
    await loadPdfIntoEditor(srcPdf.bytes.slice(0), record.name, record.fields);
  }

  function openConfirmDelete(id) {
    state.pendingDeleteId = id;
    const nameEl = els.templateGrid.querySelector(`.tmpl-card[data-id="${id}"] .tmpl-name`);
    const name = nameEl ? nameEl.textContent : 'This template';
    els.confirmMessage.textContent = `"${name}" and its saved field layout will be deleted. This can't be undone.`;
    els.confirmScrim.hidden = false;
    els.confirmSheet.hidden = false;
  }
  function closeConfirmSheet() {
    els.confirmScrim.hidden = true;
    els.confirmSheet.hidden = true;
    state.pendingDeleteId = null;
  }
  async function confirmDelete() {
    if (!state.pendingDeleteId) return;
    await EPDF.TemplatesDb.deleteTemplate(state.pendingDeleteId);
    closeConfirmSheet();
    renderTemplateGrid();
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
      const fields = state.store.list().map((f) => ({ page: f.page, rect: { ...f.rect }, name: f.name, type: f.type, value: '' }));

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
      if (delBtn) { openConfirmDelete(delBtn.dataset.deleteId); return; }
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
    els.confirmOk.addEventListener('click', confirmDelete);

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
    return { page: state.pageNumber, degrees: state.pageRotation };
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
    wireResize();
    wireExportSheet();
    wireReferencePanel();
    wireDashboard();
    wireDrawToolbar();
    wireFullscreen();
    EPDFTheme.wireToggleButton(els.themeToggle);
    showDashboard();
  });
})();
