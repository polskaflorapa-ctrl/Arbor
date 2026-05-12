# CHANGELOG

## [2026-05-04] — Test Mode Implementation

### ✨ Features

#### Web Application
- **Dev Panel** (`web/src/components/DevPanel.js`)
  - Hidden keyboard shortcut: `Ctrl+Shift+D` (Windows/Linux) or `Cmd+Shift+D` (macOS)
  - Toggle test mode on/off
  - Select test user role (Dyrektor, Kierownik, Brygadzista, Wyceniający)
  - Inject test token and user session into localStorage
  - Automatic app reload on role change

- **Test Mode Utilities** (`web/src/utils/testMode.js`)
  - Test user fixtures with realistic data
  - Mock data sets for zlecenia, oddziały, ekipy, wyceny
  - `isTestModeEnabled()` — check if test mode is active
  - `getTestUser(role)` — fetch test user by role
  - `getMockData(endpoint)` — return mock response for API endpoint

- **API Adapter** (`web/src/api.js`)
  - Intercepts requests when test mode is enabled
  - Returns mock data for configured endpoints
  - Supports `/auth/login`, `/zlecenia`, `/oddziały`, `/ekipy`, `/wyceny`
  - Transparent fallback to real API when endpoint not mocked
  - Handles session injection (token, user data)

#### Mobile Application
- **Test Mode Screen** (`mobile/app/test-mode.tsx`)
  - Expo Router page at `/test-mode`
  - Toggle test mode
  - Select user role from list
  - Display current test mode status
  - Show available mock data preview

- **Test Mode Utilities** (`mobile/utils/testMode.ts`)
  - AsyncStorage-based persistence (key: `arbor-mobile-test-mode`)
  - Test user fixtures (same as web)
  - Mock data for `/zlecenia` and `/dashboard/summary`
  - `isTestModeEnabledMobile()` — async check
  - `toggleTestModeMobile(role)` — enable/disable
  - `getMockDataMobile(endpoint)` — mock response lookup

- **Hook** (`mobile/hooks/useTestMode.ts`)
  - `useTestMode()` — check if enabled
  - `withTestModeAPI()` — wrapper for API calls
  - Automatically returns mock data when test mode active
  - Fallback to real API request if mock not found

- **Hidden Activation** (`mobile/app/profil.tsx`)
  - Tap avatar 7 times to unlock test mode screen
  - Tap counter with visual feedback
  - Direct route to `/test-mode`

#### Backend (OS)
- No changes to core functionality
- Test mode is client-side only
- All mock data is generated in web/mobile, not backend

### 🐛 Bug Fixes

#### OS (`os/src/routes/cmr.js`)
- Fixed error reference in catch block (line 225: `_err` → `err`)
- Fixed missing `client.release()` in ROLLBACK catch handler
- Properly structured nested try-catch for transaction rollback

#### OS (`os/src/routes/sms.js`)
- Fixed undefined `res` in `/api/sms/wyslij` (line 82: `_res` → `res`)
- Fixed unused parameter `z` in `zakonczone` template (renamed to `_z`)

#### OS (`os/src/routes/ai.js`)
- Removed unused catch variable in JSON parsing (line 146)

#### OS (`os/public/app/app.js`)
- Prefixed unused function with `_` (line 236: `onGodzinyActionClick` → `_onGodzinyActionClick`)

#### OS (`os/src/services/quotationApprovals.js`)
- Removed unused variable `koszt` (line 49: prefixed with `_`)

### ✅ Quality Assurance

#### Web
- ✓ `npm run build` — Production build compiles without errors
- ✓ `npm test -- --watchAll=false` — All 12 tests pass (3 suites)
  - `src/utils/cityUtils.test.js`
  - `src/pages/Integracje.test.js`
  - `src/App.test.js`

#### Mobile
- ✓ `npm run lint` — No ESLint errors or warnings
- ✓ `npm run typecheck` — TypeScript validation passes
- ✓ All test mode files properly typed (`*.ts`, `*.tsx`)

#### OS
- ✓ `npm run lint` — ESLint clean (0 errors, 0 warnings)
- ✓ `npm test -- --runInBand` — All 18 test suites pass, 84 tests
  - Fixed 5 lint errors and 6 warnings
  - Tests continue to pass after fixes

### 📝 Documentation

- **[GETTING_STARTED.md](./GETTING_STARTED.md)** — Quick start guide with test mode section
- **[TEST_MODE_GUIDE.md](./TEST_MODE_GUIDE.md)** — Comprehensive test mode documentation
- **[MONOREPO-SETUP.md](./MONOREPO-SETUP.md)** — Monorepo structure and setup
- **[CHANGELOG.md](./CHANGELOG.md)** — This file

### 🎯 Test Mode Features Checklist

- [x] Web Dev Panel (Ctrl+Shift+D)
- [x] Web test user selection
- [x] Web mock data for 5 endpoints
- [x] Web session injection (token, user)
- [x] Web localStorage persistence
- [x] Mobile test mode screen at /test-mode
- [x] Mobile hidden activation (7 taps on avatar)
- [x] Mobile test user selection
- [x] Mobile mock data for 2 endpoints
- [x] Mobile AsyncStorage persistence
- [x] Mobile useTestMode() hook
- [x] API fallback for unmocked endpoints
- [x] All linting passes
- [x] All tests pass
- [x] Documentation complete

### 🔄 Migration Notes

**For existing projects:**
1. Test mode is non-breaking; all real API calls work as before
2. Test mode activates only when explicitly enabled
3. localStorage and AsyncStorage flags are isolated (`arbor-test-mode`, `arbor-mobile-test-mode`)
4. No changes to backend required
5. Safe to deploy to production (test mode is development-focused)

### 📦 Files Changed

**Web:**
- `web/src/components/DevPanel.js` — NEW
- `web/src/utils/testMode.js` — NEW
- `web/src/api.js` — Modified (added test mode adapter)
- `web/src/App.js` — Modified (added DevPanel)

**Mobile:**
- `mobile/app/test-mode.tsx` — NEW
- `mobile/utils/testMode.ts` — NEW
- `mobile/hooks/useTestMode.ts` — NEW
- `mobile/app/profil.tsx` — Modified (added 7-tap activation)

**OS:**
- `os/src/routes/cmr.js` — Fixed (error handling)
- `os/src/routes/sms.js` — Fixed (error handling)
- `os/src/routes/ai.js` — Fixed (unused catch variable)
- `os/public/app/app.js` — Fixed (unused function)
- `os/src/services/quotationApprovals.js` — Fixed (unused variable)

**Documentation:**
- `GETTING_STARTED.md` — NEW
- `TEST_MODE_GUIDE.md` — Updated
- `CHANGELOG.md` — NEW (this file)

### 🚀 Next Steps

1. **Integration Testing**
   - Test all screens with mock data
   - Verify fallback to real API when offline
   - Mobile end-to-end test with Expo

2. **Additional Mock Data**
   - Add more endpoints as needed
   - Consider adding error scenarios
   - Add data variations for edge cases

3. **Production Deployment**
   - Bundle web app (`npm run build`)
   - Configure environment variables
   - Deploy to staging for QA
   - Final production release

### 📞 Support

For questions or issues with test mode, refer to:
- [TEST_MODE_GUIDE.md](./TEST_MODE_GUIDE.md) — Troubleshooting section
- [GETTING_STARTED.md](./GETTING_STARTED.md) — General setup and usage
