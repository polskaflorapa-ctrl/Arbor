# Arbor OS Design System

## Direction

**Canopy Command** is a light-first, data-dense operations interface for field-service teams. It uses flat, touch-first surfaces from the `ui-ux-pro-max` recommendation, with a restrained command-center feel: navy structure, forest accents, warm amber risk states, and compact information hierarchy.

I chose this direction because Arbor OS users scan schedules, exceptions, crews, approvals, CRM activity, and money under time pressure. The UI needs to feel calm, fast, legible, and trustworthy before it feels decorative.

## Final Ui-Ux-Pro-Max Pass

After the direct `ui-ux-pro-max` skill run, the applied direction was tightened to **Data-Dense Dashboard / Real-Time Operations**:

- dark operational canvas: `#020617`, `#07111f`, `#0f172a`;
- high-contrast foreground: `#f8fafc`, `#cbd5e1`, `#94a3b8`;
- status accents: green `#22c55e`, teal `#5eead4`, blue `#38bdf8`, amber `#fbbf24`, red `#fb7185`;
- typography: Fira Sans for UI, Fira Code for numeric KPI/data labels;
- compact cards, clear borders, visible focus states, 44px minimum controls, and no horizontal scroll at 360px.

This pass intentionally overrides the previous light production layer with a single final stylesheet: `web/src/styles/ui-ux-pro-max-final.css`.

The active dashboard route now uses this cockpit pattern in `DashboardPolskaFlora`, which is the component actually rendered by `/dashboard`. The first fold is a live radar/map with animated sweep/rings, embedded actions, a decision queue, and KPI dock. Mobile stacks this as radar, decisions, KPI dock, then analytical panels; decorative radar nodes are hidden below 760px to prevent overlap.

The final layer intentionally contains high-specificity `pf-*` contrast rules because earlier global theme files used broad `!important` selectors on headings and KPI values. The active dashboard must keep white foreground text on the dark operational canvas in every theme.

## Tokens

```css
:root,
body.theme-light {
  --color-primary: #0f172a;
  --color-on-primary: #ffffff;
  --color-secondary: #334155;
  --color-accent: #0f766e;
  --color-accent-strong: #115e59;
  --color-accent-soft: rgba(15, 118, 110, 0.1);
  --color-background: #f8fafc;
  --color-foreground: #020617;
  --color-surface: #ffffff;
  --color-surface-2: #f1f5f9;
  --color-muted: #64748b;
  --color-border: #dbe4ea;
  --color-danger: #dc2626;
  --color-warning: #b45309;
  --color-success: #15803d;
  --color-info: #0369a1;
  --color-ring: rgba(15, 118, 110, 0.26);
}

body.theme-dark {
  --color-primary: #e2e8f0;
  --color-on-primary: #020617;
  --color-secondary: #94a3b8;
  --color-accent: #5eead4;
  --color-accent-strong: #99f6e4;
  --color-accent-soft: rgba(94, 234, 212, 0.12);
  --color-background: #07111f;
  --color-foreground: #f8fafc;
  --color-surface: #0f172a;
  --color-surface-2: #111c2f;
  --color-muted: #a8b3c7;
  --color-border: rgba(226, 232, 240, 0.16);
  --color-danger: #fca5a5;
  --color-warning: #fbbf24;
  --color-success: #86efac;
  --color-info: #7dd3fc;
  --color-ring: rgba(94, 234, 212, 0.32);
}
```

## Scales

- Typography: Inter for UI, Calistoga reserved for public hero moments, JetBrains Mono for ids, money, times, and operational counters.
- Type scale: 12, 13, 14, 16, 20, 24, 32, 44.
- Spacing: 4px base with common steps of 8, 12, 16, 24, 32, 48.
- Radius: 4px controls, 6px rows/chips, 8px cards/sheets. Larger radii are reserved for circular avatars only.
- Shadows: minimal. Use borders and surface contrast first; use one low operational elevation for sticky nav, modals, and raised panels.
- Motion: 160-220ms for hover/focus/press, transform and opacity only, disabled under `prefers-reduced-motion`.

## Rules

- Every interactive target is at least 44px tall on touch screens.
- Every route keeps the same navigation placement and content rhythm.
- Loading states use skeletons, not blank screens.
- Empty states must explain what is missing and the next useful action.
- Error states must include a recovery path or at least clear retry language.
- Color never carries meaning alone; status labels and icons/text remain visible.
- No page-specific raw color should be introduced unless it maps back to these tokens.
