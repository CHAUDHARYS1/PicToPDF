/* Everything PDF — freehand/shape drawing on top of the PDF page.
   Mirrors canvas-editor.js's structure (its own gesture handling +
   render loop against a store), but draws to a <canvas> instead of
   building DOM nodes, since shapes are painted pixels, not interactive
   controls. Lives entirely below the field-overlay in stacking order —
   see .draw-canvas / .field-overlay.tool-draw in styles.css for how
   pointer events get routed to whichever layer is "live". */
window.EPDF = window.EPDF || {};

EPDF.AnnotationEditor = (function () {
  const PdfRender = EPDF.PdfRender;
  const HIT_TOLERANCE_PX = 9;
  const MIN_DRAW_PX = 4; // below this, a pointerdown+up is an accidental click, not a shape
  const DEFAULT_STROKE = 2.2; // PDF points — scales with zoom, matches what actually exports
  const DEFAULT_FONT_SIZE = 16; // PDF points

  function create({ canvasEl, store, getViewport, getPageNumber }) {
    let shapeTool = 'freehand';
    let color = '#e02020';
    let isActive = false;
    let drawCtx = null;   // in-progress new shape, in screen space until commit
    let dragCtx = null;   // { shapeId, liveShape } — in-progress move of an existing shape
    let textInputEl = null;
    let activeGestureTeardown = null;

    function currentViewport() {
      const vp = getViewport();
      if (!vp) throw new Error('AnnotationEditor: no viewport available yet');
      return vp;
    }

    function overlayPoint(e) {
      const rect = canvasEl.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function accentColor() {
      return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4338ca';
    }

    // ── sizing + render ─────────────────────────────────────────────

    function layout() {
      const viewport = getViewport();
      if (!viewport) return;
      const outputScale = window.devicePixelRatio || 1;
      const cssW = Math.floor(viewport.width);
      const cssH = Math.floor(viewport.height);
      canvasEl.width = Math.floor(cssW * outputScale);
      canvasEl.height = Math.floor(cssH * outputScale);
      canvasEl.style.width = cssW + 'px';
      canvasEl.style.height = cssH + 'px';
      redraw();
    }

    function redraw() {
      const viewport = getViewport();
      if (!viewport) return;
      const ctx = canvasEl.getContext('2d');
      const outputScale = window.devicePixelRatio || 1;
      ctx.setTransform(outputScale, 0, 0, outputScale, 0, 0);
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      const page = getPageNumber();
      const shapes = store.byPage(page);
      const selected = store.getSelected();

      shapes.forEach((s) => {
        const isSelected = selected && selected.id === s.id;
        const toDraw = (dragCtx && dragCtx.shapeId === s.id) ? dragCtx.liveShape : s;
        drawShape(ctx, viewport, toDraw);
        if (isSelected) drawSelectionRing(ctx, viewport, toDraw);
      });

      if (drawCtx) drawLiveShape(ctx, viewport, drawCtx);
    }

    function drawShape(ctx, viewport, shape) {
      ctx.save();
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      ctx.lineWidth = (shape.strokeWidth || DEFAULT_STROKE) * viewport.scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (shape.type === 'freehand') {
        const pts = shape.points.map((p) => PdfRender.pdfPointToScreen(viewport, p.x, p.y));
        ctx.beginPath();
        pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      } else if (shape.type === 'arrow' || shape.type === 'line') {
        const p1 = PdfRender.pdfPointToScreen(viewport, shape.x1, shape.y1);
        const p2 = PdfRender.pdfPointToScreen(viewport, shape.x2, shape.y2);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        if (shape.type === 'arrow') drawArrowhead(ctx, p1, p2, Math.max(10, ctx.lineWidth * 3.5));
      } else if (shape.type === 'rect') {
        const box = PdfRender.rectToScreen(viewport, shape);
        ctx.strokeRect(box.left, box.top, box.width, box.height);
      } else if (shape.type === 'ellipse') {
        const box = PdfRender.rectToScreen(viewport, shape);
        ctx.beginPath();
        ctx.ellipse(box.left + box.width / 2, box.top + box.height / 2, Math.max(box.width, 0) / 2, Math.max(box.height, 0) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape.type === 'text') {
        const p = PdfRender.pdfPointToScreen(viewport, shape.x, shape.y);
        const sizePx = (shape.fontSize || DEFAULT_FONT_SIZE) * viewport.scale;
        ctx.font = `700 ${sizePx}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(shape.text, p.x, p.y);
      }
      ctx.restore();
    }

    function drawArrowhead(ctx, p1, p2, size) {
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - size * Math.cos(angle - Math.PI / 6), p2.y - size * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - size * Math.cos(angle + Math.PI / 6), p2.y - size * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }

    function drawSelectionRing(ctx, viewport, shape) {
      const box = shapeScreenBounds(viewport, shape);
      ctx.save();
      ctx.strokeStyle = accentColor();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      const pad = 6;
      ctx.strokeRect(box.left - pad, box.top - pad, box.width + pad * 2, box.height + pad * 2);
      ctx.restore();
    }

    // Draws an in-progress shape directly from screen coordinates — no PDF
    // round-trip needed until the gesture actually commits.
    function drawLiveShape(ctx, viewport, live) {
      ctx.save();
      ctx.strokeStyle = live.color;
      ctx.lineWidth = DEFAULT_STROKE * viewport.scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([5, 4]);

      if (live.type === 'freehand') {
        ctx.setLineDash([]);
        ctx.beginPath();
        live.screenPoints.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.stroke();
      } else if (live.type === 'arrow' || live.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(live.screenStart.x, live.screenStart.y);
        ctx.lineTo(live.screenEnd.x, live.screenEnd.y);
        ctx.stroke();
      } else if (live.type === 'rect') {
        const x = Math.min(live.screenStart.x, live.screenEnd.x);
        const y = Math.min(live.screenStart.y, live.screenEnd.y);
        ctx.strokeRect(x, y, Math.abs(live.screenEnd.x - live.screenStart.x), Math.abs(live.screenEnd.y - live.screenStart.y));
      } else if (live.type === 'ellipse') {
        const x = Math.min(live.screenStart.x, live.screenEnd.x);
        const y = Math.min(live.screenStart.y, live.screenEnd.y);
        const w = Math.abs(live.screenEnd.x - live.screenStart.x);
        const h = Math.abs(live.screenEnd.y - live.screenStart.y);
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    function shapeScreenBounds(viewport, shape) {
      if (shape.type === 'rect' || shape.type === 'ellipse') return PdfRender.rectToScreen(viewport, shape);
      if (shape.type === 'arrow' || shape.type === 'line') {
        const p1 = PdfRender.pdfPointToScreen(viewport, shape.x1, shape.y1);
        const p2 = PdfRender.pdfPointToScreen(viewport, shape.x2, shape.y2);
        const left = Math.min(p1.x, p2.x), top = Math.min(p1.y, p2.y);
        return { left, top, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
      }
      if (shape.type === 'freehand') {
        const pts = shape.points.map((p) => PdfRender.pdfPointToScreen(viewport, p.x, p.y));
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const left = Math.min(...xs), top = Math.min(...ys);
        return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
      }
      if (shape.type === 'text') {
        const p = PdfRender.pdfPointToScreen(viewport, shape.x, shape.y);
        const sizePx = (shape.fontSize || DEFAULT_FONT_SIZE) * viewport.scale;
        const approxW = sizePx * 0.6 * (shape.text || '').length;
        return { left: p.x, top: p.y, width: approxW, height: sizePx };
      }
      return { left: 0, top: 0, width: 0, height: 0 };
    }

    // ── hit testing (select tool) ────────────────────────────────────

    function distToSegment(px, py, a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - a.x, py - a.y);
      let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    }

    function hitTestOne(viewport, shape, sx, sy) {
      if (shape.type === 'rect' || shape.type === 'ellipse') {
        const box = PdfRender.rectToScreen(viewport, shape);
        return sx >= box.left - HIT_TOLERANCE_PX && sx <= box.left + box.width + HIT_TOLERANCE_PX &&
               sy >= box.top - HIT_TOLERANCE_PX && sy <= box.top + box.height + HIT_TOLERANCE_PX;
      }
      if (shape.type === 'arrow' || shape.type === 'line') {
        const p1 = PdfRender.pdfPointToScreen(viewport, shape.x1, shape.y1);
        const p2 = PdfRender.pdfPointToScreen(viewport, shape.x2, shape.y2);
        return distToSegment(sx, sy, p1, p2) <= HIT_TOLERANCE_PX;
      }
      if (shape.type === 'freehand') {
        const pts = shape.points.map((p) => PdfRender.pdfPointToScreen(viewport, p.x, p.y));
        for (let i = 0; i < pts.length - 1; i++) {
          if (distToSegment(sx, sy, pts[i], pts[i + 1]) <= HIT_TOLERANCE_PX) return true;
        }
        return false;
      }
      if (shape.type === 'text') {
        const b = shapeScreenBounds(viewport, shape);
        return sx >= b.left - HIT_TOLERANCE_PX && sx <= b.left + b.width + HIT_TOLERANCE_PX &&
               sy >= b.top - HIT_TOLERANCE_PX && sy <= b.top + b.height + HIT_TOLERANCE_PX;
      }
      return false;
    }

    function hitTest(shapes, sx, sy, viewport) {
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitTestOne(viewport, shapes[i], sx, sy)) return shapes[i];
      }
      return null;
    }

    function translateShape(shape, dx, dy) {
      if (shape.type === 'freehand') return { ...shape, points: shape.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      if (shape.type === 'arrow' || shape.type === 'line') return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
      if (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'text') return { ...shape, x: shape.x + dx, y: shape.y + dy };
      return shape;
    }

    // ── gesture handling ────────────────────────────────────────────

    function beginWindowTracking(move, up) {
      function onMove(e) { move(e); }
      function onUp(e) { teardown(); up(e); }
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

    function beginMove(shape, startScreen) {
      const viewport = currentViewport();
      const startPdf = PdfRender.screenPointToPdf(viewport, startScreen.x, startScreen.y);
      beginWindowTracking(
        (moveEvt) => {
          const p = overlayPoint(moveEvt);
          const nowPdf = PdfRender.screenPointToPdf(viewport, p.x, p.y);
          const dx = nowPdf.x - startPdf.x, dy = nowPdf.y - startPdf.y;
          dragCtx = { shapeId: shape.id, liveShape: translateShape(shape, dx, dy) };
          redraw();
        },
        () => {
          if (dragCtx) store.update(dragCtx.shapeId, dragCtx.liveShape);
          dragCtx = null;
          redraw();
        }
      );
    }

    function commitDraw(page, viewport) {
      if (drawCtx.type === 'freehand') {
        if (drawCtx.screenPoints.length < 2) return;
        const points = drawCtx.screenPoints.map((p) => PdfRender.screenPointToPdf(viewport, p.x, p.y));
        store.add({ page, type: 'freehand', color: drawCtx.color, points, strokeWidth: DEFAULT_STROKE });
        return;
      }
      const s = drawCtx.screenStart, en = drawCtx.screenEnd;
      if (Math.hypot(en.x - s.x, en.y - s.y) < MIN_DRAW_PX) return;
      if (drawCtx.type === 'arrow' || drawCtx.type === 'line') {
        const p1 = PdfRender.screenPointToPdf(viewport, s.x, s.y);
        const p2 = PdfRender.screenPointToPdf(viewport, en.x, en.y);
        store.add({ page, type: drawCtx.type, color: drawCtx.color, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, strokeWidth: DEFAULT_STROKE });
      } else {
        const box = { left: Math.min(s.x, en.x), top: Math.min(s.y, en.y), width: Math.abs(en.x - s.x), height: Math.abs(en.y - s.y) };
        const rect = PdfRender.screenToRect(viewport, box);
        store.add({ page, type: drawCtx.type, color: drawCtx.color, x: rect.x, y: rect.y, w: rect.w, h: rect.h, strokeWidth: DEFAULT_STROKE });
      }
    }

    function openTextInput(startScreen, pdfPt, page) {
      if (textInputEl) { textInputEl.remove(); textInputEl = null; }
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'draw-text-input';
      input.style.left = startScreen.x + 'px';
      input.style.top = startScreen.y + 'px';
      input.style.color = color;
      canvasEl.parentElement.appendChild(input);
      textInputEl = input;
      input.focus();

      let committed = false;
      function commit() {
        if (committed) return;
        committed = true;
        const text = input.value.trim();
        input.remove();
        if (textInputEl === input) textInputEl = null;
        if (text) store.add({ page, type: 'text', color, x: pdfPt.x, y: pdfPt.y, text, fontSize: DEFAULT_FONT_SIZE });
      }
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); input.value = ''; input.blur(); }
      });
    }

    function onPointerDown(e) {
      if (!isActive) return;
      if (e.button !== undefined && e.button !== 0) return;
      const viewport = getViewport();
      if (!viewport) return;
      const start = overlayPoint(e);
      const page = getPageNumber();

      if (shapeTool === 'select') {
        const hit = hitTest(store.byPage(page), start.x, start.y, viewport);
        if (hit) {
          store.select(hit.id);
          beginMove(hit, start);
        } else {
          store.select(null);
        }
        return;
      }

      if (shapeTool === 'text') {
        e.preventDefault();
        const pdfPt = PdfRender.screenPointToPdf(viewport, start.x, start.y);
        openTextInput(start, pdfPt, page);
        return;
      }

      e.preventDefault();
      drawCtx = shapeTool === 'freehand'
        ? { type: 'freehand', color, screenPoints: [start] }
        : { type: shapeTool, color, screenStart: start, screenEnd: start };
      redraw();

      beginWindowTracking(
        (moveEvt) => {
          const p = overlayPoint(moveEvt);
          if (drawCtx.type === 'freehand') drawCtx.screenPoints.push(p);
          else drawCtx.screenEnd = p;
          redraw();
        },
        () => {
          commitDraw(page, viewport);
          drawCtx = null;
          redraw();
        }
      );
    }

    function onKeyDown(e) {
      if (!isActive) return;
      const active = document.activeElement;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) {
        const selected = store.getSelected();
        if (selected) store.remove(selected.id);
      }
      if (e.key === 'Escape' && activeGestureTeardown) {
        activeGestureTeardown();
        drawCtx = null;
        dragCtx = null;
        redraw();
      }
    }

    canvasEl.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    store.subscribe(() => redraw());

    function setShape(next) {
      shapeTool = next;
      canvasEl.classList.toggle('select-mode', shapeTool === 'select');
    }

    function setColor(next) { color = next; }

    function setActive(active) {
      isActive = active;
      canvasEl.classList.toggle('active', active);
    }

    function destroy() {
      canvasEl.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      if (textInputEl) { textInputEl.remove(); textInputEl = null; }
    }

    return { layout, redraw, setShape, setColor, setActive, destroy };
  }

  return { create };
})();
