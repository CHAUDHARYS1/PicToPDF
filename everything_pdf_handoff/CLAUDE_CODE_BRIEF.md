# Everything PDF — build brief for Claude Code

You are implementing the front end of **Everything PDF**, a browser-based PDF editor.
Visual reference: `reference-screens.html` (open it — six annotated frames on one canvas)
and the PNGs in `screens/`. Match the reference closely; it is the design contract.

## What the product does

Core flow: drop any PDF → place text fields anywhere (or fill fields the PDF already has)
→ type → add a signature → export a flattened PDF.

It must work on **any** PDF. Nothing about the seeded low-voltage bid form may be
hardcoded. Templates are data.

## Product family

Everything PDF is a sibling of an existing app, **pics2pdf** (images → PDF).
Same design bones, different accent: pics2pdf is blue `#2563EB`, Everything PDF is
indigo `#4338CA`. The header carries the shared mark (rounded tile, four inset corner
brackets, white glyph inside) plus a small "Also in this suite · pics2pdf" tie to the
right of the lockup. Keep that tie — it is how users learn the two apps are related
but separate.

## Surfaces

### 1. Dashboard (`screens/01-dashboard.png`)
- **Templates** grid, 4 across. Each card: a miniature page thumbnail rendered from the
  template's real field geometry (do not ship static thumbnail images — draw the boxes
  from field coordinates), the template name, and a meta line (`9 fields · 4 sum to total`).
- Cards with a total carry an "Auto-total" badge (Σ icon) top-right of the thumbnail.
- One click on a card opens the editor with that template's fields already placed.
- **One-off edit** dashed dropzone below: drop a PDF to edit once. Existing AcroForm fields
  get detected automatically. Nothing persists unless the user saves it as a template after.

### 2. Editor — filling (`screens/02-editor-filling.png`)
Layout: top bar (52px) → tool bar (46px) → split body.
- Left: gray stage, PDF page centered, max ~620px wide, page bar above it (page count,
  zoom stepper, paper size).
- Right: 400px docked panel, `Fields` list.
- Fields render as tinted indigo boxes with a 1px indigo outline — obviously editable.
  The selected field gets a 1.5px border, a 3px focus ring, a caret bar, and four square
  corner handles.
- Numeric fields get a small `#` glyph in the left gutter.
- The field list shows type tags (Text / Number / Auto). Below the list, a **live total
  block**: each contributing field with its current value, then the sum.
- Selected-field inspector: Name, Type, and a Behavior segmented control —
  `Plain | Sums into total | Is a total`.
- Header shows autosave state, a Reference toggle, and the primary Export PDF button.

### 3. Editor — reference photo docked (`screens/03-editor-reference.png`)
- The right panel switches to a **Reference** tab set (`Photo | Fields`).
- Photo pane: the technician's handwritten sheet, dark backing, pan/zoom/rotate/fit
  controls floating bottom-left. Replace, pop-out, and close buttons in the panel header.
- **Scratch box** below the photo: a monospace textarea for text pulled off the photo, with
  a Copy button. It is free text and is never written into the PDF — say so in the UI, as
  the reference does.
- Panel widens to 440px in this mode; the PDF stage shrinks to match.

### 4. Template setup (`screens/04-template-setup.png`)
- Tool bar switches to authoring: Draw field, Checkbox, Signature slot, **Detect existing
  fields**, Snap to grid.
- Unfilled fields render as gray dashed/dead placeholders labeled by type (`Text`,
  `Number`, `Date`, `Signature slot`).
- The total field shows `Auto-total · Σ 4 fields` instead of a value.
- Right panel: template name, selected-field inspector (Name, Type, Behavior, Format,
  Target total), then a **Totals on this template** card listing every candidate numeric
  field with a checkbox for whether it sums in.
- Bottom hint pill over the stage: drag to draw, `N` to mark as number, `Esc` to cancel.

**Critical rule:** numeric behavior and totals UI appear *only* on fields the user has
marked as numbers. A template with no numeric fields saves with no total and the editor
hides the math entirely. Plain PDFs must never trigger arithmetic.

### 5. Export options (`screens/05-export-sheet.png`)
Centered 470px modal over a scrim.
- Filename input, prefilled from template + subject + date.
- Field handling, radio pair: **Flatten fields** (text and signature burned into the page,
  uneditable) or **Keep fields editable** (stays a fillable PDF).
- Optional: append the reference photo as a final page.
- Footer summary: page count, paper size, estimated file size. Cancel / Export.

### 6. Dark theme (`screens/06-dark-editor.png`)
Same layout, dark surfaces, for low-light and truck-cab use. The **PDF page itself stays
white** — only the app chrome darkens. Field tints stay indigo against the white page.

## Design tokens

Light:

```
--bg #fafaf7   --surface #ffffff   --surface-2 #f4f3ee   --surface-3 #ecebe3
--border #e4e2d9   --border-strong #d2cfc2
--text #1c1d1a   --text-dim #5e605a   --text-faint #96968c
--accent #4338ca   --accent-hover #3730a3   --accent-soft #eeecfb
--accent-ring rgba(67,56,202,.22)
--sibling-blue #2563eb
```

Dark:

```
--bg #16171a   --surface #1e2024   --surface-2 #24262b   --surface-3 #2c2f35
--border #2f3238   --border-strong #3a3e45
--text #eceded   --text-dim #a2a5aa   --text-faint #71757c
--accent #7c6ff0   --accent-hover #8f84f4   --accent-soft #252338
--accent-ring rgba(124,111,240,.3)
--sibling-blue #5b8def
```

Type: `"Helvetica Neue", Helvetica, Arial, sans-serif`.
Body copy 12.5–13px, labels 11–11.5px, eyebrows 10.5px uppercase with .08–.09em tracking,
page titles 22px at -.02em. Radius 6px on panels and buttons, 3px on fields, 8px on modals.
Icons: Phosphor (regular, plus bold for primary-button glyphs).

Density is comfortable but tight — this is a work tool. No gradients, no decorative
illustration, no pill styling, no emoji.

## Implementation notes

- Render PDFs with pdf.js; write output with pdf-lib. Flattening draws field text and the
  signature image onto the page content stream and removes the widget annotations.
- Field model, roughly:
  `{ id, page, rect: {x,y,w,h} in PDF user space, name, type: 'text'|'number'|'checkbox'|'signature'|'date', behavior: 'plain'|'sum'|'total', targetTotalId?, format? }`.
  Store rects in PDF coordinates, not screen pixels, so zoom and page size never corrupt
  geometry.
- Totals recompute on every keystroke of a contributing field. A field with
  `behavior: 'total'` is read-only in the editor.
- Detect existing AcroForm fields on import and map them into the same field model, so a
  detected field and a user-drawn field behave identically.
- Signature: draw on a canvas or type in a script face, store as PNG, place into a
  signature slot.
- Templates persist locally (IndexedDB is enough to start); a template stores field geometry
  and flags plus a reference to the source PDF.
- Everything in the reference screens is static markup with placeholder content. No values,
  field names, or template names in it are real — replace them with data.

## Seed template

One template ships pre-seeded: **Low-Voltage Bid Form** — text fields for client, site
address, preparer, date; numeric fields for equipment cost, materials, lift rental, labor;
those four sum into `Total bid`; a signature slot and a date at the bottom. The real source
PDF will be supplied separately — treat the layout in the reference screens as a stand-in
and drive field placement from the actual PDF when it arrives.
