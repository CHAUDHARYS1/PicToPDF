# Components
> All class names and markup patterns extracted from the Paydown (Loan) app.
> Token references → @design-system/tokens.md
>
> **Note for Everything PDF**: these are mobile/consumer-app patterns (grouped lists,
> tab bars, sliders) and mostly don't apply to this app's dense editor UI. For the
> toolbar, field-box, canvas-handle, and panel patterns actually used here, treat
> `../../everything_pdf_handoff/reference-screens.html` as the authoritative component
> source instead.

---

## Button · Primary Full-Width `.btn-full`
A full-bleed dark button at the bottom of a pane section.

```html
<button class="btn-full">Save Changes</button>
```

**Classes / variants**
| Class | Description |
|---|---|
| `.btn-full` | Full-width, `--ink` background, white text |
| `.setup-btn` | Inline CTA (icon + text), colored background via `--hue` |
| `.quick-pay-btn` | `--accent` background, full-width, inside a card |
| `.port-log-btn` | Outlined ghost button, `--accent` text, inside a card |
| `.add-row-btn` | Dashed-border ghost, adds a row to a list |

**Rules**
- Min height 44 px on all touch targets.
- Active state: `scale(0.97–0.985)` + darken background. Never remove the scale feedback.
- Do not use `.btn-full` inside a card; use `.quick-pay-btn` or `.port-log-btn` there.
- Border-radius: `--radius` (5 px) on all buttons.

---

## Card Group `.grp` + `.row`
iOS-style grouped list. The primary content block for settings, detail rows, and data pairs.

```html
<div class="grp">
  <div class="row">
    <div class="row-body">
      <div class="row-lbl">Label</div>
    </div>
    <div class="row-val">$1,234.56</div>
  </div>
  <div class="row tap"> <!-- tappable row -->
    <div class="row-body">
      <div class="row-lbl">Navigate somewhere</div>
    </div>
    <span class="chev">›</span>
  </div>
</div>
```

**`.row-val` color modifiers**
| Class | Color token |
|---|---|
| `.blu` | `--accent` |
| `.grn` | `--green` |
| `.red` | `--red` |
| `.wht` | `--ink`, bold |

**Rules**
- `.grp` has `margin: 0 var(--space-4)` — never go edge-to-edge on mobile.
- `.row` min-height 52 px. Last child has no bottom border.
- Numeric values use `font-variant-numeric: tabular-nums` + `--font-mono`.
- `.tap:active` background changes to `--surface`. Never change text color on active.

---

## Section Header `.sec` + `.sec-hdr`
Uppercase eyebrow label above a `.grp`.

```html
<div class="sec">
  <div class="sec-hdr">Overview</div>
  <div class="grp">…</div>
  <div class="sec-ftr">Footnote or helper text below the group.</div>
</div>
```

**Rules**
- Font: `--text-sm` (11 px), `--weight-medium`, uppercase, `letter-spacing: 0.04em`, color `--ink-4`.
- `margin-top: var(--space-7)` between sections.
- `.sec-ftr`: 13 px, `--ink-3`, `padding: 12px 24px 0`, `line-height: 1.5`.

---

## Form Group `.form-grp` + `.form-field`
Inline label-input rows, identical look to `.grp / .row` but for data entry.

```html
<div class="form-grp">
  <div class="form-field">
    <label class="field-lbl">Loan Balance</label>
    <input class="field-inp" type="number" placeholder="0.00">
  </div>
  <div class="field-hint">Must be greater than 0</div>
  <div class="form-field">
    <label class="field-lbl">APR</label>
    <input class="field-inp" type="number" placeholder="0.00">
  </div>
</div>
```

**`.field-hint` modifiers**
| Class | Meaning |
|---|---|
| *(no modifier)* | `--ink-3` neutral hint |
| `.field-hint-ok` | `--green`, bold — valid value |
| `.field-hint-warn` | `--red` — validation error |

**Rules**
- `.field-lbl` min-width 140 px, `--text-md`, `--ink-2`.
- `.field-inp` text-align right, `--accent` color, `--font-mono`, 15 px. No visible border.
- `min-height: 52px` on each `.form-field` (same as `.row`).
- Never show both an ok and a warn hint simultaneously.

---

## Modal / Bottom Sheet `.overlay` + `.sheet`
Full-screen dim overlay with bottom-sheet panel.

