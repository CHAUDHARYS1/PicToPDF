/* Everything PDF — app wiring: DOM refs, file loading, right-panel rendering.
   The only file that touches `document` at top level (DOMContentLoaded). */
window.EPDF = window.EPDF || {};

(function () {
  const FieldModel = EPDF.FieldModel;
  const PdfRender = EPDF.PdfRender;
  const CanvasEditor = EPDF.CanvasEditor;

  const $ = (sel) => document.querySelector(sel);
  const els = {};

  const state = {
    pdfDoc: null,
    pageNumber: 1,
    zoomPercent: 100,
    viewport: null,
    store: null,
    editor: null,
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
      'stage', 'dropzone', 'browse-btn', 'file-input',
      'page-wrap', 'page-canvas', 'field-overlay', 'pagebar', 'page-info', 'paper-size',
      'zoom-out', 'zoom-in', 'zoom-pct',
      'docname', 'docname-title', 'doc-sep', 'autosave',
      'reference-btn', 'export-btn',
      'tool-select', 'tool-text', 'tool-checkbox', 'tool-signature',
      'field-count-meta',
      'flist', 'totals-block', 'inspector',
    ].forEach((id) => { els[toCamel(id)] = document.getElementById(id); });
  }

  function toCamel(id) {
    return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  // ── file loading ────────────────────────────────────────────────

  async function loadFile(file) {
    const buffer = await file.arrayBuffer();
    const pdfDoc = await PdfRender.loadPdf(buffer);
    state.pdfDoc = pdfDoc;
    state.pageNumber = 1;
    state.zoomPercent = 100;
    state.store = FieldModel.createStore();
    state.store.subscribe(renderRightPanel);

    els.docname.hidden = false;
    els.docSep.hidden = false;
    els.docnameTitle.textContent = file.name.replace(/\.pdf$/i, '');
    els.autosave.hidden = false;

    if (state.editor) state.editor.destroy();
    els.fieldOverlay.innerHTML = '';
    state.editor = CanvasEditor.create({
      overlayEl: els.fieldOverlay,
      store: state.store,
      getViewport: () => state.viewport,
    });
    setTool('select');

    // Only reveal the stage (and let the editor's pointer listeners see
    // real events) once the first render has actually committed a
    // viewport — otherwise a fast click-drag on a still-loading PDF could
    // start a gesture with no viewport to convert coordinates against.
    await rerenderPage();
    els.dropzone.hidden = true;
    els.pageWrap.hidden = false;
    els.pagebar.hidden = false;
    renderRightPanel({ fields: [], selectedId: null });
  }

  async function rerenderPage() {
    const targetCssWidth = Math.max(200, Math.min(620, els.stage.clientWidth - 40));
    const { page, viewport } = await PdfRender.renderPage(state.pdfDoc, state.pageNumber, els.pageCanvas, {
      targetCssWidth,
      zoomPercent: state.zoomPercent,
    });
    state.viewport = viewport;
    els.pageWrap.style.width = Math.floor(viewport.width) + 'px';
    els.pageWrap.style.height = Math.floor(viewport.height) + 'px';

    els.pageInfo.textContent = `Page ${state.pageNumber} of ${state.pdfDoc.numPages}`;
    const unscaled = page.getViewport({ scale: 1 });
    els.paperSize.textContent = paperSizeLabel(unscaled.width, unscaled.height);
    els.zoomPct.textContent = state.zoomPercent + '%';

    if (state.editor) state.editor.layout();
  }

  // ── toolbar ─────────────────────────────────────────────────────

  function setTool(tool) {
    if (state.editor) state.editor.setTool(tool);
    els.toolSelect.classList.toggle('on', tool === 'select');
    els.toolText.classList.toggle('on', tool === 'draw-text');
  }

  function changeZoom(delta) {
    state.zoomPercent = Math.max(40, Math.min(200, state.zoomPercent + delta));
    rerenderPage();
  }

  // ── right panel: fields list + inspector + totals ──────────────

  function renderRightPanel() {
    if (!state.store) return;
    const fields = state.store.list();
    const selected = state.store.getSelected();

    renderFieldCountMeta(fields);
    renderFieldsList(fields, selected);
    renderTotalsBlock(fields);
    renderInspector(selected, fields);
  }

  function renderFieldCountMeta(fields) {
    const filled = fields.filter((f) => f.value).length;
    els.fieldCountMeta.textContent = fields.length
      ? `${fields.length} field${fields.length === 1 ? '' : 's'} · ${filled} filled`
      : '';
  }

  function typeTagLabel(field) {
    if (field.behavior === 'total') return 'Auto';
    return field.type === 'number' ? 'Number'
      : field.type === 'checkbox' ? 'Checkbox'
      : field.type === 'signature' ? 'Signature'
      : field.type === 'date' ? 'Date'
      : 'Text';
  }

  function renderFieldsList(fields, selected) {
    els.flist.innerHTML = '';
    if (!fields.length) {
      const empty = document.createElement('div');
      empty.className = 'flist-empty';
      empty.textContent = 'No fields yet — pick "Text field" and drag on the page to place one.';
      els.flist.appendChild(empty);
      return;
    }
    fields.forEach((field) => {
      const item = document.createElement('div');
      item.className = 'fitem' + (selected && selected.id === field.id ? ' on' : '');
      item.innerHTML = `
        <i class="ph ph-dots-six-vertical grip"></i>
        <span class="nm"></span>
        <span class="tag${field.type === 'number' ? ' n' : ''}"></span>
      `;
      item.querySelector('.nm').textContent = field.name;
      item.querySelector('.tag').textContent = typeTagLabel(field);
      item.addEventListener('click', () => state.store.select(field.id));
      els.flist.appendChild(item);
    });
  }

  function renderTotalsBlock(fields) {
    els.totalsBlock.innerHTML = '';
    const totals = fields.filter((f) => f.behavior === 'total');
    if (!totals.length) return; // brief's critical rule: no numeric config, no math shown

    totals.forEach((total) => {
      const contributors = fields.filter((f) => f.targetTotalId === total.id);
      const group = document.createElement('div');
      group.className = 'fgroup';
      const gl = document.createElement('div');
      gl.className = 'gl';
      gl.textContent = `${total.name} · live`;
      group.appendChild(gl);

      contributors.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'frowck';
        row.innerHTML = `<span class="chk on"></span><span class="nm"></span><span class="v"></span>`;
        row.querySelector('.nm').textContent = c.name;
        row.querySelector('.v').textContent = (parseFloat(c.value) || 0).toFixed(2);
        group.appendChild(row);
      });

      const sum = document.createElement('div');
      sum.className = 'sumline';
      sum.innerHTML = `<span>Total</span><span class="v"></span>`;
      sum.querySelector('.v').textContent = (parseFloat(total.value) || 0).toFixed(2);
      group.appendChild(sum);

      els.totalsBlock.appendChild(group);
    });
  }

  function renderInspector(selected, allFields) {
    els.inspector.innerHTML = '';
    if (!selected) {
      const hint = document.createElement('div');
      hint.className = 'note';
      hint.innerHTML = `<i class="ph ph-cursor-click"></i><span>Select a field on the page or in the list to edit its properties.</span>`;
      els.inspector.appendChild(hint);
      return;
    }

    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gap = '11px';

    const nameProp = document.createElement('div');
    nameProp.className = 'prop';
    nameProp.innerHTML = `<span class="pl">Name</span>`;
    const nameInput = document.createElement('input');
    nameInput.className = 'inp';
    nameInput.value = selected.name;
    nameInput.addEventListener('change', () => {
      state.store.update(selected.id, { name: nameInput.value || 'Field' });
    });
    nameProp.appendChild(nameInput);

    const typeProp = document.createElement('div');
    typeProp.className = 'prop';
    typeProp.innerHTML = `<span class="pl">Type</span>`;
    const typeSelect = document.createElement('select');
    typeSelect.className = 'inp';
    FieldModel.TYPES.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      if (t === selected.type) opt.selected = true;
      typeSelect.appendChild(opt);
    });
    typeSelect.addEventListener('change', () => {
      state.store.update(selected.id, { type: typeSelect.value });
    });
    typeProp.appendChild(typeSelect);

    grid.appendChild(nameProp);
    grid.appendChild(typeProp);
    els.inspector.appendChild(grid);

    // Behavior — only ever shown for numeric fields, per the brief's
    // critical rule: plain PDFs must never trigger arithmetic UI.
    if (selected.type === 'number') {
      els.inspector.appendChild(buildBehaviorControl(selected, allFields));
    }
  }

  function buildBehaviorControl(selected, allFields) {
    const wrap = document.createElement('div');
    wrap.className = 'prop';
    wrap.innerHTML = `<span class="pl">Behavior</span>`;

    const seg = document.createElement('div');
    seg.className = 'seg';

    const totalCandidates = allFields.filter((f) => f.behavior === 'total' && f.id !== selected.id);

    const options = [
      { key: 'plain', label: 'Plain' },
      { key: 'sum', label: 'Sums into total' },
      { key: 'total', label: 'Is a total' },
    ];
    options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opt.label;
      if (selected.behavior === opt.key) btn.classList.add('on');
      if (opt.key === 'sum' && !totalCandidates.length && selected.behavior !== 'sum') {
        btn.disabled = true;
        btn.title = 'Mark another number field as "Is a total" first.';
      }
      btn.addEventListener('click', () => {
        if (opt.key === 'sum') {
          const targetId = selected.targetTotalId && totalCandidates.some((c) => c.id === selected.targetTotalId)
            ? selected.targetTotalId
            : totalCandidates[0]?.id;
          if (!targetId) return;
          state.store.update(selected.id, { behavior: 'sum', targetTotalId: targetId });
        } else if (opt.key === 'total') {
          state.store.update(selected.id, { behavior: 'total', targetTotalId: null });
        } else {
          state.store.update(selected.id, { behavior: 'plain', targetTotalId: null });
        }
      });
      seg.appendChild(btn);
    });
    wrap.appendChild(seg);

    if (selected.behavior === 'sum' && totalCandidates.length > 1) {
      const targetProp = document.createElement('div');
      targetProp.className = 'prop';
      targetProp.style.marginTop = '8px';
      targetProp.innerHTML = `<span class="pl">Target total</span>`;
      const targetSelect = document.createElement('select');
      targetSelect.className = 'inp';
      totalCandidates.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        if (c.id === selected.targetTotalId) opt.selected = true;
        targetSelect.appendChild(opt);
      });
      targetSelect.addEventListener('change', () => {
        state.store.update(selected.id, { targetTotalId: targetSelect.value });
      });
      targetProp.appendChild(targetSelect);
      wrap.appendChild(targetProp);
    }

    return wrap;
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
  }

  function wireZoom() {
    els.zoomOut.addEventListener('click', () => changeZoom(-8));
    els.zoomIn.addEventListener('click', () => changeZoom(8));
  }

  function wireResize() {
    let raf = null;
    window.addEventListener('resize', () => {
      if (!state.pdfDoc) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(rerenderPage);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheEls();
    wireDropzone();
    wireToolbar();
    wireZoom();
    wireResize();
  });
})();
