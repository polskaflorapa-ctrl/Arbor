#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const REQUIRED_BUILD_PROFILES = ['development', 'preview', 'production'];

function fail(message) {
  console.error(`x ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`ok ${message}`);
}

function readJson(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`${relativePath} is missing or invalid JSON: ${error.message}`);
    return null;
  }
}

function readText(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    fail(`${relativePath} is missing or unreadable: ${error.message}`);
    return '';
  }
}

function assertFile(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (fs.existsSync(filePath)) {
    pass(`${relativePath} exists`);
  } else {
    fail(`${relativePath} is missing`);
  }
}

function assertAppAsset(label, assetPath) {
  assertValue(label, assetPath);
  if (!assetPath) {
    return;
  }

  const relativePath = assetPath.replace(/^\.\//, '');
  assertFile(relativePath);
}

function assertValue(label, value) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    pass(label);
  } else {
    fail(`${label} is missing`);
  }
}

function assertUrl(label, value) {
  assertValue(label, value);
  if (!value) {
    return;
  }

  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') {
      fail(`${label} must use https`);
      return;
    }
    pass(`${label} is a valid https URL`);
  } catch (error) {
    fail(`${label} is not a valid URL: ${error.message}`);
  }
}

function getPluginConfig(appConfig, pluginName) {
  const plugins = appConfig?.expo?.plugins || [];
  const plugin = plugins.find((entry) => {
    if (typeof entry === 'string') {
      return entry === pluginName;
    }
    return Array.isArray(entry) && entry[0] === pluginName;
  });

  if (!plugin) {
    fail(`${pluginName} plugin is missing`);
    return {};
  }

  pass(`${pluginName} plugin exists`);
  return Array.isArray(plugin) ? plugin[1] || {} : {};
}

function normalizeApiUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function assertDefaultApiUrlMatchesReleaseEnv(apiSource, releaseEnvironments) {
  const match = apiSource.match(/DEFAULT_API_URL\s*=\s*['"]([^'"]+)['"]/);
  if (!match) {
    fail('DEFAULT_API_URL is missing in constants/api.js');
    return;
  }

  const defaultApiUrl = match[1];
  assertUrl('DEFAULT_API_URL', defaultApiUrl);

  const releaseUrls = new Set(
    Object.values(releaseEnvironments || {}).map((entry) => normalizeApiUrl(entry?.apiUrl))
  );

  if (releaseUrls.has(normalizeApiUrl(defaultApiUrl))) {
    pass('DEFAULT_API_URL matches a release environment');
  } else {
    fail('DEFAULT_API_URL does not match any release environment');
  }
}

function assertReleaseEnvironmentCatalog(releaseEnvironments) {
  if (!releaseEnvironments || typeof releaseEnvironments !== 'object') {
    fail('release environments must be an object');
    return;
  }

  const expected = new Set(REQUIRED_BUILD_PROFILES);
  for (const name of Object.keys(releaseEnvironments)) {
    if (expected.has(name)) {
      pass(`release environment "${name}" is expected`);
    } else {
      fail(`release environment "${name}" is not a known build profile`);
    }
  }

  for (const name of REQUIRED_BUILD_PROFILES) {
    assertValue(`release environment ${name} purpose is set`, releaseEnvironments[name]?.purpose);
  }
}

function assertIncludesValue(label, values, expectedValue) {
  if (Array.isArray(values) && values.includes(expectedValue)) {
    pass(`${label} includes ${expectedValue}`);
  } else {
    fail(`${label} must include ${expectedValue}`);
  }
}

function assertStoreMetadata(metadata, appConfig) {
  assertValue('store app name is set', metadata?.appName);

  if (metadata?.bundleIdentifier === appConfig?.expo?.ios?.bundleIdentifier) {
    pass('store bundleIdentifier matches app.json');
  } else {
    fail('store bundleIdentifier must match app.json ios.bundleIdentifier');
  }

  if (metadata?.androidPackage === appConfig?.expo?.android?.package) {
    pass('store androidPackage matches app.json');
  } else {
    fail('store androidPackage must match app.json android.package');
  }

  assertUrl('store marketing URL', metadata?.marketingUrl);
  assertUrl('store support URL', metadata?.supportUrl);
  assertUrl('store privacy policy URL', metadata?.privacyPolicyUrl);

  assertValue('store review login instructions are set', metadata?.reviewNotes?.loginInstructions);
  assertValue('store review backend availability is set', metadata?.reviewNotes?.backendAvailability);
  assertValue('store review permission summary is set', metadata?.reviewNotes?.permissionSummary);

  for (const key of ['location', 'photos', 'userIdentifiers', 'diagnostics']) {
    assertValue(`store privacy label ${key} is documented`, metadata?.privacyLabels?.[key]);
  }

  for (const gate of [
    'legal-review',
    'reviewer-test-account',
    'store-screenshots',
    'real-device-qa',
    'privacy-label-owner-approval',
    'production-crash-monitoring-confirmed',
  ]) {
    assertIncludesValue('manual store gates', metadata?.manualGates, gate);
  }

  if (metadata?.legalReviewRequired === true) {
    pass('store legal review gate remains explicit');
  } else {
    fail('store legal review gate must remain explicit until owner approval is recorded');
  }
}

function assertBuildProfile(easConfig, releaseEnvironments, name) {
  const profile = easConfig?.build?.[name];
  if (profile) {
    pass(`eas build profile "${name}" exists`);
  } else {
    fail(`eas build profile "${name}" is missing`);
    return;
  }

  assertUrl(`eas ${name} EXPO_PUBLIC_API_URL`, profile.env?.EXPO_PUBLIC_API_URL);
  assertValue(`eas ${name} EXPO_PUBLIC_EXPECTED_API_VERSION is set`, profile.env?.EXPO_PUBLIC_EXPECTED_API_VERSION);

  const releaseEnv = releaseEnvironments?.[name];
  if (!releaseEnv) {
    fail(`release environment "${name}" is missing`);
    return;
  }

  pass(`release environment "${name}" exists`);
  assertUrl(`release environment ${name} apiUrl`, releaseEnv.apiUrl);
  assertValue(`release environment ${name} expectedApiVersion is set`, releaseEnv.expectedApiVersion);

  if (normalizeApiUrl(profile.env?.EXPO_PUBLIC_API_URL) === normalizeApiUrl(releaseEnv.apiUrl)) {
    pass(`eas ${name} API URL matches release environment`);
  } else {
    fail(`eas ${name} API URL does not match release environment`);
  }

  if (profile.env?.EXPO_PUBLIC_EXPECTED_API_VERSION === releaseEnv.expectedApiVersion) {
    pass(`eas ${name} expected API version matches release environment`);
  } else {
    fail(`eas ${name} expected API version does not match release environment`);
  }
}

function getNpmInvocation() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      prefixArgs: [process.env.npm_execpath],
      shell: false,
    };
  }

  if (process.platform === 'win32') {
    const bundledNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(bundledNpmCli)) {
      return {
        command: process.execPath,
        prefixArgs: [bundledNpmCli],
        shell: false,
      };
    }

    return {
      command: 'npm.cmd',
      prefixArgs: [],
      shell: true,
    };
  }

  return {
    command: 'npm',
    prefixArgs: [],
    shell: false,
  };
}

function runNpm(args, options = {}) {
  const npm = getNpmInvocation();
  return spawnSync(npm.command, [...npm.prefixArgs, ...args], {
    cwd: rootDir,
    env: process.env,
    shell: npm.shell,
    ...options,
  });
}

function runNpmScript(name) {
  return runNpm(['run', name], {
    stdio: 'inherit',
  });
}

function runNpmAuditHigh() {
  return runNpm(['audit', '--omit=dev', '--audit-level=high'], {
    stdio: 'inherit',
  });
}

function runExpoConfigCheck() {
  const result = runNpm(['exec', '--', 'expo', 'config', '--type', 'public', '--json'], {
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    return result;
  }

  try {
    const config = JSON.parse(result.stdout);
    pass(`Expo config resolves for SDK ${config.sdkVersion || 'unknown'}`);
  } catch (error) {
    result.status = 1;
    result.stderr = `Expo config returned invalid JSON: ${error.message}`;
    process.stderr.write(result.stderr);
  }

  return result;
}

console.log('Checking mobile release readiness...\n');

const appConfig = readJson('app.json');
const easConfig = readJson('eas.json');
const releaseEnvironments = readJson('config/release-environments.json');
const storeMetadata = readJson('config/store-metadata.json');
const apiSource = readText('constants/api.js');

assertValue('ios.bundleIdentifier is set', appConfig?.expo?.ios?.bundleIdentifier);
assertValue('ios.buildNumber is set', appConfig?.expo?.ios?.buildNumber);
assertValue('android.package is set', appConfig?.expo?.android?.package);
assertValue('android.versionCode is set', appConfig?.expo?.android?.versionCode);

assertAppAsset('app icon is set', appConfig?.expo?.icon);
assertAppAsset('web favicon is set', appConfig?.expo?.web?.favicon);
assertAppAsset('android foreground icon is set', appConfig?.expo?.android?.adaptiveIcon?.foregroundImage);
assertAppAsset('android background icon is set', appConfig?.expo?.android?.adaptiveIcon?.backgroundImage);
assertAppAsset('android monochrome icon is set', appConfig?.expo?.android?.adaptiveIcon?.monochromeImage);

const cameraPlugin = getPluginConfig(appConfig, 'expo-camera');
const imagePickerPlugin = getPluginConfig(appConfig, 'expo-image-picker');
const localAuthPlugin = getPluginConfig(appConfig, 'expo-local-authentication');
const notificationPlugin = getPluginConfig(appConfig, 'expo-notifications');
getPluginConfig(appConfig, '@sentry/react-native/expo');
const locationPlugin = getPluginConfig(appConfig, 'expo-location');
const splashPlugin = getPluginConfig(appConfig, 'expo-splash-screen');
getPluginConfig(appConfig, 'expo-secure-store');
getPluginConfig(appConfig, './plugins/with-react-native-node-modules-dir.cjs');

assertValue('camera permission text is set', cameraPlugin.cameraPermission);
assertValue('photos permission text is set', imagePickerPlugin.photosPermission);
assertValue('Face ID permission text is set', localAuthPlugin.faceIDPermission);
assertValue('location permission text is set', locationPlugin.locationWhenInUsePermission);
assertAppAsset('notification icon is set', notificationPlugin.icon);
assertAppAsset('splash image is set', splashPlugin.image);

assertReleaseEnvironmentCatalog(releaseEnvironments);
for (const profileName of REQUIRED_BUILD_PROFILES) {
  assertBuildProfile(easConfig, releaseEnvironments, profileName);
}
assertDefaultApiUrlMatchesReleaseEnv(apiSource, releaseEnvironments);
assertValue('eas cli version guard is set', easConfig?.cli?.version);

assertFile('docs/mobile-device-smoke-checklist.md');
assertFile('docs/mobile-release-runbook.md');
assertFile('docs/mobile-release-risks.md');
assertFile('docs/mobile-preview-release-template.md');
assertFile('docs/mobile-store-readiness-checklist.md');
assertStoreMetadata(storeMetadata, appConfig);

if (process.exitCode) {
  console.error('\nRelease readiness check failed before smoke tests.');
  process.exit(process.exitCode);
}

console.log('\nValidating Expo public config...\n');

const expoConfigResult = runExpoConfigCheck();

if (expoConfigResult.status !== 0) {
  fail('npm exec -- expo config --type public failed');
  process.exit(process.exitCode);
}

console.log('\nRunning mobile smoke gate...\n');

const result = runNpmScript('smoke:mobile');

if (result.status !== 0) {
  fail('npm run smoke:mobile failed');
  process.exit(process.exitCode);
}

console.log('\nChecking Metro bundle resolution...\n');

if (process.env.SKIP_METRO_BUNDLE === '1') {
  console.log('Skipping Metro bundle check because SKIP_METRO_BUNDLE=1.');
} else {
  const metroResult = runNpmScript('test:metro-bundle');

  if (metroResult.status !== 0) {
    fail('npm run test:metro-bundle failed');
    process.exit(process.exitCode);
  }
}

console.log('\nChecking for high or critical production dependency advisories...\n');

const auditResult = runNpmAuditHigh();

if (auditResult.status !== 0) {
  fail('npm audit --omit=dev --audit-level=high failed');
  process.exit(process.exitCode);
}

console.log('\nMobile release readiness check passed.');
