# pics2pdf

A fast, private, browser-based tool that converts JPG and PNG images into a polished PDF — no uploads, no accounts, no server.

**[pics2pdf.netlify.app](https://pics2pdf.netlify.app/)**

---

## Features

- **Drag & drop** images or click to browse — JPEG and PNG accepted
- **Reorder** thumbnails by dragging
- **Rotate** individual images or all at once
- **Page settings** — Letter, A4, or Legal · Portrait or Landscape · None / Small / Medium / Large margins
- **Fit modes** — Contain (letterbox), Fill (crop to fill), or Stretch
- **Page numbers** — optional, auto-positioned
- **Logo embed** — upload a PNG/SVG logo, optionally save it for future sessions
- **Custom filename** — name your PDF before downloading
- **Density toggle** — S / M / L thumbnail grid sizes, remembered across sessions
- **PDF preview** — see a scaled page layout before generating
- **100% client-side** — images and settings never leave your device

---

## Tech Stack

| Layer | Detail |
|---|---|
| Language | Vanilla HTML / CSS / JS (single file, no build step) |
| PDF engine | [pdf-lib](https://pdf-lib.js.org/) 1.17.1 via CDN |
| Icons | [Phosphor Icons](https://phosphoricons.com/) via CDN |
| Hosting | Netlify (auto-deploy on push to `main`) |

---

## Local Development

No build tools required — just open the file.

```bash
# Clone the repo
git clone https://github.com/CHAUDHARYS1/PicToPDF.git
cd PicToPDF

# Open in your browser (any local server works, or just open the file directly)
open index.html
```

All feature work happens on the `develop` branch; `main` is the production branch that Netlify deploys from.

---

## Privacy

Nothing is uploaded or transmitted. All image processing and PDF generation runs entirely in your browser using the [pdf-lib](https://pdf-lib.js.org/) library. The only data ever written to localStorage is your density preference and (if you opt in) your logo image.

---

## Built and managed by SC Design & Consultation
