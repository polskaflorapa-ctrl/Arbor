const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const EXACT_PALETTE = Object.freeze({
  darkBrown: "#3B2A18",
  lightBrown: "#766440",
  primaryGreen: "#A0AF14",
  lightGreen: "#B4C232",
  orangeBrown: "#BD701E",
});

const ROAD_UA_FONT_FILES = Object.freeze([
  "RoadUA-Black.otf",
  "RoadUA-Bold.otf",
  "RoadUA-ExtraBold.otf",
  "RoadUA-ExtraLight.otf",
  "RoadUA-Light.otf",
  "RoadUA-Medium.otf",
  "RoadUA-Regular.otf",
  "RoadUA-Thin.otf",
]);

const DESCRIPTORS = Object.freeze(["with-descriptor", "without-descriptor"]);
const ORIENTATIONS = Object.freeze(["horizontal", "vertical"]);
const LOGO_VARIANTS = Object.freeze([
  "black",
  "color-dark-background",
  "color-light-background",
  "white",
]);

const CANONICAL_LOGOS = Object.freeze(
  DESCRIPTORS.flatMap((descriptor) =>
    ORIENTATIONS.flatMap((orientation) =>
      LOGO_VARIANTS.map(
        (variant) =>
          `assets/brand/polska-flora/logos/${descriptor}/${orientation}/${variant}.svg`,
      ),
    ),
  ),
);

const CANONICAL_FONTS = Object.freeze(
  ROAD_UA_FONT_FILES.map(
    (file) => `assets/brand/polska-flora/fonts/road-ua/${file}`,
  ),
);

const CANONICAL_IDENTITY = Object.freeze([
  ...[
    "dark-brown",
    "dark-green",
    "grey",
    "light-brown",
    "light-green",
    "orange-brown",
  ].map((name) => `assets/brand/polska-flora/identity/pattern/${name}.png`),
  ...["grey", "light-brown", "light-green"].map(
    (name) => `assets/brand/polska-flora/identity/pattern-tree/${name}.png`,
  ),
  ...["dark-brown", "dark-green", "grey", "light-brown", "light-green"].map(
    (name) => `assets/brand/polska-flora/identity/tree/${name}.png`,
  ),
]);

const JSON_PALETTE_PATHS = Object.freeze({
  darkBrown: "primitive.color.brand.darkBrown",
  lightBrown: "primitive.color.brand.lightBrown",
  primaryGreen: "primitive.color.brand.primaryGreen",
  lightGreen: "primitive.color.brand.lightGreen",
  orangeBrown: "primitive.color.brand.orangeBrown",
});

const CSS_PALETTE_VARIABLES = Object.freeze({
  darkBrown: "--pf-color-dark-brown",
  lightBrown: "--pf-color-light-brown",
  primaryGreen: "--pf-color-primary-green",
  lightGreen: "--pf-color-light-green",
  orangeBrown: "--pf-color-orange-brown",
});

function normalizeRelPath(value) {
  return value.split(path.sep).join("/");
}

function normalizeHex(value) {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value.trim())) {
    return null;
  }
  return value.trim().toUpperCase();
}

function getAtPath(object, dottedPath) {
  return dottedPath.split(".").reduce((value, segment) => {
    if (value === null || value === undefined || typeof value !== "object") {
      return undefined;
    }
    return value[segment];
  }, object);
}

function tokenValue(token) {
  if (token && typeof token === "object" && Object.hasOwn(token, "$value")) {
    return token.$value;
  }
  return token;
}

