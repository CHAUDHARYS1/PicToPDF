/* CompressPDF — size estimation from a parsed PDF.
   Not a trial compression: walks the file's real object graph (pdf-lib)
   to find every embedded image's actual pixel dimensions, its current
   encoded byte size, and how it's encoded — all real, file-derived facts,
   not guesses — then applies a deterministic per-level model whose shape
   mirrors what compress.js actually does to each kind of image, so the
   number shown here lands in the same neighborhood as the real result:

   - 'jpeg' (Filter /DCTDecode): already compressed, so only downscaling
     helps — unchanged if already at/below the target DPI, else scaled by
     (targetDpi/effectiveDpi)^2 since JPEG size roughly tracks pixel count.
   - 'raw' (Filter /FlateDecode, 8-bit DeviceGray/RGB/CMYK, no mask): Flate
     barely compresses photographic pixel data, so compress.js always
     converts these to JPEG even with no resizing — modeled here by pixel
     count × a bytes-per-pixel figure for the level's JPEG quality, not by
     shrinking the current (bloated) byte count. The bytesPerPixel figures
     are calibrated against a synthetic scanned-document image (text lines
     + scanner noise + a small photo patch, this tool's stated use case),
     not a busy photograph — real output usually lands a bit under this
     estimate rather than over it, which is the safer direction to be wrong in.
   - anything else (CCITTFax, JPXDecode, Indexed, 16-bit, chained filters,
     masked images): compress.js leaves these untouched, so the estimate
     does too.

   Per-image effective DPI is approximated as pixelWidth / (pageWidthPt/72)
   — i.e. assuming the image spans the page's width, which holds well for
   this tool's core case (scanned/bid-doc PDFs). See
   design_handoff_compresspdf/README.md's "Estimates" section for the
   contract this exists to satisfy: reading the file, never compressing it
   to find out. */
window.CompressPDF = window.CompressPDF || {};

