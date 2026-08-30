/* CompressPDF — the actual compression pass (not the estimate).

   Two image paths, chosen by how the image is currently encoded:
   - Plain baseline JPEG (Filter /DCTDecode, no other chained filter): only
     worth touching if it's above the level's target DPI — it's already
     compressed, so downsampling is the only lever. Decoded via the
     browser's own JPEG decoder (createImageBitmap).
   - Raw samples (Filter /FlateDecode, 8-bit DeviceGray/RGB/CMYK, no
     SMask/Mask, default Decode array): these are typically the biggest win
     in the file, because Flate barely compresses continuous-tone pixel
     data — converting to JPEG shrinks them dramatically even with *no*
     resizing, so this path always re-encodes, downsampling on top of that
     when the image is also above the target DPI. Inflated with the
     platform's own DecompressionStream (zlib/'deflate' format — no new
     dependency); if that API isn't available the image is left alone
     rather than failing the whole pass.
   Every other format (CCITTFax scans, JPXDecode, Indexed palettes, 16-bit
   samples, chained filters) is left alone rather than risk corrupting it.

   No font subsetting is attempted (that needs a font-program parser this
   project doesn't have). Instead, every level — including Low, which never
   touches images — runs a real mark-and-sweep: walk everything reachable
   from the trailer (Root/Info/Encrypt/ID) and delete every indirect object
   that isn't, the same way a browser's GC drops unreachable objects. That
   makes "unused objects removed" real rather than a copied design-mock
   number, on every level. The "other content" figure the UI shows is
   always this real removal plus pdf-lib's own object-stream compaction,
   measured from the actual output — never a canned number. */
window.CompressPDF = window.CompressPDF || {};

