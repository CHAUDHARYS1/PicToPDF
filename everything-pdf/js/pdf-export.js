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

  /** Draws every field's value directly onto the page content stream —
   *  burned in, uneditable. There are no AcroForm widgets to strip here
   *  since this app never creates real form fields for a flattened export;
   *  fields placed/detected by the editor are a UI-layer concept until
   *  exportEditable() below turns them into real widgets. */
  async function flattenAndExport(pdfBytes, fields) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

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
  async function exportEditable(pdfBytes, fields) {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const form = pdfDoc.getForm();
    const pages = pdfDoc.getPages();

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
