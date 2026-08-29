# Patterns
> Layout conventions, spacing rules, and global do/don't guidelines.
> Token references → @design-system/tokens.md | Component references → @design-system/components.md

---

## App Shell

```
┌─────────────────────────────┐
│  #nav  (48 px + safe-top)   │
├─────────────────────────────┤
│                             │
│  #content  (flex: 1,        │
│  overflow-y: auto)          │
│                             │
│  .pane (min-height: 100%,   │
│  padding-bottom: 32px)      │
│                             │
├─────────────────────────────┤
│  #tabbar  (+ safe-bottom)   │
└─────────────────────────────┘
```

- `#app`: `display: flex; flex-direction: column; height: 100dvh; overflow: hidden`.
- Use `dvh` not `vh` — iOS Safari's bottom bar causes `vh` overflow.
- `body`: `overflow: hidden` — all scrolling lives inside `#content`.

---

## Page Layout

**Horizontal margins**
- Content never touches screen edges. Use `margin: 0 var(--space-4)` (16 px) on cards, groups, and buttons.
- Section headers (`.sec-hdr`) use `padding: 0 24px` — slightly wider for visual hierarchy.

**Vertical rhythm**
- Section spacing: `margin-top: var(--space-7)` (28 px) between `.sec` blocks.
- First card on a pane: `margin-top: 0` — the hero/switcher above provides context.
- Bottom of scrollable content: `padding-bottom: var(--space-8)` (32 px) so nothing hides under the tab bar.

**Max content width**
- No explicit max-width on the pane. The outer shell constrains to the device.
- Sheets and modals: `max-width: 520px`.

---

## Card Anatomy

Every card follows: **eyebrow → hero value → meta row → divider → detail rows**.

```
┌─────────────────────────────┐  ← .grp (margin: 0 16px; box-shadow: --shadow-card)
│  EYEBROW LABEL        $1 K  │  ← .row (min-height: 52px; padding: 12px 20px)
│─────────────────────────────│  ← border-bottom: 1px solid --line-soft
│  Secondary Label       42%  │
│─────────────────────────────│
│  Tertiary          Aug 2028 │
└─────────────────────────────┘
```

- Row label (`.row-lbl`): 14 px, `--ink-2`, weight 400.
- Row value (`.row-val`): 14 px, `--font-mono`, `--weight-medium`, `--ink`, tabular-nums.
- Last row has no border.

---

## Typography Scale in Context

| Use case | Size | Weight | Font | Color |
|---|---|---|---|---|
| Page large title | 28 px | 600 | body | `--ink` |
| Section title / empty state | 22 px | 600 | body | `--ink` |
| Sheet / modal title | 16 px | 600 | body | `--ink` |
| Row label | 14 px | 400 | body | `--ink-2` |
| Row value, form input | 14–15 px | 500 | mono | `--ink` or `--accent` |
| Caption, hint | 13 px | 400 | body | `--ink-3` |
| Section eyebrow, pill | 10–11 px | 500–700 | mono | `--ink-4` (uppercase) |
| Hero balance | 52 px | 500 | mono | `--ink` |
| Hero display (sim) | 40 px | 500 | mono | `--accent` |

**Rules**
- Eyebrow labels: always `text-transform: uppercase; letter-spacing: 0.04em`. Never mix case.
- Monetary values: always `font-variant-numeric: tabular-nums; --font-mono`.
- Body copy line-height: 1.5. Caption line-height: 1.4–1.55.

---

## Spacing Usage

| Token | Value | When to use |
|---|---|---|
| `--space-1` | 4 px | Gaps between icon and badge, padding inside tiny elements |
| `--space-2` | 8 px | Gaps between inline items (pills, icon-to-text) |
| `--space-3` | 12 px | Row vertical padding, card internal gap, small gutters |
| `--space-4` | 16 px | Page horizontal margin, section vertical padding |
| `--space-5` | 20 px | Card horizontal padding (`.row padding-right/left`) |
| `--space-6` | 24 px | Large block padding (section headers, profile areas) |
| `--space-7` | 28 px | Between `.sec` sections |
| `--space-8` | 32 px | Bottom scroll clearance |

Do not invent intermediate values (e.g. 10 px, 18 px). Pick the nearest token.

---

## Color Usage

- **`--bg`** — page only. Never use as a card background.
- **`--card`** — card / grouped-list. The default surface for content blocks.
- **`--surface`** — inset within a card (table header, stat box, segmented control background).
- **`--paper-2`** — pill backgrounds, secondary fills. One step darker than `--surface`.
- **`--paper-3`** — progress tracks, slider backgrounds. Darkest neutral fill.
- **`--accent`** — one interactive action per screen. CTA buttons, links, active tabs, form values.
- Semantic colors (`--green`, `--red`, `--amber`) for status only — never for decoration.
- All tint variants (`--accent-tint`, `--green-tint`, etc.) used as pill/badge backgrounds only.

---

## Shadows

- `--shadow-card` → all cards (`.grp`, `.grp` equivalent). Subtle lift.
- `--shadow-pop` → toasts, FABs, floating small panels.
- `--shadow-float` → sheets, modals. Most prominent.
- Never apply shadow to elements inside a card (nested shadows look wrong).
- No shadow on `.kpi` stat boxes — they use `--surface` bg to distinguish without shadow.

---

## Motion

- UI feedback (button press, tab tap): `transform: scale(0.97–0.985)` + `--ease-spring`.
- Panel entrance (sheets, panes): slide + fade with `--ease-enter` at 280–380 ms.
- Number changes: use a tween span (`<span class="tween">`) that animates from old → new value.
- Progress / bar widths: `transition: width .4–.7s var(--ease-enter)`.
- Never animate color alone without a structural cue.

---

## Global Do / Don't

**Do**
- Use `--radius` (5 px) on every card, button, and pill — consistency over variation.
- Apply `env(safe-area-inset-*)` to nav, tab bar, and sheets.
- Use `overscroll-behavior: contain` on `#content` to prevent page bounce.
- Set `-webkit-font-smoothing: antialiased` on `body`.
- Add `font-variant-numeric: tabular-nums` to every numeric display.

**Don't**
- Don't introduce new color values — use a token or tint variant.
- Don't use `vh` in the shell — use `dvh`.
- Don't put shadows on elements nested inside a card.
- Don't use `font-size < 11px` for anything the user must read.
- Don't add `outline: none` to interactive elements without a visible `:focus-visible` fallback.
- Don't use `border-radius > 5px` except for the sim-custom input box (`--radius-lg: 8px`) and circular avatars (`--radius-circle`).
- Don't go edge-to-edge with content — always 16 px margin on mobile.
- Don't create a new spacing value — map to the nearest token.

---

## Accessibility

- All tap targets ≥ 44×44 px (`.row`, buttons, tabs, `.form-field`).
- Interactive rows (`.tap`) get `:active` background feedback — never rely on color alone.
- Status pills supplement, not replace, text meaning.
- Sheet overlays trap focus when open.
- `aria-label` required on icon-only buttons.