CompressPDF.Compress = (function () {
  const { PDFName, PDFDict, PDFArray, PDFStream, PDFRef } = PDFLib;
  const TARGET_DPI = { medium: 150, high: 72 };
  const QUALITY = { medium: 0.75, high: 0.55 };
  const RAW_COMPONENTS = { '/DeviceGray': 1, '/DeviceRGB': 3, '/DeviceCMYK': 4 };

  /** Walks one Resources dict's /XObject entries, recursing into nested
   *  Form XObjects, and records every distinct Image XObject's ref plus
   *  every (dict, nameKey) location it's drawn from — so every reference
   *  to an image can be repointed at its recompressed replacement.
   *  `seenForms` dedupes Form recursion the same way estimate.js dedupes
   *  images, so a form reused across pages isn't walked twice. */
  function collect(pdfDoc, resources, pageWidthPt, images, seenForms) {
    if (!resources) return;
    const xobjectsRef = resources.get(PDFName.of('XObject'));
    const xobjectDict = xobjectsRef && pdfDoc.context.lookupMaybe(xobjectsRef, PDFDict);
    if (!xobjectDict) return;

    xobjectDict.entries().forEach(([nameKey, ref]) => {
      const stream = pdfDoc.context.lookupMaybe(ref, PDFStream);
      if (!stream) return;
      const subtype = String(stream.dict.get(PDFName.of('Subtype')) || '');

      if (subtype === '/Image') {
        if (!(ref instanceof PDFRef)) return;
        let entry = images.get(ref.tag);
        if (!entry) {
          entry = { ref, stream, pageWidthPt, locations: [] };
          images.set(ref.tag, entry);
        }
        entry.locations.push({ dict: xobjectDict, nameKey });
      } else if (subtype === '/Form') {
        if (ref instanceof PDFRef) {
          if (seenForms.has(ref.tag)) return;
          seenForms.add(ref.tag);
        }
        const formResourcesRef = stream.dict.get(PDFName.of('Resources'));
        const formResources = formResourcesRef && pdfDoc.context.lookupMaybe(formResourcesRef, PDFDict);
        if (formResources) collect(pdfDoc, formResources, pageWidthPt, images, seenForms);
      }
    });
  }

  function isPlainJpeg(stream) {
    const filter = stream.dict.get(PDFName.of('Filter'));
    return filter != null && String(filter) === '/DCTDecode';
  }

  async function jpegToBitmap(jpegBytes) {
    const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
    return createImageBitmap(blob);
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (err) {
      return null;
    }
  }

  function hasDefaultDecode(dict, n) {
    const decode = dict.get(PDFName.of('Decode'));
    if (!decode) return true;
    if (!(decode instanceof PDFArray) || decode.size() !== n * 2) return false;
    for (let i = 0; i < n; i++) {
      const lo = decode.get(i * 2);
      const hi = decode.get(i * 2 + 1);
      if (!lo || !hi || lo.asNumber() !== 0 || hi.asNumber() !== 1) return false;
    }
    return true;
  }

  /** Inflates a raw (Flate-encoded, uncompressed-sample) image XObject and
   *  rasterizes it into an ImageData — the pixel-format prerequisite for
   *  re-encoding as JPEG. Returns null for anything outside the safely
   *  handled subset (see file header) rather than guessing. */
  async function rasterizeRawImage(stream) {
    const dict = stream.dict;
    const filter = dict.get(PDFName.of('Filter'));
    if (!filter || String(filter) !== '/FlateDecode') return null;
    if (dict.get(PDFName.of('SMask')) || dict.get(PDFName.of('Mask'))) return null;

    const bpcNum = dict.get(PDFName.of('BitsPerComponent'));
    if (!bpcNum || !bpcNum.asNumber || bpcNum.asNumber() !== 8) return null;

    const csName = dict.lookupMaybe(PDFName.of('ColorSpace'), PDFName);
    const n = csName && RAW_COMPONENTS[String(csName)];
    if (!n) return null;
    if (!hasDefaultDecode(dict, n)) return null;

    const widthNum = dict.get(PDFName.of('Width'));
    const heightNum = dict.get(PDFName.of('Height'));
    const width = widthNum && widthNum.asNumber ? widthNum.asNumber() : 0;
    const height = heightNum && heightNum.asNumber ? heightNum.asNumber() : 0;
    if (!width || !height) return null;

    const raw = await inflate(stream.contents);
    if (!raw || raw.length < width * height * n) return null;

    const rgba = new Uint8ClampedArray(width * height * 4);
    if (n === 1) {
      for (let i = 0, p = 0; i < width * height; i++, p += 4) {
        const g = raw[i];
        rgba[p] = g; rgba[p + 1] = g; rgba[p + 2] = g; rgba[p + 3] = 255;
      }
    } else if (n === 3) {
      for (let i = 0, s = 0, p = 0; i < width * height; i++, s += 3, p += 4) {
        rgba[p] = raw[s]; rgba[p + 1] = raw[s + 1]; rgba[p + 2] = raw[s + 2]; rgba[p + 3] = 255;
      }
    } else {
      for (let i = 0, s = 0, p = 0; i < width * height; i++, s += 4, p += 4) {
        const c = raw[s] / 255, m = raw[s + 1] / 255, y = raw[s + 2] / 255, k = raw[s + 3] / 255;
        rgba[p] = 255 * (1 - c) * (1 - k);
        rgba[p + 1] = 255 * (1 - m) * (1 - k);
        rgba[p + 2] = 255 * (1 - y) * (1 - k);
        rgba[p + 3] = 255;
      }
    }
    return { width, height, imageData: new ImageData(rgba, width, height) };
  }

  function drawScaled(source, srcW, srcH, outW, outH) {
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, srcW, srcH, 0, 0, outW, outH);
    return canvas;
  }

  async function canvasToJpeg(canvas, quality) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('canvas.toBlob returned null');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** Mark-and-sweep: walk every object reachable from the trailer
   *  (Root/Info/Encrypt/ID) and delete every indirect object that isn't.
   *  Safe by construction — nothing in the live document points at what
   *  gets removed. Runs on every level, including Low. */
  function removeUnreachableObjects(pdfDoc) {
    const context = pdfDoc.context;
    const seen = new Set();
    const stack = [];
    const trailer = context.trailerInfo;
    ['Root', 'Info', 'Encrypt', 'ID'].forEach((key) => {
      if (trailer[key] != null) stack.push(trailer[key]);
    });

    while (stack.length) {
      const item = stack.pop();
      if (item == null) continue;
      if (item instanceof PDFRef) {
        if (seen.has(item.tag)) continue;
        seen.add(item.tag);
        stack.push(context.lookup(item));
      } else if (item instanceof PDFStream) {
        item.dict.entries().forEach(([, v]) => stack.push(v));
      } else if (item instanceof PDFDict) {
        item.entries().forEach(([, v]) => stack.push(v));
      } else if (item instanceof PDFArray) {
        for (let i = 0; i < item.size(); i++) stack.push(item.get(i));
      }
    }

    let removed = 0;
    context.enumerateIndirectObjects().forEach(([ref]) => {
      if (!seen.has(ref.tag)) {
        context.delete(ref);
        removed += 1;
      }
    });
    return removed;
  }

  /** Runs the real compression pass against `bytes` (an ArrayBuffer/
   *  Uint8Array of the original PDF) for `level` ('low'|'medium'|'high'),
   *  reporting progress via `onProgress(done, total)`. Resolves with
   *  { outBytes, report } where report is entirely derived from the real
   *  before/after byte counts — { imagesResampled, imagesConverted,
   *  imageBytesBefore, imageBytesAfter, totalBefore, totalAfter }. */
  async function run(bytes, level, onProgress) {
    const pdfDoc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
    const pages = pdfDoc.getPages();
    const images = new Map();
    const seenForms = new Set();

    pages.forEach((page) => {
      const { width } = page.getSize();
      collect(pdfDoc, page.node.Resources(), width, images, seenForms);
    });

    const totalBefore = bytes.byteLength || bytes.length;
    let imageBytesBefore = 0;
    images.forEach((entry) => {
      imageBytesBefore += (entry.stream.contents && entry.stream.contents.length) || 0;
    });

    let imagesResampled = 0;
    let imagesConverted = 0;
    let imageBytesAfter = imageBytesBefore;

    if (level !== 'low') {
      const targetDpi = TARGET_DPI[level];
      const quality = QUALITY[level];
      const entries = Array.from(images.values());

      for (let i = 0; i < entries.length; i++) {
        if (onProgress) onProgress(i, entries.length);
        const entry = entries[i];
        const oldBytes = entry.stream.contents;
        if (!oldBytes || !oldBytes.length) continue;

        try {
          let newBytes = null;
          let didResize = false;

          if (isPlainJpeg(entry.stream)) {
            const widthNum = entry.stream.dict.get(PDFName.of('Width'));
            const pixelWidth = widthNum && widthNum.asNumber ? widthNum.asNumber() : 0;
            if (!pixelWidth) continue;
            const effectiveDpi = entry.pageWidthPt > 0 ? pixelWidth / (entry.pageWidthPt / 72) : 150;
            if (effectiveDpi <= targetDpi) continue; // already JPEG at an acceptable size — nothing to gain

            const bitmap = await jpegToBitmap(oldBytes);
            try {
              const scale = targetDpi / effectiveDpi;
              const outW = Math.max(1, Math.round(bitmap.width * scale));
              const outH = Math.max(1, Math.round(bitmap.height * scale));
              const canvas = drawScaled(bitmap, bitmap.width, bitmap.height, outW, outH);
              newBytes = await canvasToJpeg(canvas, quality);
              didResize = true;
            } finally {
              if (bitmap.close) bitmap.close();
            }
          } else {
            // Raw/uncompressed-sample image: Flate barely compresses this,
            // so converting to JPEG is a big win even with no resizing —
            // always re-encode, and resize on top if it's also oversized.
            const raster = await rasterizeRawImage(entry.stream);
            if (!raster) continue;
            const effectiveDpi = entry.pageWidthPt > 0 ? raster.width / (entry.pageWidthPt / 72) : 150;
            const scale = effectiveDpi > targetDpi ? targetDpi / effectiveDpi : 1;
            const fullCanvas = document.createElement('canvas');
            fullCanvas.width = raster.width;
            fullCanvas.height = raster.height;
            fullCanvas.getContext('2d').putImageData(raster.imageData, 0, 0);
            const outW = Math.max(1, Math.round(raster.width * scale));
            const outH = Math.max(1, Math.round(raster.height * scale));
            const canvas = scale < 1 ? drawScaled(fullCanvas, raster.width, raster.height, outW, outH) : fullCanvas;
            newBytes = await canvasToJpeg(canvas, quality);
            didResize = scale < 1;
          }

          if (!newBytes || newBytes.length >= oldBytes.length) continue;

          const newImage = await pdfDoc.embedJpg(newBytes);
          entry.locations.forEach((loc) => loc.dict.set(loc.nameKey, newImage.ref));
          pdfDoc.context.delete(entry.ref);

          imageBytesAfter += newBytes.length - oldBytes.length;
          if (didResize) imagesResampled += 1;
          else imagesConverted += 1;
        } catch (err) {
          console.warn('compresspdf: skipped an image it could not safely recompress', err);
        }
      }
      if (onProgress) onProgress(entries.length, entries.length);
    }

    removeUnreachableObjects(pdfDoc);
    const outBytes = await pdfDoc.save();

    return {
      outBytes,
      report: {
        imagesResampled,
        imagesConverted,
        imageBytesBefore,
        imageBytesAfter,
        totalBefore,
        totalAfter: outBytes.length,
      },
    };
  }

  return { run };
})();