function resolveJsonToken(document, dottedPath, seen = new Set()) {
  if (seen.has(dottedPath)) {
    throw new Error(`JSON token alias cycle: ${[...seen, dottedPath].join(" -> ")}`);
  }
  const raw = tokenValue(getAtPath(document, dottedPath));
  if (raw === undefined) {
    throw new Error(`Missing JSON token: ${dottedPath}`);
  }
  const alias = typeof raw === "string" ? raw.match(/^\{([^{}]+)\}$/) : null;
  if (!alias) return raw;
  return resolveJsonToken(document, alias[1], new Set([...seen, dottedPath]));
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseCssCustomProperties(css) {
  const properties = new Map();
  const clean = stripCssComments(css);
  const declaration = /(--[a-z0-9_-]+)\s*:\s*([^;{}]+)\s*;/gi;
  for (const match of clean.matchAll(declaration)) {
    // Keep the first declaration: shared token files define the default/root
    // contract before optional scoped theme overrides.
    if (!properties.has(match[1])) {
      properties.set(match[1], match[2].replace(/\s*!important\s*$/i, "").trim());
    }
  }
  return properties;
}

function resolveCssVariable(properties, variableName, seen = new Set()) {
  if (seen.has(variableName)) {
    throw new Error(`CSS variable alias cycle: ${[...seen, variableName].join(" -> ")}`);
  }
  if (!properties.has(variableName)) {
    throw new Error(`Missing CSS variable: ${variableName}`);
  }
  const raw = properties.get(variableName).trim();
  const alias = raw.match(/^var\(\s*(--[a-z0-9_-]+)\s*(?:,[^)]+)?\)$/i);
  if (!alias) return raw;
  return resolveCssVariable(properties, alias[1], new Set([...seen, variableName]));
}

