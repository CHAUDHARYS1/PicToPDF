/* Everything PDF — pdf-lib page structural operations (duplicate/delete).
   Operates on raw PDF bytes and returns new bytes; the caller (app.js) is
   responsible for reloading the result via pdf.js and remapping every
   page-indexed piece of state (fields, annotations, rotations, the current
   page number) to match — see app.js's duplicatePage()/deletePage(). */
window.EPDF = window.EPDF || {};

EPDF.PdfPages = (function () {
  /** Returns new PDF bytes with `pageNum` (1-based) duplicated immediately
   *  after itself. */
  async function duplicatePage(pdfBytes, pageNum) {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const [copied] = await pdfDoc.copyPages(pdfDoc, [pageNum - 1]);
    pdfDoc.insertPage(pageNum, copied);
    return pdfDoc.save();
  }

  /** Returns new PDF bytes with `pageNum` (1-based) removed. Refuses to
   *  drop a document's last remaining page — callers should already be
   *  guarding this in the UI (see app.js), this is a last-resort check. */
  async function removePage(pdfBytes, pageNum) {
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(pdfBytes);
    if (pdfDoc.getPageCount() <= 1) throw new Error("Can't delete the only page.");
    pdfDoc.removePage(pageNum - 1);
    return pdfDoc.save();
  }

  return { duplicatePage, removePage };
})();