```html
<div class="overlay" id="my-modal">
  <div class="sheet">
    <div class="handle-bar"><div class="handle"></div></div>
    <div class="sheet-hdr">
      <button class="sheet-cancel">Cancel</button>
      <span class="sheet-ttl">Edit Loan</span>
      <button class="sheet-save">Save</button>
    </div>
    <!-- content rows -->
  </div>
</div>
```

Toggle open: add `.open` to `.overlay`.

**Rules**
- Max-width 520 px, centered. Max-height 90 dvh with internal scroll.
- Sheet animates up (`translateY(100%) → 0`) with `--ease-enter` at 320 ms.
- Overlay backdrop: `rgba(0,0,0,0.32)`.
- `.sheet-cancel` color `--ink-3`. `.sheet-save` color `--accent`, `--weight-semibold`.
- Handle bar is 40×4 px, `--paper-3`, `--radius-sm`.

---

## Segmented Control `.seg` / `.seg-sm`
Toggle between 2–4 options. Used for tabs and inline settings.

```html
<!-- Full-width (tab switching) -->
<div class="seg">
  <button class="on">Overview</button>
  <button>Payments</button>
  <button>Simulator</button>
</div>

<!-- Inline small (inside a .row) -->
<div class="seg-sm">
  <button class="on">Monthly</button>
  <button>Yearly</button>
</div>
```

**Rules**
- Background `--surface`, border `1px solid --line`, radius `--radius`, padding 3 px.
- Active button: `--card` background, `--ink` text, `box-shadow: 0 1px 3px rgba(0,0,0,0.08)`.
- Inactive: `--ink-3` text, no background. Transition 150 ms.
- `.seg-sm` uses 12 px font; `.seg` uses 13 px.
- Never put more than 4 segments — readability breaks.

---

## Slider `.slider-wrap`
Numeric range input with a large display value above it.

```html
<div class="slider-wrap">
  <div class="slider-top">
    <div>
      <div class="slider-big">$500</div>
      <div class="slider-sub">Extra / month</div>
    </div>
    <div class="slider-right">
      <small>Pay off in</small>
      <strong>3 yr 4 mo</strong>
    </div>
  </div>
  <input type="range" min="0" max="2000" value="500">
  <div class="slider-ticks">
    <span>$0</span><span>$500</span><span>$1k</span><span>$2k</span>
  </div>
</div>
```

**Rules**
- Thumb: 24×24 px, circular, `--ink` fill, white 3 px ring shadow.
- Track height: 4 px. Filled portion uses accent via CSS `--p` custom property on the `<input>`.
- Always show tick labels at key intervals. Font `--font-mono`, `--text-xs`, `--ink-4`.
- `.slider-big` uses `--text-display` (40 px), `--font-mono`, `--accent`. 

---

## Data Table `.dtbl`
Scrollable amortization-style table.

```html
<div class="tbl-scroll">
  <table class="dtbl">
    <thead>
      <tr>
        <th>Date</th>
        <th>Payment</th>
        <th>Principal</th>
        <th>Interest</th>
        <th>Balance</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Jun 2025</td>
        <td>$1,234.00</td>
        <td>$980.00</td>
        <td>$254.00</td>
        <td>$45,000.00</td>
      </tr>
    </tbody>
  </table>
</div>
```

**Rules**
- `th`: `--text-xs` (11 px), uppercase, `letter-spacing: 0.04em`, `--ink-4`, sticky top, `--surface` background.
- `td`: 14 px, `--ink-2`, right-aligned. First `td` left-aligned, `--ink`, `--weight-medium`.
- Row hover: `--surface` background.
- Always wrap in `.tbl-scroll` for horizontal overflow on mobile.
- All numeric columns: `font-variant-numeric: tabular-nums`.

---

## Pills / Status Badges `.pill`
Compact status indicators, always uppercase.

```html
<span class="pill pill-grn">Paid</span>
<span class="pill pill-gry">Pending</span>
<span class="pill pill-yel">Late</span>
<span class="pill pill-ap">Autopay</span>
```

**Variants**
| Class | Background | Text |
|---|---|---|
| `.pill-grn` | `--green-tint` | `--green` |
| `.pill-gry` | `--paper-2` | `--ink-3` |
| `.pill-yel` | `--amber-tint` | `--amber` |
| `.pill-ap` | `--accent-tint` | `--accent` |

