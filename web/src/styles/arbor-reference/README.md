# Arbor Reference UI Layers

These files are the separated implementation layers for the exported reference mockups from `C:\Users\paha1\OneDrive\Desktop\export`.

- `tokens.css` - shared Polska Flora/Arbor brand tokens: Road UA, approved brown/green/orange palette, paper background, focus and motion rules.
- `os.css` - Arbor OS web application shell: fixed brown sidebar, paper workspace, white cards, dark hero panels and responsive 60px mobile rail.
- `client-portal.css` - Portal Klienta public/customer view: centered 860px layout, dark order status hero, timeline/card surfaces and mobile single-column behavior.
- `estimator-office.css` - Gabinet Wyceniajacego / estimator workspace: dark brown office chrome, translucent work cards, high-contrast fields and action states.
- `mobile-web.css` - web-rendered mobile surfaces: touch-size controls, paper background and mobile card rhythm.

Native mobile uses the matching palette and shape tokens in `mobile/constants/theme.ts`, plus shared component updates in `mobile/components/ui`.

The rewritten standalone React views are available at:

- `/#/reference`
- `/#/reference/arbor-os`
- `/#/reference/arbor-os-deck`
- `/#/reference/portal-klienta`
- `/#/reference/gabinet-wyceniajacego`
- `/#/reference/arbor-mobile`

These routes are covered by `web/scripts/smoke-routes.cjs` and the focused visual/DOM smoke:

```bash
npm run smoke:reference -w arbor-web
```
