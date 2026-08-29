# Design Tokens — Everything PDF
> Edit this file when starting a new app. All brand values live here — components.md and patterns.md reference these only.
>
> These values are taken verbatim from `../../everything_pdf_handoff/CLAUDE_CODE_BRIEF.md`,
> the design contract for this app. Everything PDF is a sibling of pics2pdf (blue `#2563EB`)
> with an indigo accent (`#4338CA`) instead. See `../../everything_pdf_handoff/reference-screens.html`
> for the authoritative component markup — `components.md`/`patterns.md` in this folder are the
> generic workspace patterns (mobile/consumer-app oriented) and mostly don't apply to this
> dense editor UI; keep them for reference only.

```css
:root {
  /* ── Color · Surfaces (light) ──────────────────────────── */
  --bg:             #fafaf7;
  --surface:        #ffffff;
  --surface-2:      #f4f3ee;
  --surface-3:      #ecebe3;

  /* ── Color · Borders ───────────────────────────────────── */
  --border:         #e4e2d9;
  --border-strong:  #d2cfc2;

  /* ── Color · Text ──────────────────────────────────────── */
  --text:           #1c1d1a;
  --text-dim:       #5e605a;
  --text-faint:     #96968c;

  /* ── Color · Brand ──────────────────────────────────────── */
  --accent:         #4338ca;
  --accent-hover:   #3730a3;
  --accent-soft:    #eeecfb;
  --accent-ring:    rgba(67,56,202,.22);

  /* ── Color · Sibling app tie (pics2pdf) ─────────────────── */
  --sibling-blue:   #2563eb;

  /* ── Type ────────────────────────────────────────────────  */
  --font: "Helvetica Neue", Helvetica, Arial, sans-serif;
  /* Body copy 12.5–13px · labels 11–11.5px ·
     eyebrows 10.5px uppercase, .08–.09em tracking ·
     page titles 22px at -.02em */

  /* ── Radius ──────────────────────────────────────────────  */
  --radius:        6px;   /* panels, buttons */
  --radius-field:  3px;   /* placed PDF fields */
  --radius-modal:  8px;   /* modals / sheets */
}

.dark {
  --bg:             #16171a;
  --surface:        #1e2024;
  --surface-2:      #24262b;
  --surface-3:      #2c2f35;

  --border:         #2f3238;
  --border-strong:  #3a3e45;

  --text:           #eceded;
  --text-dim:       #a2a5aa;
  --text-faint:     #71757c;

  --accent:         #7c6ff0;
  --accent-hover:   #8f84f4;
  --accent-soft:    #252338;
  --accent-ring:    rgba(124,111,240,.3);

  --sibling-blue:   #5b8def;
}
```

**Icons**: Phosphor (regular, plus bold for primary-button glyphs), via
`https://unpkg.com/@phosphor-icons/web@2.1.1/src/{regular,bold}/style.css`,
used as `<i class="ph ph-name">` / `<i class="ph-bold ph-name">`.

**Density**: comfortable but tight — this is a work tool, not a consumer app. No
gradients, no decorative illustration, no pill styling, no emoji.