**Rules**
- Font: `--font-mono`, `--text-xs` (10 px), `--weight-bold`, `letter-spacing: 0.08em`, uppercase.
- Padding: `4px 8px`, radius `--radius`.
- Never use pills for actions — only for read-only status.

---

## Tab Bar `#tabbar` + `.tab`
Bottom navigation. Managed by JS; CSS handles the active pill.

```html
<nav id="tabbar">
  <div id="tab-pill"></div>  <!-- sliding highlight, injected by JS -->
  <button class="tab on">
    <svg>…</svg>
    <span>Home</span>
  </button>
  <button class="tab">
    <svg>…</svg>
    <span>Schedule</span>
  </button>
</nav>
```

**Rules**
- Icons 24×24 px SVG. Label 11 px, `--weight-medium`, `letter-spacing: 0.02em`.
- Active (`.on`): `--accent` color, icon scales to 1.08×, label becomes bold.
- Inactive: `--ink-4`.
- Active state animates with `--ease-spring` (`tabPop` keyframe).
- Never exceed 5 tabs — space collapses on small screens.
- `padding-bottom: env(safe-area-inset-bottom)` required.

---

## KPI Grid `.kpi-grid` + `.kpi`
2-column summary stat grid, typically above a main card.

```html
<div class="kpi-grid">
  <div class="kpi">
    <div class="kpi-lbl">Total Interest</div>
    <div class="kpi-val red">$4,210</div>
  </div>
  <div class="kpi">
    <div class="kpi-lbl">Payoff Date</div>
    <div class="kpi-val">Aug 2028</div>
  </div>
</div>
```

**`.kpi-val` modifiers:** `.green` → `--green`, `.red` → `--red`.

**Rules**
- `.kpi-grid`: `grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 16px 0`.
- `.kpi`: `--surface` background, no shadow, `--radius`, `padding: 12px 14px`.
- Label: `--text-sm`, uppercase, `--ink-4`. Value: 22 px, `--font-mono`, `--weight-medium`.

---

## Progress Bar `.prog-track` + `.prog-fill`
Horizontal completion indicator, used in hero and switcher cards.

```html
<div class="prog-track">
  <div class="prog-fill" style="width: 42%"></div>
</div>
```

**Rules**
- Track: 8 px tall, `--paper-3`, `--radius-sm` (4 px).
- Fill: `--accent` default; override with inline `--hue` for per-loan color.
- Animate width with `transition: width .7s var(--ease-enter)`.
- Always pair with `.prog-meta` (start / end labels) below the track.

---

## Toast `.toast`
Ephemeral feedback message above the tab bar.

```html
<div class="toast" id="toast">Payment saved</div>
```

Show: add `.show`. Hide: remove `.show` after delay.

**Rules**
- Fixed position, centered, above tab bar (`bottom: calc(56px + env(safe-area-inset-bottom) + 16px)`).
- `--ink` background, white text, `--weight-medium`, `--radius`.
- Never use for errors — use a `.field-hint-warn` or `.banner` instead.
- Auto-dismiss after ≈ 2 s.

---

## Banner `.banner`
Persistent inline warning or info block.

```html
<div class="banner">
  ⚠️ Your APR looks high. Consider refinancing.
</div>
```

**Rules**
- Uses `--amber-tint` background, `--amber` text, `--radius`. Margin `16px 16px 0`.
- Do not use for success states — use a pill or toast.
- Line-height 1.55, 13 px. Keep copy to 2 lines max.

---

## Empty State `.empty-state`
Centered placeholder when a list has no content.

```html
<div class="empty-state">
  <div class="empty-icon">🏦</div>
  <div class="empty-title">No Loans Yet</div>
  <div class="empty-sub">Add your first loan to start tracking your payoff.</div>
</div>
```

**Rules**
- Padding `64px 24px`, centered text.
- Icon: 40 px, `opacity: 0.5`.
- Title: `--text-3xl` (22 px), `--weight-semibold`, `letter-spacing: -0.01em`, `--ink`.
- Sub: `--text-md` (14 px), `--ink-3`, `line-height: 1.55`.
- Do not add a CTA button unless the action is the only path forward.
