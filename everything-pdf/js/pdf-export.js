/* Everything PDF — pdf-lib export (flatten / keep-editable).
   STUB for Milestone 1 — real implementation lands in Milestone 4 (export
   options sheet). Signatures exist now so app.js has a discoverable hook. */
window.EPDF = window.EPDF || {};

EPDF.PdfExport = (function () {
  /** Draws every field's value onto the page content stream and removes the
   *  widget annotations, producing a flattened, uneditable PDF. */
  async function flattenAndExport(pdfBytes, template) {
    throw new Error('EPDF.PdfExport.flattenAndExport: not implemented until Milestone 4');
  }

  /** Writes field values into a fillable AcroForm PDF; stays editable. */
  async function exportEditable(pdfBytes, template) {
    throw new Error('EPDF.PdfExport.exportEditable: not implemented until Milestone 4');
  }

  return { flattenAndExport, exportEditable };
})();