function extractRoadUaFontFiles(css) {
  const files = new Set();
  const clean = stripCssComments(css);
  const fontFace = /@font-face\s*\{([\s\S]*?)\}/gi;
  for (const match of clean.matchAll(fontFace)) {
    const block = match[1];
    if (!/font-family\s*:\s*(["'])?Road UA\1\s*;/i.test(block)) continue;
    const url = /url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi;
    for (const source of block.matchAll(url)) {
      const cleanUrl = source[2].split(/[?#]/, 1)[0];
      files.add(path.posix.basename(cleanUrl.replaceAll("\\", "/")));
    }
  }
  return files;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${String(actual)}`);
  }
}

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function readText(relPath, baseDir = root) {
  return fs.readFileSync(path.join(baseDir, relPath), "utf8");
}

function assertDesignTokens(baseDir = root) {
  const json = readJson("assets/design-tokens.json", baseDir);
  const css = readText("assets/design-tokens.css", baseDir);
  const cssProperties = parseCssCustomProperties(css);

  for (const [name, expected] of Object.entries(EXACT_PALETTE)) {
    const jsonValue = resolveJsonToken(json, JSON_PALETTE_PATHS[name]);
    assertEqual(normalizeHex(jsonValue), expected, `JSON palette ${name}`);

    const cssValue = resolveCssVariable(cssProperties, CSS_PALETTE_VARIABLES[name]);
    assertEqual(normalizeHex(cssValue), expected, `CSS palette ${name}`);
  }

  const jsonFontFamily = resolveJsonToken(json, "primitive.fontFamily.brand");
  if (!Array.isArray(jsonFontFamily) || !jsonFontFamily.includes("Road UA")) {
    throw new Error("JSON brand font family must include Road UA");
  }

  const cssFontFamily = resolveCssVariable(cssProperties, "--pf-font-family-brand");
  if (!/(^|["'\s,])Road UA(["'\s,]|$)/i.test(cssFontFamily)) {
    throw new Error("CSS brand font family must include Road UA");
  }

  const cssFontFiles = extractRoadUaFontFiles(css);
  const missingCssFonts = ROAD_UA_FONT_FILES.filter((file) => !cssFontFiles.has(file));
  if (missingCssFonts.length) {
    throw new Error(`CSS Road UA font faces missing: ${missingCssFonts.join(", ")}`);
  }

  const jsonButtonBackground = resolveJsonToken(json, "component.button.primaryBackground");
  const jsonButtonForeground = resolveJsonToken(json, "component.button.primaryForeground");
  assertEqual(normalizeHex(jsonButtonBackground), EXACT_PALETTE.primaryGreen, "JSON primary CTA background");
  assertEqual(normalizeHex(jsonButtonForeground), EXACT_PALETTE.darkBrown, "JSON primary CTA foreground");
  assertEqual(
    tokenValue(getAtPath(json, "component.button.primaryForeground")),
    "{semantic.color.primaryForeground}",
    "JSON primary CTA semantic foreground alias",
  );

  const cssButtonBackground = resolveCssVariable(cssProperties, "--button-primary-background");
  const cssButtonForeground = resolveCssVariable(cssProperties, "--button-primary-foreground");
  assertEqual(normalizeHex(cssButtonBackground), EXACT_PALETTE.primaryGreen, "CSS primary CTA background");
  assertEqual(normalizeHex(cssButtonForeground), EXACT_PALETTE.darkBrown, "CSS primary CTA foreground");
  assertEqual(
    cssProperties.get("--button-primary-foreground"),
    "var(--color-primary-foreground)",
    "CSS primary CTA semantic foreground alias",
  );

  return { palette: Object.keys(EXACT_PALETTE).length, fontFaces: cssFontFiles.size };
}

function assertFiles(files, label, baseDir = root) {
  const missing = [];
  const empty = [];
  for (const relPath of files) {
    const absolutePath = path.join(baseDir, relPath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      missing.push(relPath);
    } else if (fs.statSync(absolutePath).size === 0) {
      empty.push(relPath);
    }
  }
  if (missing.length) throw new Error(`${label} missing: ${missing.join(", ")}`);
  if (empty.length) throw new Error(`${label} empty: ${empty.join(", ")}`);
}

function assertCanonicalAssets(baseDir = root) {
  assertEqual(CANONICAL_LOGOS.length, 16, "Canonical logo inventory size");
  assertEqual(CANONICAL_FONTS.length, 8, "Canonical font inventory size");
  assertEqual(CANONICAL_IDENTITY.length, 14, "Canonical identity inventory size");
  assertFiles(CANONICAL_LOGOS, "Canonical SVG logos", baseDir);
  assertFiles(CANONICAL_FONTS, "Canonical Road UA fonts", baseDir);
  assertFiles(CANONICAL_IDENTITY, "Canonical identity PNGs", baseDir);
  return { logos: 16, fonts: 8, identity: 14 };
}

function webLogoPath(descriptor, orientation, variant) {
  const shortVariant = variant
    .replace("color-dark-background", "dark")
    .replace("color-light-background", "light");
  return `web/public/brand/logo/${descriptor}-${orientation}-${shortVariant}.svg`;
}

function mobileLogoPath(descriptor, orientation, variant) {
  const shortVariant = variant
    .replace("color-dark-background", "dark")
    .replace("color-light-background", "light");
  return `mobile/assets/brand/logos/${descriptor}/svg/${orientation}-${shortVariant}.svg`;
}

function createMirrorMappings() {
  const mappings = [];
  for (const descriptor of DESCRIPTORS) {
    for (const orientation of ORIENTATIONS) {
      for (const variant of LOGO_VARIANTS) {
        const canonical = `assets/brand/polska-flora/logos/${descriptor}/${orientation}/${variant}.svg`;
        mappings.push({ canonical, copy: webLogoPath(descriptor, orientation, variant) });
        mappings.push({ canonical, copy: mobileLogoPath(descriptor, orientation, variant) });
      }
    }
  }

  mappings.push({
    canonical: "assets/brand/polska-flora/logos/without-descriptor/horizontal/color-light-background.svg",
    copy: "web/public/brand/polska-flora-logo.svg",
  });
  mappings.push({
    canonical: "assets/brand/polska-flora/logos/without-descriptor/horizontal/color-dark-background.svg",
    copy: "web/public/brand/polska-flora-logo-dark.svg",
  });

  for (const file of ROAD_UA_FONT_FILES) {
    const canonical = `assets/brand/polska-flora/fonts/road-ua/${file}`;
    mappings.push({ canonical, copy: `web/public/brand/fonts/${file}` });
    mappings.push({ canonical, copy: `mobile/assets/brand/fonts/${file}` });
  }

  const identityCopies = [
    ["pattern", "web/public/brand/patterns", "mobile/assets/brand/patterns"],
    ["pattern-tree", "web/public/brand/pattern-tree", "mobile/assets/brand/pattern-trees"],
    ["tree", "web/public/brand/tree", "mobile/assets/brand/trees"],
  ];
  for (const [canonicalGroup, webDir, mobileDir] of identityCopies) {
    const prefix = `assets/brand/polska-flora/identity/${canonicalGroup}/`;
    for (const canonical of CANONICAL_IDENTITY.filter((file) => file.startsWith(prefix))) {
      const file = path.posix.basename(canonical);
      mappings.push({ canonical, copy: `${webDir}/${file}` });
      mappings.push({ canonical, copy: `${mobileDir}/${file}` });
    }
  }
  return mappings;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function assertMirroredAssetHashes(baseDir = root, mappings = createMirrorMappings()) {
  let checked = 0;
  let skipped = 0;
  for (const mapping of mappings) {
    const canonicalPath = path.join(baseDir, mapping.canonical);
    const copyPath = path.join(baseDir, mapping.copy);
    if (!fs.existsSync(copyPath)) {
      skipped += 1;
      continue;
    }
    if (!fs.existsSync(canonicalPath)) {
      throw new Error(`Mirror has no canonical source: ${mapping.copy} -> ${mapping.canonical}`);
    }
    const canonicalHash = sha256File(canonicalPath);
    const copyHash = sha256File(copyPath);
    if (canonicalHash !== copyHash) {
      throw new Error(
        `SHA-256 mismatch: ${mapping.copy} differs from ${mapping.canonical}`,
      );
    }
    checked += 1;
  }
  if (checked === 0) throw new Error("No web/mobile brand mirrors were found to hash");
  return { checked, skipped };
}

function assertContains(text, pattern, label) {
  const present = pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
  if (!present) throw new Error(`Missing ${label}`);
}

function assertWebIntegration(baseDir = root) {
  const requiredCode = [
    "web/src/components/BrandLogo.js",
    "web/src/components/Sidebar.js",
    "web/src/pages/Login.js",
    "web/src/pages/LandingPage.js",
    "web/src/index.css",
    "web/src/index.jsx",
    "web/src/styles/polska-flora-brand.css",
  ];
  const webAssets = [
    ...ROAD_UA_FONT_FILES.map((file) => `web/public/brand/fonts/${file}`),
    ...DESCRIPTORS.flatMap((descriptor) =>
      ORIENTATIONS.flatMap((orientation) =>
        LOGO_VARIANTS.map((variant) => webLogoPath(descriptor, orientation, variant)),
      ),
    ),
  ];
  assertFiles([...requiredCode, ...webAssets], "Web brand integration", baseDir);

  const logoModule = readText("web/src/components/BrandLogo.js", baseDir);
  assertContains(logoModule, /["']\/brand\/logo["']/, "web canonical logo base");
  for (const word of ["withDescriptor", "horizontal", "vertical", "light", "dark"]) {
    assertContains(logoModule, new RegExp(`\\b${word}\\b`), `web logo variant ${word}`);
  }

  for (const file of [
    "web/src/components/Sidebar.js",
    "web/src/pages/Login.js",
    "web/src/pages/LandingPage.js",
  ]) {
    const text = readText(file, baseDir);
    assertContains(text, /import\s+BrandLogo\s+from\s+["'][^"']*BrandLogo["']\s*;/, `${file} BrandLogo import`);
    assertContains(text, /<BrandLogo\b/, `${file} BrandLogo usage`);
  }

  const webCss = readText("web/src/index.css", baseDir);
  const webFontFiles = extractRoadUaFontFiles(webCss);
  const missingFonts = ROAD_UA_FONT_FILES.filter((file) => !webFontFiles.has(file));
  if (missingFonts.length) throw new Error(`Web Road UA font faces missing: ${missingFonts.join(", ")}`);

  const entry = readText("web/src/index.jsx", baseDir);
  assertContains(entry, /import\s+["']\.\/styles\/polska-flora-brand\.css["']\s*;/, "web final brand stylesheet import");

  const brandCssText = readText("web/src/styles/polska-flora-brand.css", baseDir);
  const brandCss = parseCssCustomProperties(brandCssText);
  assertEqual(
    normalizeHex(resolveCssVariable(brandCss, "--on-accent")),
    EXACT_PALETTE.darkBrown,
    "Web green accent foreground",
  );
  assertContains(
    brandCssText,
    /#root\s+\.arbor-os-primary-button[\s\S]*?background:\s*var\(--brand-primary-green\)\s*!important;[\s\S]*?color:\s*var\(--brand-dark-brown\)\s*!important;/,
    "dashboard primary CTA brand contrast",
  );

  return { files: requiredCode.length, logos: 16, fonts: 8 };
}

function findExpoPlugin(expo, pluginName) {
  return (expo.plugins || []).find((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    return name === pluginName;
  });
}

function assertMobileIntegration(baseDir = root) {
  const requiredCode = [
    "mobile/app.json",
    "mobile/constants/brand.ts",
    "mobile/constants/theme.ts",
    "mobile/components/ui/brand-logo.tsx",
    "mobile/app/_layout.tsx",
    "mobile/app/login.tsx",
    "mobile/app/dashboard.tsx",
  ];
  const mobileAssets = [
    ...ROAD_UA_FONT_FILES.map((file) => `mobile/assets/brand/fonts/${file}`),
    ...DESCRIPTORS.flatMap((descriptor) =>
      ORIENTATIONS.flatMap((orientation) =>
        LOGO_VARIANTS.map((variant) => mobileLogoPath(descriptor, orientation, variant)),
      ),
    ),
  ];
  assertFiles([...requiredCode, ...mobileAssets], "Mobile brand integration", baseDir);

  const appJson = readJson("mobile/app.json", baseDir);
  const expo = appJson.expo || {};
  assertContains(expo.icon || "", "./assets/brand/app-icons/", "mobile branded app icon");
  assertContains(expo.web?.favicon || "", "./assets/brand/app-icons/", "mobile branded favicon");

  const fontPlugin = findExpoPlugin(expo, "expo-font");
  if (!Array.isArray(fontPlugin) || !fontPlugin[1] || !Array.isArray(fontPlugin[1].fonts)) {
    throw new Error("Missing configured Expo Road UA font plugin");
  }
  const configuredFontFiles = new Set(fontPlugin[1].fonts.map((file) => path.posix.basename(file)));
  const missingConfiguredFonts = ROAD_UA_FONT_FILES.filter((file) => !configuredFontFiles.has(file));
  if (missingConfiguredFonts.length) {
    throw new Error(`Expo font plugin missing: ${missingConfiguredFonts.join(", ")}`);
  }

  const splashPlugin = findExpoPlugin(expo, "expo-splash-screen");
  if (!Array.isArray(splashPlugin) || !splashPlugin[1]) {
    throw new Error("Missing branded Expo splash-screen plugin");
  }
  assertContains(
    splashPlugin[1].image || "",
    "/assets/brand/logos/with-descriptor/png/horizontal-light.png",
    "mobile light splash logo",
  );
  assertContains(
    splashPlugin[1].dark?.image || "",
    "/assets/brand/logos/with-descriptor/png/horizontal-dark.png",
    "mobile dark splash logo",
  );

  const brandModule = readText("mobile/constants/brand.ts", baseDir);
  for (const [name, hex] of Object.entries(EXACT_PALETTE)) {
    assertContains(brandModule, new RegExp(`\\b${name}\\s*:\\s*["']${hex}["']`, "i"), `mobile palette ${name}`);
  }
  for (const file of ROAD_UA_FONT_FILES) {
    assertContains(brandModule, file, `mobile brand font ${file}`);
  }

  const logoModule = readText("mobile/components/ui/brand-logo.tsx", baseDir);
  for (const segment of ["with-descriptor", "without-descriptor", "horizontal-light.png", "horizontal-dark.png", "vertical-light.png", "vertical-dark.png"]) {
    assertContains(logoModule, segment, `mobile approved logo ${segment}`);
  }

  const layout = readText("mobile/app/_layout.tsx", baseDir);
  assertContains(layout, /useFonts\s*\(\s*ROAD_UA_ASSETS\s*\)/, "mobile Road UA runtime loading");

  for (const file of ["mobile/app/login.tsx", "mobile/app/dashboard.tsx"]) {
    const text = readText(file, baseDir);
    assertContains(text, /import\s*\{[^}]*\bBrandLogo\b[^}]*\}\s*from\s*["'][^"']*brand-logo["']\s*;/s, `${file} BrandLogo import`);
    assertContains(text, /<BrandLogo\b/, `${file} BrandLogo usage`);
  }

  const theme = readText("mobile/constants/theme.ts", baseDir);
  assertContains(theme, /accent\s*:\s*POLSKA_FLORA_COLORS\.primaryGreen/, "mobile green accent semantic");
  assertContains(theme, /accentText\s*:\s*POLSKA_FLORA_COLORS\.darkBrown/, "mobile dark-brown accent foreground semantic");

  return { files: requiredCode.length, logos: 16, fonts: 8 };
}

function assertBrandIntegrations(baseDir = root) {
  return {
    web: assertWebIntegration(baseDir),
    mobile: assertMobileIntegration(baseDir),
  };
}

function runBrandContractCheck(options = {}) {
  const baseDir = options.root || root;
  const checks = [
    ["design tokens", () => assertDesignTokens(baseDir)],
    ["canonical assets", () => assertCanonicalAssets(baseDir)],
    ["mirrored asset hashes", () => assertMirroredAssetHashes(baseDir)],
    ["web/mobile integration", () => assertBrandIntegrations(baseDir)],
  ];
  const results = {};
  const failures = [];
  for (const [name, check] of checks) {
    try {
      results[name] = check();
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    }
  }
  if (failures.length) {
    throw new Error(`Brand contract failed:\n- ${failures.join("\n- ")}`);
  }
  return {
    ok: true,
    tokens: results["design tokens"],
    assets: results["canonical assets"],
    mirrors: results["mirrored asset hashes"],
    integrations: results["web/mobile integration"],
  };
}

if (require.main === module) {
  try {
    const result = runBrandContractCheck();
    console.log(
      `[brand-contract] PASS palette=${result.tokens.palette} ` +
        `logos=${result.assets.logos} fonts=${result.assets.fonts} ` +
        `identity=${result.assets.identity} mirrors=${result.mirrors.checked}`,
    );
  } catch (error) {
    console.error(`[brand-contract] FAIL\n${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CANONICAL_FONTS,
  CANONICAL_IDENTITY,
  CANONICAL_LOGOS,
  EXACT_PALETTE,
  ROAD_UA_FONT_FILES,
  assertBrandIntegrations,
  assertCanonicalAssets,
  assertDesignTokens,
  assertMirroredAssetHashes,
  createMirrorMappings,
  extractRoadUaFontFiles,
  getAtPath,
  normalizeHex,
  parseCssCustomProperties,
  resolveCssVariable,
  resolveJsonToken,
  runBrandContractCheck,
  sha256File,
};