CompressPDF.Estimate = (function () {
  const LEVELS = {
    low: {
      label: 'Low', targetDpi: Infinity, otherFactor: 0.94,
      why: 'Images untouched. Only fonts and unused objects are stripped.',
    },
    medium: {
      label: 'Medium', targetDpi: 150, otherFactor: 0.85, bytesPerPixel: 0.09,
      why: 'Images resampled to 150 dpi. Safe for email and print at letter size.',
    },
    high: {
      label: 'High', targetDpi: 72, otherFactor: 0.80, bytesPerPixel: 0.11,
      why: 'Images resampled to 72 dpi. Photos will look soft on screen.',
    },
  };
  const LEVEL_ORDER = ['low', 'medium', 'high'];
  const MIN_IMAGE_SCALE = 0.10;
  const RAW_COLOR_SPACES = { '/DeviceGray': 1, '/DeviceRGB': 1, '/DeviceCMYK': 1 };

  /** Classifies an image XObject the same way compress.js's actual pass
   *  will treat it, so the estimate's math can mirror its behavior. */
  function classify(stream, PDFName) {
    const dict = stream.dict;
    const filter = dict.get(PDFName.of('Filter'));
    const filterStr = filter != null ? String(filter) : '';
    if (filterStr === '/DCTDecode') return 'jpeg';
    if (filterStr !== '/FlateDecode') return 'other';
    if (dict.get(PDFName.of('SMask')) || dict.get(PDFName.of('Mask'))) return 'other';
    const bpc = dict.get(PDFName.of('BitsPerComponent'));
    if (!bpc || !bpc.asNumber || bpc.asNumber() !== 8) return 'other';
    const cs = dict.lookupMaybe(PDFName.of('ColorSpace'), PDFName);
    if (!cs || !RAW_COLOR_SPACES[String(cs)]) return 'other';
    return 'raw';
  }

  /** Walks one Resources dict's /XObject entries, recursing into nested
   *  Form XObjects (a page's content can itself draw other embedded
   *  objects, each with their own Resources), collecting every distinct
   *  Image XObject into `out`. `seen` dedupes by object reference so an
   *  image reused across pages/forms is only counted once. */
  function collectImages(pdfDoc, resources, pageWidthPt, out, seen) {
    if (!resources) return;
    const { PDFName, PDFDict, PDFStream, PDFRef } = PDFLib;

    const xobjectsRef = resources.get(PDFName.of('XObject'));
    const xobjectDict = xobjectsRef && pdfDoc.context.lookupMaybe(xobjectsRef, PDFDict);
    if (!xobjectDict) return;

    xobjectDict.entries().forEach(([, ref]) => {
      if (ref instanceof PDFRef) {
        if (seen.has(ref.tag)) return;
        seen.add(ref.tag);
      }

      const stream = pdfDoc.context.lookupMaybe(ref, PDFStream);
      if (!stream) return;
      const subtype = String(stream.dict.get(PDFName.of('Subtype')) || '');

      if (subtype === '/Image') {
        const widthNum = stream.dict.get(PDFName.of('Width'));
        const heightNum = stream.dict.get(PDFName.of('Height'));
        const pixelWidth = widthNum && widthNum.asNumber ? widthNum.asNumber() : 0;
        const pixelHeight = heightNum && heightNum.asNumber ? heightNum.asNumber() : 0;
        const bytes = (stream.contents && stream.contents.length) || 0;
        if (pixelWidth > 0 && bytes > 0) {
          const effectiveDpi = pageWidthPt > 0 ? pixelWidth / (pageWidthPt / 72) : 150;
          const kind = classify(stream, PDFName);
          out.push({ bytes, effectiveDpi, kind, pixelWidth, pixelHeight });
        }
      } else if (subtype === '/Form') {
        const formResourcesRef = stream.dict.get(PDFName.of('Resources'));
        const formResources = formResourcesRef && pdfDoc.context.lookupMaybe(formResourcesRef, PDFDict);
        if (formResources) collectImages(pdfDoc, formResources, pageWidthPt, out, seen);
      }
    });
  }

  function estimateForLevel(level, images, totalBytes, totalImageBytes) {
    const newImageBytes = images.reduce((sum, im) => {
      if (level.targetDpi === Infinity) return sum + im.bytes; // Low — images untouched

      if (im.kind === 'jpeg') {
        if (im.effectiveDpi <= level.targetDpi) return sum + im.bytes;
        const scale = Math.max(MIN_IMAGE_SCALE, Math.pow(level.targetDpi / im.effectiveDpi, 2));
        return sum + im.bytes * scale;
      }

      if (im.kind === 'raw') {
        const linScale = im.effectiveDpi > level.targetDpi ? level.targetDpi / im.effectiveDpi : 1;
        const pixels = im.pixelWidth * im.pixelHeight * linScale * linScale;
        return sum + Math.max(1, pixels * level.bytesPerPixel);
      }

      return sum + im.bytes; // format compress.js doesn't touch — left as-is
    }, 0);
    const newOtherBytes = (totalBytes - totalImageBytes) * level.otherFactor;
    const resultBytes = Math.max(1, Math.round(newImageBytes + newOtherBytes));
    const savedBytes = Math.max(0, totalBytes - resultBytes);
    const savedPct = totalBytes > 0 ? Math.round((savedBytes / totalBytes) * 100) : 0;
    return { resultBytes, savedBytes, savedPct };
  }

  /** Reads `bytes` (an ArrayBuffer/Uint8Array of a PDF) and returns
   *  { pageCount, imageCount, totalBytes, estimates: {low, medium, high} }.
   *  Throws if the bytes aren't a loadable PDF (caller should catch and
   *  show the "not a PDF" / "encrypted" error state). */
  async function analyze(bytes) {
    const pdfDoc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    const pages = pdfDoc.getPages();
    const images = [];
    const seen = new Set();

    pages.forEach((page) => {
      const { width } = page.getSize();
      collectImages(pdfDoc, page.node.Resources(), width, images, seen);
    });

    const totalBytes = bytes.byteLength || bytes.length;
    const totalImageBytes = images.reduce((sum, im) => sum + im.bytes, 0);

    const estimates = {};
    LEVEL_ORDER.forEach((key) => {
      estimates[key] = estimateForLevel(LEVELS[key], images, totalBytes, totalImageBytes);
    });

    return { pageCount: pages.length, imageCount: images.length, totalBytes, estimates };
  }

  return { analyze, LEVELS, LEVEL_ORDER };
})();
