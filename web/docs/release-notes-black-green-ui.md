## Release Notes - Black-Green UI Refresh

Date: 2026-04-24

### Scope
- Unified key web screens to a black-green accent palette.
- Removed remaining purple/legacy navy accents from updated status and CTA elements.
- Preserved green as the primary brand signal while improving consistency.

### What changed
- `Dashboard`: aligned hero, KPI, pipeline, and primary CTA accents to green variants.
- `AiChat`: restored consistent green FAB style and matching panel accents.
- `Zlecenia`: improved toggle + `Tak/Nie` visual consistency and readability.
- `Klienci`: aligned count badges to the green token family.
- `ZlecenieDetail`: adjusted status/badge colors for better readability.
- Additional green alignment updates in related views:
  - `PhotoAnnotator`
  - `Ekipy`
  - `OddzialDetail`
  - `ZarzadzajRolami`

### Light theme contrast pass
- Improved contrast on frequently used badges and status pills in:
  - `Dashboard`
  - `Klienci`
  - `Zlecenia`
  - `ZlecenieDetail`

### Validation
- Build passed: `npm run build -w arbor-web`

### Risk
- Visual-only changes (styling/colors); no business logic modifications.
