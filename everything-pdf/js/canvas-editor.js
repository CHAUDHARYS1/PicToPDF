/* Everything PDF — canvas field editor: overlay rendering + gesture handling.
   Field DOM nodes are cached and updated in place; full rebuilds only happen
   for structural changes (add/remove/geometry/type), never for a plain
   keystroke, so typing never loses cursor position. */
window.EPDF = window.EPDF || {};

EPDF.CanvasEditor = (function () {
  const PdfRender = EPDF.PdfRender;
  const DRAG_THRESHOLD = 4; // px — below this, a pointerdown+up on a field is a click-to-edit, not a drag
  const MIN_DRAG_SIZE = 6; // px — ghost boxes smaller than this on release are discarded as accidental clicks

  function create({ overlayEl, store, getViewport }) {
    const nodes = new Map(); // fieldId -> HTMLElement
    let tool = 'select';
    let editingFieldId = null;
    let gesture = 'idle';
    let ghostEl = null;
    let dragCtx = null;      // { fieldId, startPdf, startRect, node }
    let resizeCtx = null;    // { fieldId, corner, startPdf, startRect, node }

    function currentViewport() {
      const vp = getViewport();
      if (!vp) throw new Error('CanvasEditor: no viewport available yet');
      return vp;
    }

    // ── field DOM node lifecycle ──────────────────────────────────────

    function buildNode(field) {
      const el = document.createElement('div');
      el.className = 'fld';
      el.dataset.fieldId = field.id;
      overlayEl.appendChild(el);
      return el;
    }

    function renderNodeContent(el, field, opts) {
      const isSelected = opts.selected;
      const isEditing = opts.editing;

      el.className = 'fld' +
        (field.type === 'number' ? ' num' : '') +
        (field.type === 'checkbox' ? ' checkbox' : '') +
        (isSelected ? ' active' : '') +
        (!field.value && !isEditing ? ' empty' : '');

      // Wipe and rebuild children (cheap — a handful of nodes per field).
      el.innerHTML = '';

      if (isEditing) {
        const input = document.createElement('input');
        input.type = 'text';
        if (field.type === 'number') input.setAttribute('inputmode', 'decimal');
        input.value = field.value || '';
        input.addEventListener('input', () => {
          store.update(field.id, { value: input.value });
        });
        input.addEventListener('blur', () => {
          if (editingFieldId === field.id) exitEditing();
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            input.blur();
          }
          e.stopPropagation(); // don't let Delete/Backspace while typing bubble to the field-delete handler
        });
        el.appendChild(input);
        // Focus synchronously, not via requestAnimationFrame — rAF can be
        // suspended indefinitely on a backgrounded/non-visible tab, which
        // would leave the input built but never focused.
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      } else if (field.type === 'checkbox') {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = field.value === 'true';
        cb.addEventListener('pointerdown', (e) => e.stopPropagation());
        cb.addEventListener('change', () => store.update(field.id, { value: cb.checked ? 'true' : '' }));
        el.appendChild(cb);
      } else {
        const span = document.createElement('span');
        span.textContent = field.value || '';
        span.style.overflow = 'hidden';
        span.style.textOverflow = 'ellipsis';
        span.style.whiteSpace = 'nowrap';
        el.appendChild(span);
      }

      if (isSelected) {
        ['tl', 'tr', 'bl', 'br'].forEach((corner) => {
          const h = document.createElement('div');
          h.className = 'handle ' + corner;
          h.dataset.corner = corner;
          el.appendChild(h);
        });
      }
    }

    function positionNode(el, field, viewport) {
      const box = PdfRender.rectToScreen(viewport, field.rect);
      el.style.left = box.left + 'px';
      el.style.top = box.top + 'px';
      el.style.width = box.width + 'px';
      el.style.height = box.height + 'px';
    }

    function fullLayout() {
      const viewport = currentViewport();
      const fields = store.list();
      const seen = new Set();
      const selected = store.getSelected();

      // editingFieldId only ever makes sense for the current selection — if
      // selection changed out from under an in-progress edit (click another
      // field, draw a new one, deselect), drop the stale edit state so the
      // old field doesn't keep rendering a live <input> nobody is using.
      if (editingFieldId && (!selected || selected.id !== editingFieldId)) {
        editingFieldId = null;
      }

      fields.forEach((field) => {
        seen.add(field.id);
        let el = nodes.get(field.id);
        if (!el) {
          el = buildNode(field);
          nodes.set(field.id, el);
        }
        positionNode(el, field, viewport);
        renderNodeContent(el, field, {
          selected: selected && selected.id === field.id,
          editing: editingFieldId === field.id,
        });
      });

      nodes.forEach((el, id) => {
        if (!seen.has(id)) {
          el.remove();
          nodes.delete(id);
        }
      });
    }

    function refreshOneField(fieldId) {
      const field = store.get(fieldId);
      const el = nodes.get(fieldId);
      if (!field || !el) return;
      const selected = store.getSelected();
      positionNode(el, field, currentViewport());
      renderNodeContent(el, field, {
        selected: selected && selected.id === fieldId,
        editing: editingFieldId === fieldId,
      });
    }

    function updateValueDisplay(fieldId) {
      const field = store.get(fieldId);
      const el = nodes.get(fieldId);
      if (!field || !el) return;
      if (editingFieldId === fieldId) return; // the input already shows what the user typed
      const span = el.querySelector('span');
      if (span) {
        span.textContent = field.value || '';
        el.classList.toggle('empty', !field.value);
      }
    }

    // ── store subscription ────────────────────────────────────────────

    store.subscribe((snapshot) => {
      const r = snapshot.reason;
      if (!r) return fullLayout();
      if (r.type === 'add' || r.type === 'remove') return fullLayout();
      if (r.type === 'select') return fullLayout();
      if (r.type === 'update') {
        if (r.valueOnly) updateValueDisplay(r.field.id);
        else refreshOneField(r.field.id);
        return;
      }
      fullLayout();
    });

    // ── editing mode ──────────────────────────────────────────────────

    function enterEditing(fieldId) {
      const field = store.get(fieldId);
      if (!field || field.type === 'checkbox' || field.type === 'signature') return;
      editingFieldId = fieldId;
      refreshOneField(fieldId);
    }

    function exitEditing() {
      const id = editingFieldId;
      editingFieldId = null;
      if (id) refreshOneField(id);
    }

    // ── gesture handling ────────────────────────────────────────────

    function overlayPoint(e) {
      const rect = overlayEl.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    // Only one gesture can be in flight at a time, so a single slot is
    // enough. cancelGesture() calls this to tear down the pending window
    // listeners — without it, Escape would only remove the visual ghost
    // while the original onUp handler stayed armed and still committed a
    // field on the next pointerup.
    let activeGestureTeardown = null;

    function beginWindowTracking(move, up) {
      function onMove(e) { move(e); }
      function onUp(e) {
        teardown();
        up(e);
      }
      function teardown() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (activeGestureTeardown === teardown) activeGestureTeardown = null;
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      activeGestureTeardown = teardown;
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (!getViewport()) return; // no rendered page to convert coordinates against yet
      const handleEl = e.target.closest('.handle');
      const fieldEl = e.target.closest('.fld');
      const selected = store.getSelected();

      if (handleEl && fieldEl && selected && fieldEl.dataset.fieldId === selected.id) {
        startResize(e, selected, handleEl.dataset.corner, fieldEl);
        return;
      }

      if (fieldEl) {
        const fid = fieldEl.dataset.fieldId;
        if (editingFieldId === fid) return; // already editing — let the <input> handle its own click
        // Select (if not already) and arm the same gesture: a clean click
        // enters editing immediately (one click to start typing), while a
        // click-and-drag beyond the threshold moves the field instead —
        // whether or not it was selected before this pointerdown.
        if (!selected || selected.id !== fid) store.select(fid);
        armClickOrDrag(e, fid, fieldEl);
        return;
      }

      // empty background
      if (tool === 'draw-text') {
        startDraw(e);
      } else if (tool === 'select') {
        if (editingFieldId) exitEditing();
        store.select(null);
      }
    }

    function armClickOrDrag(e, fieldId, fieldEl) {
      e.preventDefault();
      const start = overlayPoint(e);
      let moved = false;
      let dragStarted = false;

      beginWindowTracking(
        (moveEvt) => {
          const p = overlayPoint(moveEvt);
          const dx = p.x - start.x;
          const dy = p.y - start.y;
          if (!dragStarted && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
            dragStarted = true;
            moved = true;
            beginDrag(fieldId, fieldEl, start);
          }
          if (dragStarted) updateDrag(moveEvt);
        },
        (upEvt) => {
          if (dragStarted) {
            finishDrag();
          } else if (!moved) {
            enterEditing(fieldId);
          }
        }
      );
    }

    function beginDrag(fieldId, fieldEl, startScreen) {
      gesture = 'dragging';
      const field = store.get(fieldId);
      const viewport = currentViewport();
      dragCtx = {
        fieldId,
        node: fieldEl,
        startPdf: PdfRender.screenPointToPdf(viewport, startScreen.x, startScreen.y),
        startRect: { ...field.rect },
      };
    }

    function updateDrag(e) {
      if (!dragCtx) return;
      const viewport = currentViewport();
      const p = overlayPoint(e);
      const nowPdf = PdfRender.screenPointToPdf(viewport, p.x, p.y);
      const dx = nowPdf.x - dragCtx.startPdf.x;
      const dy = nowPdf.y - dragCtx.startPdf.y;
      const liveRect = { ...dragCtx.startRect, x: dragCtx.startRect.x + dx, y: dragCtx.startRect.y + dy };
      const box = PdfRender.rectToScreen(viewport, liveRect);
      dragCtx.node.style.left = box.left + 'px';
      dragCtx.node.style.top = box.top + 'px';
      dragCtx.liveRect = liveRect;
    }

    function finishDrag() {
      if (dragCtx && dragCtx.liveRect) {
        store.update(dragCtx.fieldId, { rect: dragCtx.liveRect });
      }
      dragCtx = null;
      gesture = 'idle';
    }

    function startResize(e, field, corner, fieldEl) {
      e.preventDefault();
      e.stopPropagation();
      gesture = 'resizing';
      const viewport = currentViewport();
      const start = overlayPoint(e);
      resizeCtx = {
        fieldId: field.id,
        node: fieldEl,
        corner,
        startPdf: PdfRender.screenPointToPdf(viewport, start.x, start.y),
        startRect: { ...field.rect },
      };
      beginWindowTracking(
        (moveEvt) => updateResize(moveEvt),
        () => finishResize()
      );
    }

    function updateResize(e) {
      if (!resizeCtx) return;
      const viewport = currentViewport();
      const p = overlayPoint(e);
      const nowPdf = PdfRender.screenPointToPdf(viewport, p.x, p.y);
      const dx = nowPdf.x - resizeCtx.startPdf.x;
      const dy = nowPdf.y - resizeCtx.startPdf.y;
      const r = resizeCtx.startRect;
      let { x, y, w, h } = r;

      // corner encodes which edges move; y-up PDF space means "top" edges add to y+h.
      if (resizeCtx.corner.includes('r')) w = r.w + dx;
      if (resizeCtx.corner.includes('l')) { x = r.x + dx; w = r.w - dx; }
      if (resizeCtx.corner.includes('t')) h = r.h + dy;
      if (resizeCtx.corner.includes('b')) { y = r.y + dy; h = r.h - dy; }

      const liveRect = { x, y, w: Math.max(w, 1), h: Math.max(h, 1) };
      const box = PdfRender.rectToScreen(viewport, liveRect);
      resizeCtx.node.style.left = box.left + 'px';
      resizeCtx.node.style.top = box.top + 'px';
      resizeCtx.node.style.width = box.width + 'px';
      resizeCtx.node.style.height = box.height + 'px';
      resizeCtx.liveRect = liveRect;
    }

    function finishResize() {
      if (resizeCtx && resizeCtx.liveRect) {
        try {
          store.update(resizeCtx.fieldId, { rect: resizeCtx.liveRect });
        } catch (err) {
          refreshOneField(resizeCtx.fieldId); // validation rejected (too small) — snap back
        }
      }
      resizeCtx = null;
      gesture = 'idle';
    }

    function startDraw(e) {
      e.preventDefault();
      gesture = 'drawing';
      const start = overlayPoint(e);
      ghostEl = document.createElement('div');
      ghostEl.className = 'ghost-field';
      ghostEl.style.left = start.x + 'px';
      ghostEl.style.top = start.y + 'px';
      ghostEl.style.width = '0px';
      ghostEl.style.height = '0px';
      overlayEl.appendChild(ghostEl);

      let last = start;
      beginWindowTracking(
        (moveEvt) => {
          const p = overlayPoint(moveEvt);
          last = p;
          const left = Math.min(start.x, p.x);
          const top = Math.min(start.y, p.y);
          ghostEl.style.left = left + 'px';
          ghostEl.style.top = top + 'px';
          ghostEl.style.width = Math.abs(p.x - start.x) + 'px';
          ghostEl.style.height = Math.abs(p.y - start.y) + 'px';
        },
        () => {
          const box = {
            left: Math.min(start.x, last.x),
            top: Math.min(start.y, last.y),
            width: Math.abs(last.x - start.x),
            height: Math.abs(last.y - start.y),
          };
          if (ghostEl) { ghostEl.remove(); ghostEl = null; }
          gesture = 'idle';
          if (box.width < MIN_DRAG_SIZE || box.height < MIN_DRAG_SIZE) return; // accidental click, not a field
          const viewport = currentViewport();
          const rect = PdfRender.screenToRect(viewport, box);
          const n = store.list().length + 1;
          const field = store.add({ page: 1, rect, type: 'text', name: 'Field ' + n });
          enterEditing(field.id);
        }
      );
    }

    function cancelGesture() {
      if (activeGestureTeardown) activeGestureTeardown();
      if (ghostEl) { ghostEl.remove(); ghostEl = null; }
      if (dragCtx) refreshOneField(dragCtx.fieldId);
      if (resizeCtx) refreshOneField(resizeCtx.fieldId);
      dragCtx = null;
      resizeCtx = null;
      gesture = 'idle';
    }

    function onKeyDown(e) {
      const active = document.activeElement;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

      if (e.key === 'Escape') {
        if (editingFieldId) { active.blur(); return; }
        // gesture stays 'idle' during the armed click-vs-drag disambiguation
        // window (see armClickOrDrag) even though window listeners are live,
        // so check activeGestureTeardown too, not just the gesture state.
        if (gesture !== 'idle' || activeGestureTeardown) { cancelGesture(); return; }
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        const selected = store.getSelected();
        if (selected) store.remove(selected.id);
      }
    }

    overlayEl.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    function setTool(next) {
      tool = next;
      overlayEl.classList.toggle('tool-draw-text', tool === 'draw-text');
    }

    function getTool() { return tool; }

    function layout() { fullLayout(); }

    function destroy() {
      overlayEl.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      nodes.forEach((el) => el.remove());
      nodes.clear();
    }

    return { setTool, getTool, layout, destroy };
  }

  return { create };
})();
