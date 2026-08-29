# Everything PDF

A small suite of fast, private, browser-based PDF tools — no uploads, no accounts,
no server. This repo's root (`index.html`) is the suite home page; pick a tool from
there, or jump straight to a product below.

---

## Products

| Product | What it does | Path |
|---|---|---|
| **pics2pdf** | Turn JPG/PNG photos into a polished PDF | [`pics2pdf/`](pics2pdf/) |
| **PDF Editor** | Drop in any PDF, place/fill fields, sign, export | [`everything-pdf/`](everything-pdf/) |

Each product has its own README with feature details and its own tech stack notes.

---

## Tech Stack

| Layer | Detail |
|---|---|
| Language | Vanilla HTML / CSS / JS, no build step, no framework |
| PDF engines | [pdf-lib](https://pdf-lib.js.org/) (write), [pdf.js](https://mozilla.github.io/pdf.js/) (render, editor only) — via CDN |
| Icons | [Phosphor Icons](https://phosphoricons.com/) via CDN |
| Hosting | Netlify (auto-deploy on push to `main`) |

---

## Local Development

No build tools required.

```bash
git clone https://github.com/CHAUDHARYS1/PicToPDF.git
cd PicToPDF

# Open the suite home page directly, or serve the folder locally
open index.html
```

All feature work happens on the `develop` branch; `main` is the production branch that
Netlify deploys from.

---

## Privacy

Nothing is uploaded or transmitted by any product in this suite. All processing runs
entirely in your browser.

---

## Built and managed by SC Design & Consultation
