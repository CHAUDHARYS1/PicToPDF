/* compresspdf — screen wiring. Screen 1 (level picker) shows read-only
   size estimates (estimate.js); clicking "Compress" runs the real pass
   (compress.js) against the original file's bytes and screen 2 shows the
   actual before/after result, computed from the actual output — never
   the estimate numbers. */
window.CompressPDF = window.CompressPDF || {};

(function () {
  const Estimate = CompressPDF.Estimate;
  const Compress = CompressPDF.Compress;
  const els = {};

  const state = {
    file: null,        // { name, bytes, sizeBytes, pageCount, imageCount } | null
    estimates: null,   // { low, medium, high } | null — each { resultBytes, savedBytes, savedPct }
    level: 'medium',
    status: 'empty',    // 'empty' | 'estimating' | 'ready' | 'compressing' | 'done' | 'error'
    error: '',
    compressError: '',
    progress: null,     // { done, total } | null, while compressing
    result: null,        // { outBytes, report, level, elapsedSec } | null
  };

  function toCamel(id) {
    return id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  }

  function cacheEls() {
    [
      'dropzone', 'browse-btn', 'file-input',
      'filecard', 'fc-name', 'fc-meta', 'replace-btn', 'replace-input', 'clear-btn',
      'error-note', 'error-text',
      'level-section', 'levels',
      'sizechart', 'sc-plot', 'sc-before-val', 'sc-before-bar', 'sc-after-val', 'sc-after-bar', 'sc-after-label',
      'footer-divide', 'footer-row', 'compress-btn',
      'screen-picker', 'screen-result',
      'result-sub', 'result-pct', 'result-bt', 'result-bs',
      'result-orig', 'result-new', 'result-newbar', 'result-rows',
      'download-btn', 'preview-btn', 'retry-btn', 'another-btn',
      'theme-toggle',
    ].forEach((id) => { els[toCamel(id)] = document.getElementById(id); });
  }

  // The design's own sample numbers are all real-world PDF sizes (tens of
  // MB) and never dip below 1 MB, so the spec never had to say what a
  // sub-1MB result should look like — but a heavily-compressed small file
  // legitimately can land there, and "0.0 MB" reads as broken. Falls back
  // to KB/B for those, matching the tiered formatter everything-pdf's own
  // export sheet already uses.
  function formatBytes(bytes) {
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatSaved(savedBytes, savedPct) {
    return `Saves ${formatBytes(savedBytes)} · ${savedPct}%`;
  }

  // ── size comparison chart ─────────────────────────────────────

  // Round log10-decade labels for the chart's gridlines — an axis guide
  // ("about here"), not a byte-exact conversion (those live on the bars
  // themselves via formatBytes, which is 1024-based).
  const DECADE_LABELS = {
    3: '1 KB', 4: '10 KB', 5: '100 KB',
    6: '1 MB', 7: '10 MB', 8: '100 MB',
    9: '1 GB', 10: '10 GB', 11: '100 GB',
    12: '1 TB', 13: '10 TB',
  };

  function renderSizeChart(beforeBytes, afterBytes) {
    const values = [beforeBytes, afterBytes].filter((v) => v > 0);
    if (!values.length) return;

    const logs = values.map((v) => Math.log10(v));
    let lo = Math.max(0, Math.floor(Math.min(...logs)) - 1);
    let hi = Math.ceil(Math.max(...logs));
    if (hi - lo < 2) hi = lo + 2;

    // Pixel math, not percentages: the top decade's label needs headroom
    // above its gridline, so the plottable band is inset from the top of
    // the fixed-height box by TOP_PAD, and both ticks and bars are placed
    // against that same band so they line up.
    const TOP_PAD = 22;
    const plotH = els.scPlot.clientHeight || 190;
    const usableH = plotH - TOP_PAD;

    els.scPlot.querySelectorAll('.sctick').forEach((el) => el.remove());
    for (let d = lo; d <= hi; d++) {
      if (!(d in DECADE_LABELS)) continue;
      const top = TOP_PAD + (1 - (d - lo) / (hi - lo)) * usableH;
      const tick = document.createElement('div');
      tick.className = 'sctick';
      tick.style.top = `${top}px`;
      tick.innerHTML = `<span class="lbl">${DECADE_LABELS[d]}</span>`;
      els.scPlot.appendChild(tick);
    }

    const barHeight = (bytes) => {
      if (bytes <= 0) return 0;
      const pct = Math.min(100, Math.max(2, ((Math.log10(bytes) - lo) / (hi - lo)) * 100));
      return (pct / 100) * usableH;
    };
    els.scBeforeBar.style.height = `${barHeight(beforeBytes)}px`;
    els.scBeforeVal.textContent = beforeBytes > 0 ? formatBytes(beforeBytes) : '—';
    if (afterBytes > 0) {
      els.scAfterBar.style.visibility = 'visible';
      els.scAfterBar.style.height = `${barHeight(afterBytes)}px`;
      els.scAfterVal.textContent = formatBytes(afterBytes);
    } else {
      els.scAfterBar.style.visibility = 'hidden';
      els.scAfterVal.textContent = '—';
    }
  }

  // ── rendering: screen 1 (picker) ──────────────────────────────────

  function render() {
    const showResult = state.status === 'done';
    els.screenPicker.hidden = showResult;
    els.screenResult.hidden = !showResult;
    if (showResult) {
      renderResult();
      return;
    }

    // Dropzone stays visible on error too — otherwise a bad file is a dead
    // end with no way to try another one.
    els.dropzone.hidden = state.status !== 'empty' && state.status !== 'error';

    const showLoadError = state.status === 'error';
    els.errorNote.hidden = !(showLoadError || state.compressError);
    if (showLoadError) els.errorText.textContent = state.error;
    else if (state.compressError) els.errorText.textContent = state.compressError;

    const hasFile = state.status === 'estimating' || state.status === 'ready' || state.status === 'compressing';
    els.filecard.hidden = !hasFile;
    els.levelSection.hidden = !hasFile;
    els.sizechart.hidden = !hasFile;
    els.footerDivide.hidden = !hasFile;
    els.footerRow.hidden = !hasFile;

    if (!hasFile) return;

    els.fcName.textContent = state.file.name;
    const metaParts = [formatBytes(state.file.sizeBytes), `${state.file.pageCount} page${state.file.pageCount === 1 ? '' : 's'}`];
    if (state.status !== 'estimating') metaParts.push(`${state.file.imageCount} image${state.file.imageCount === 1 ? '' : 's'}`);
    els.fcMeta.innerHTML = metaParts.map((p) => `<span>${p}</span>`).join('<span>·</span>');

    const busy = state.status === 'compressing';
    els.levels.classList.toggle('busy', busy);
    els.replaceBtn.disabled = busy;
    els.clearBtn.disabled = busy;

    renderLevels();
    updateCompressButton();

    const currentEst = state.estimates && state.estimates[state.level];
    els.scAfterLabel.textContent = `After ${Estimate.LEVELS[state.level].label}`;
    renderSizeChart(state.file.sizeBytes, currentEst ? currentEst.resultBytes : 0);
  }

  function renderLevels() {
    els.levels.innerHTML = Estimate.LEVEL_ORDER.map((key) => {
      const meta = Estimate.LEVELS[key];
      const est = state.estimates && state.estimates[key];
      const isOn = state.level === key;
      const estHtml = est
        ? `${formatBytes(est.resultBytes)}<span>est.</span>`
        : `<span class="est skeleton">&nbsp;</span>`;
      const savedHtml = est ? formatSaved(est.savedBytes, est.savedPct) : '&nbsp;';
      const barWidth = est ? est.savedPct : 0;
      return `
        <button type="button" class="lvl${isOn ? ' on' : ''}" data-level="${key}">
          <div class="lh"><span class="nm">${meta.label}</span><span class="rd"></span></div>
          <div>
            <div class="est">${estHtml}</div>
            <div class="saved" style="margin-top:7px">${savedHtml}</div>
          </div>
          <div class="bar"><i style="width:${barWidth}%"></i></div>
          <div class="why">${meta.why}</div>
        </button>`;
    }).join('');
  }

  function updateCompressButton() {
    if (state.status === 'compressing') {
      const p = state.progress;
      const label = p && p.total ? `Compressing… ${p.done}/${p.total}` : 'Compressing…';
      els.compressBtn.disabled = true;
      els.compressBtn.innerHTML = `<i class="ph-bold ph-spinner spin"></i>${label}`;
      return;
    }
    const est = state.estimates && state.estimates[state.level];
    els.compressBtn.disabled = !est;
    els.compressBtn.innerHTML = est
      ? `<i class="ph-bold ph-arrows-in-simple"></i>Compress to ${formatBytes(est.resultBytes)}`
      : `<i class="ph-bold ph-arrows-in-simple"></i>Compress`;
  }

  // ── rendering: screen 2 (result) ──────────────────────────────────

  function renderResult() {
    const { report, level, elapsedSec } = state.result;
    const meta = Estimate.LEVELS[level];

    const savedBytes = Math.max(0, report.totalBefore - report.totalAfter);
    const savedPct = report.totalBefore > 0 ? Math.round((savedBytes / report.totalBefore) * 100) : 0;
    const compressedPct = report.totalBefore > 0 ? (report.totalAfter / report.totalBefore) * 100 : 0;

    els.resultSub.textContent = `${meta.label} level · ${state.file.pageCount} page${state.file.pageCount === 1 ? '' : 's'} · finished in ${elapsedSec.toFixed(1)}s`;
    els.resultPct.textContent = `${savedPct}%`;
    els.resultBt.textContent = `${formatBytes(savedBytes)} smaller`;
    els.resultBs.textContent = `${formatBytes(report.totalBefore)} → ${formatBytes(report.totalAfter)}`;
    els.resultOrig.textContent = formatBytes(report.totalBefore);
    els.resultNew.textContent = formatBytes(report.totalAfter);
    els.resultNewbar.style.width = `${Math.min(100, Math.max(0, compressedPct))}%`;

    const rows = [];
    const imageDelta = report.imageBytesBefore - report.imageBytesAfter;
    const { imagesResampled, imagesConverted } = report;
    if ((imagesResampled > 0 || imagesConverted > 0) && imageDelta > 0) {
      const dpi = level === 'high' ? '72 dpi' : '150 dpi';
      const plural = (n) => (n === 1 ? '' : 's');
      let label;
      if (imagesResampled > 0 && imagesConverted === 0) {
        label = `${imagesResampled} image${plural(imagesResampled)} resampled to ${dpi}`;
      } else if (imagesConverted > 0 && imagesResampled === 0) {
        label = `${imagesConverted} image${plural(imagesConverted)} recompressed`;
      } else {
        const total = imagesResampled + imagesConverted;
        label = `${total} images compressed (${imagesResampled} resampled, ${imagesConverted} recompressed)`;
      }
      rows.push({ icon: 'ph-image', label, value: `−${formatBytes(imageDelta)}` });
    }
    const otherDelta = (report.totalBefore - report.imageBytesBefore) - (report.totalAfter - report.imageBytesAfter);
    if (otherDelta > 0) {
      rows.push({ icon: 'ph-broom', label: 'Unused objects removed & content compacted', value: `−${formatBytes(otherDelta)}` });
    }
    rows.push({ icon: 'ph-textbox', label: 'Form fields kept editable', value: 'unchanged' });

    els.resultRows.innerHTML = rows.map((r) => `<div class="frowck"><i class="ph ${r.icon}" style="font-size:15px"></i>${r.label}<span class="v">${r.value}</span></div>`).join('');
  }

  // ── file loading ───────────────────────────────────────────────

  async function loadFile(file) {
    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      state.status = 'error';
      state.error = `"${file.name}" isn't a PDF.`;
      render();
      return;
    }

    const buffer = await file.arrayBuffer();
    state.file = { name: file.name, bytes: buffer, sizeBytes: buffer.byteLength, pageCount: 0, imageCount: 0 };
    state.estimates = null;
    state.result = null;
    state.compressError = '';
    state.status = 'estimating';
    render();

    try {
      const result = await Estimate.analyze(buffer.slice(0));
      state.file.pageCount = result.pageCount;
      state.file.imageCount = result.imageCount;
      state.estimates = result.estimates;
      state.status = 'ready';
    } catch (err) {
      console.error(err);
      state.file = null;
      state.status = 'error';
      state.error = /encrypt/i.test(err && err.message || '')
        ? `"${file.name}" is password-protected. Remove the password first.`
        : `Couldn't read "${file.name}" — it may be corrupted.`;
    }
    render();
  }

  function clearFile() {
    state.file = null;
    state.estimates = null;
    state.level = 'medium';
    state.status = 'empty';
    state.error = '';
    state.compressError = '';
    state.progress = null;
    state.result = null;
    render();
  }

  // ── compression ────────────────────────────────────────────────

  async function compress() {
    if (state.status !== 'ready') return;
    state.status = 'compressing';
    state.progress = null;
    state.compressError = '';
    render();

    const level = state.level;
    const startedAt = performance.now();
    try {
      const { outBytes, report } = await Compress.run(state.file.bytes.slice(0), level, (done, total) => {
        state.progress = { done, total };
        updateCompressButton();
      });
      state.result = { outBytes, report, level, elapsedSec: (performance.now() - startedAt) / 1000 };
      state.status = 'done';
    } catch (err) {
      console.error(err);
      state.status = 'ready';
      state.compressError = `Couldn't compress "${state.file.name}" — it may use a PDF feature this tool can't process yet.`;
    }
    render();
  }

  function downloadResult() {
    if (!state.result) return;
    const blob = new Blob([state.result.outBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.file.name.replace(/\.pdf$/i, '')}-compressed.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function previewResult() {
    if (!state.result) return;
    const blob = new Blob([state.result.outBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ── wiring ─────────────────────────────────────────────────────

  function wireDropzone() {
    els.browseBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', () => {
      if (els.fileInput.files[0]) loadFile(els.fileInput.files[0]);
      els.fileInput.value = '';
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.remove('dragover'); });
    });
    els.dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    });
  }

  function wireFileCard() {
    els.replaceBtn.addEventListener('click', () => els.replaceInput.click());
    els.replaceInput.addEventListener('change', () => {
      if (els.replaceInput.files[0]) loadFile(els.replaceInput.files[0]);
      els.replaceInput.value = '';
    });
    els.clearBtn.addEventListener('click', clearFile);
  }

  function wireLevels() {
    els.levels.addEventListener('click', (e) => {
      if (state.status === 'compressing') return;
      const btn = e.target.closest('.lvl');
      if (!btn) return;
      state.level = btn.dataset.level;
      render();
    });
  }

  function wireFooter() {
    els.compressBtn.addEventListener('click', compress);
  }

  function wireResultScreen() {
    els.downloadBtn.addEventListener('click', downloadResult);
    els.previewBtn.addEventListener('click', previewResult);
    els.retryBtn.addEventListener('click', () => {
      state.status = 'ready';
      state.result = null;
      render();
    });
    els.anotherBtn.addEventListener('click', clearFile);
  }

  document.addEventListener('DOMContentLoaded', () => {
    cacheEls();
    wireDropzone();
    wireFileCard();
    wireLevels();
    wireFooter();
    wireResultScreen();
    EPDFTheme.wireToggleButton(els.themeToggle);
    render();
  });
})();
