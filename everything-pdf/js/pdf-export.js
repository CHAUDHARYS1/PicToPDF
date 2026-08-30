/* Everything PDF — pdf-lib export (flatten / keep-editable).
   Field rects are already PDF user-space points (bottom-left origin), so no
   coordinate conversion is needed here — pdf-lib uses the same space. */
window.EPDF = window.EPDF || {};

EPDF.PdfExport = (function () {
  const TEXT_COLOR = [0.11, 0.11, 0.1];

  function displayValue(field) {
    return (field.value || '').toString();
  }

  function fontSizeFor(rect) {
    return Math.max(6, Math.min(11, rect.h * 0.65));
  }

  function hexToRgbComponents(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
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

  function applyRotation(pages, rotation) {
    if (!rotation || !rotation.degrees) return;
    const page = pages[rotation.page - 1];
    if (!page) return;
    const current = page.getRotation().angle;
    page.setRotation(PDFLib.degrees((current + rotation.degrees) % 360));
  }

  /** Draws every field's value directly onto the page content stream —
   *  burned in, uneditable. There are no AcroForm widgets to strip here
   *  since this app never creates real form fields for a flattened export;
   *  fields placed/detected by the editor are a UI-layer concept until
   *  exportEditable() below turns them into real widgets. */
  async function flattenAndExport(pdfBytes, fields, annotations, rotation) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    applyRotation(pages, rotation);
    drawAnnotations(pages, annotations, rgb);

    fields.forEach((field) => {
      const page = pages[field.page - 1];
      if (!page) return;
      const { x, y, w, h } = field.rect;

      if (field.type === 'checkbox') {
        if (field.value === 'true') {
          const size = Math.min(w, h) * 0.7;
          page.drawText('X', {
            x: x + (w - size * 0.6) / 2,
            y: y + (h - size) / 2,
            size,
            font,
            color: rgb(...TEXT_COLOR),
          });
        }
        return;
      }

      const value = displayValue(field);
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

  /** Creates real AcroForm widgets so the PDF stays fillable. */
  async function exportEditable(pdfBytes, fields, annotations, rotation) {
    const { PDFDocument, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();

    applyRotation(pages, rotation);
    drawAnnotations(pages, annotations, rgb);

    fields.forEach((field) => {
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

      const tf = form.createTextField(widgetName);
      tf.addToPage(page, { x, y, width: w, height: h, borderWidth: 0 });
      const value = displayValue(field);
      if (value) tf.setText(value);
    });

    return pdfDoc.save();
  }

  return { flattenAndExport, exportEditable };
})();
