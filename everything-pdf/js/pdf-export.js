/* Everything PDF — pdf-lib export (flatten / keep-editable).
   Field rects are already PDF user-space points (bottom-left origin), so no
   coordinate conversion is needed here — pdf-lib uses the same space. */
window.EPDF = window.EPDF || {};

EPDF.PdfExport = (function () {
  const TEXT_COLOR = [0.11, 0.11, 0.1];

  function displayValue(field) {
    return (field.value || '').toString();
  }

  /** A select field stores its current value as the option's export value
   *  (e.g. "NY"), not its human-readable label (e.g. "New York") — look the
   *  label up for anything meant to be read directly off the page. */
  function selectDisplayText(field) {
    const opt = (field.options || []).find((o) => o.value === field.value);
    return opt ? opt.label : displayValue(field);
  }

  function fontSizeFor(rect) {
    return Math.max(6, Math.min(11, rect.h * 0.65));
  }

  function hexToRgbComponents(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /** Draws a checkmark (short down-stroke + longer up-stroke) as two vector
   *  lines rather than text — the standard 14 fonts have no check-mark
   *  glyph, so drawing one as a character (e.g. "X") is a poor stand-in and
   *  doesn't read as a checked box the way this app's own checkbox input
   *  does on screen. Proportioned relative to the field rect so it scales
   *  with however big the box was drawn. */
  function drawCheckmark(page, rect, color) {
    const { LineCapStyle } = PDFLib;
    const { x, y, w, h } = rect;
    const short = Math.min(w, h);
    const thickness = Math.max(1.2, short * 0.14);
    const p1 = { x: x + w * 0.16, y: y + h * 0.5 };
    const p2 = { x: x + w * 0.42, y: y + h * 0.2 };
    const p3 = { x: x + w * 0.84, y: y + h * 0.78 };
    [[p1, p2], [p2, p3]].forEach(([start, end]) => {
      page.drawLine({ start, end, thickness, color, lineCap: LineCapStyle.Round });
    });
  }

  /** Bakes freehand/shape annotations directly onto each page's content
   *  stream — same shape shapes as annotations.js, same PDF-point space
   *  as field rects, so no coordinate conversion is needed here either. */
  function drawAnnotations(pages, annotations, rgb) {
    (annotations || []).forEach((shape) => {
      const page = pages[shape.page - 1];
      if (!page) return;
      const color = rgb(...hexToRgbComponents(shape.color || '#1c1d1a'));
      const thickness = shape.strokeWidth || 2.2;

      if (shape.type === 'freehand') {
        for (let i = 0; i < shape.points.length - 1; i++) {
          page.drawLine({ start: shape.points[i], end: shape.points[i + 1], thickness, color });
        }
      } else if (shape.type === 'arrow') {
        const p1 = { x: shape.x1, y: shape.y1 };
        const p2 = { x: shape.x2, y: shape.y2 };
        page.drawLine({ start: p1, end: p2, thickness, color });
        const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
        const headLen = Math.max(8, thickness * 4);
        [angle - Math.PI / 6, angle + Math.PI / 6].forEach((a) => {
          page.drawLine({
            start: p2,
            end: { x: p2.x - headLen * Math.cos(a), y: p2.y - headLen * Math.sin(a) },
            thickness,
            color,
          });
        });
      } else if (shape.type === 'rect') {
        page.drawRectangle({ x: shape.x, y: shape.y, width: shape.w, height: shape.h, borderColor: color, borderWidth: thickness });
      } else if (shape.type === 'ellipse') {
        page.drawEllipse({
          x: shape.x + shape.w / 2, y: shape.y + shape.h / 2,
          xScale: Math.abs(shape.w) / 2, yScale: Math.abs(shape.h) / 2,
          borderColor: color, borderWidth: thickness,
        });
      } else if (shape.type === 'text') {
        const fontSize = shape.fontSize || 16;
        page.drawText(shape.text, { x: shape.x, y: shape.y - fontSize, size: fontSize, color });
      }
    });
  }

  /** `rotations` is an array of { page, degrees } — one entry per page that
   *  has a nonzero user-applied rotation (see app.js's state.pageRotations). */
  function applyRotation(pages, rotations) {
    (rotations || []).forEach((rotation) => {
      if (!rotation || !rotation.degrees) return;
      const page = pages[rotation.page - 1];
      if (!page) return;
      const current = page.getRotation().angle;
      page.setRotation(PDFLib.degrees((current + rotation.degrees) % 360));
    });
  }

  /** Removes every real AcroForm widget already in the source PDF (if any —
   *  e.g. a PDF that had genuine fillable fields, auto-detected on load into
   *  this app's own field-model). Their live values never get synced back
   *  into the AcroForm as the user types, so if left in place they survive
   *  export as blank, on-top, interactive widgets that hide/obscure
   *  whatever flattenAndExport draws underneath — the exported PDF would
   *  *look* filled out but the fields are the same empty AcroForm ones
   *  Acrobat renders. Safe to call even when the source has no form.
   *
   *  Deliberately does this at the raw annotation level (strip every
   *  Widget from each page's /Annots, drop /AcroForm from the catalog)
   *  rather than via pdf-lib's own form.removeField() — that helper
   *  resolves each widget's existing appearance stream to garbage-collect
   *  it, and throws on a widget that has no /AP (a real, if less common,
   *  shape for a fillable field to be in) instead of just skipping it. */
  function stripExistingFormFields(pdfDoc) {
    const { PDFName } = PDFLib;
    pdfDoc.getPages().forEach((page) => {
      const annots = page.node.Annots();
      if (!annots) return;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const annot = pdfDoc.context.lookupMaybe(annots.get(i), PDFLib.PDFDict);
        if (annot && annot.get(PDFName.of('Subtype')) === PDFName.of('Widget')) {
          annots.remove(i);
        }
      }
    });
    pdfDoc.catalog.delete(PDFName.of('AcroForm'));
  }

  /** Draws every field's value directly onto the page content stream —
   *  burned in, uneditable. */
  async function flattenAndExport(pdfBytes, fields, annotations, rotations) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    stripExistingFormFields(pdfDoc);
    applyRotation(pages, rotations);
    drawAnnotations(pages, annotations, rgb);

    fields.forEach((field) => {
      const page = pages[field.page - 1];
      if (!page) return;
      const { x, y, w, h } = field.rect;

      if (field.type === 'checkbox' || field.type === 'radio') {
        if (field.value === 'true') {
          drawCheckmark(page, field.rect, rgb(...TEXT_COLOR));
        }
        return;
      }

      const value = field.type === 'select' ? selectDisplayText(field) : displayValue(field);
      if (!value) return;
      const fontSize = fontSizeFor(field.rect);
      page.drawText(value, {
        x: x + 4,
        y: y + (h - fontSize) / 2 + fontSize * 0.15,
        size: fontSize,
        font,
        color: rgb(...TEXT_COLOR),
      });
    });

    return pdfDoc.save();
  }

  /** Creates real AcroForm widgets so the PDF stays fillable. Any AcroForm
   *  widgets already in the source (see stripExistingFormFields above) are
   *  removed first — this app's field-model is the sole source of truth for
   *  a field's value, so re-creating fresh widgets from it avoids leaving a
   *  duplicate, stale-valued widget stacked on top of (or under) the new one. */
  async function exportEditable(pdfBytes, fields, annotations, rotations) {
    const { PDFDocument, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    stripExistingFormFields(pdfDoc);
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();

    applyRotation(pages, rotations);
    drawAnnotations(pages, annotations, rgb);

    // Radio options share one pdf-lib PDFRadioGroup object (unlike every
    // other type, which gets its own independent widget) — collect them by
    // group name first and create each group once, after the main pass.
    const radioGroups = new Map(); // name -> field[]

    fields.forEach((field) => {
      if (field.type === 'radio') {
        if (!radioGroups.has(field.name)) radioGroups.set(field.name, []);
        radioGroups.get(field.name).push(field);
        return;
      }

      const page = pages[field.page - 1];
      if (!page) return;
      const { x, y, w, h } = field.rect;
      const widgetName = `${field.name || 'Field'}_${field.id}`;

      if (field.type === 'checkbox') {
        const cb = form.createCheckBox(widgetName);
        cb.addToPage(page, { x, y, width: w, height: h });
        if (field.value === 'true') cb.check();
        return;
      }

      if (field.type === 'select') {
        const dd = form.createDropdown(widgetName);
        dd.addToPage(page, { x, y, width: w, height: h });
        const optionValues = (field.options || []).map((o) => o.value);
        if (optionValues.length) dd.addOptions(optionValues);
        const value = displayValue(field);
        if (value && optionValues.includes(value)) dd.select(value);
        return;
      }

      const tf = form.createTextField(widgetName);
      tf.addToPage(page, { x, y, width: w, height: h, borderWidth: 0 });
      const value = displayValue(field);
      if (value) tf.setText(value);
    });

    radioGroups.forEach((groupFields, name) => {
      const radio = form.createRadioGroup(`${name || 'Field'}_${groupFields[0].id}`);
      let selectedOption = null;
      groupFields.forEach((field) => {
        const page = pages[field.page - 1];
        if (!page) return;
        const { x, y, w, h } = field.rect;
        // field.id (not field.name, which every option in the group shares)
        // is what distinguishes each option's own on-state in the PDF.
        radio.addOptionToPage(field.id, page, { x, y, width: w, height: h });
        if (field.value === 'true') selectedOption = field.id;
      });
      if (selectedOption) radio.select(selectedOption);
    });

    return pdfDoc.save();
  }

  return { flattenAndExport, exportEditable };
})();
