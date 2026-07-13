const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CANONICAL_FONTS,
  CANONICAL_IDENTITY,
  CANONICAL_LOGOS,
  EXACT_PALETTE,
  assertDesignTokens,
  assertMirroredAssetHashes,
  createMirrorMappings,
  extractRoadUaFontFiles,
  normalizeHex,
  parseCssCustomProperties,
  resolveCssVariable,
  resolveJsonToken,
  runBrandContractCheck,
} = require("./brand-contract-check.cjs");

function withTempDirectory(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arbor-brand-contract-"));
  try {
    return callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function writeFile(baseDir, relPath, contents) {
  const filePath = path.join(baseDir, relPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

test("repository satisfies the complete Polska Flora brand contract", () => {
  const result = runBrandContractCheck();

  assert.equal(result.ok, true);
  assert.deepEqual(result.assets, { logos: 16, fonts: 8, identity: 14 });
  assert.equal(result.tokens.palette, 5);
  assert.ok(result.mirrors.checked >= 70);
});

test("canonical inventories contain the required 16 SVG, 8 OTF, and 14 PNG paths", () => {
  assert.equal(CANONICAL_LOGOS.length, 16);
  assert.equal(new Set(CANONICAL_LOGOS).size, 16);
  assert.ok(CANONICAL_LOGOS.every((file) => file.endsWith(".svg")));

  assert.equal(CANONICAL_FONTS.length, 8);
  assert.equal(new Set(CANONICAL_FONTS).size, 8);
  assert.ok(CANONICAL_FONTS.every((file) => file.endsWith(".otf")));

  assert.equal(CANONICAL_IDENTITY.length, 14);
  assert.equal(new Set(CANONICAL_IDENTITY).size, 14);
  assert.ok(CANONICAL_IDENTITY.every((file) => file.endsWith(".png")));
});

test("JSON and CSS token resolvers tolerate layout changes and follow semantic aliases", () => {
  const json = {
    primitive: {
      color: {
        green: { $value: "#a0af14" },
        brown: { $value: "#3b2a18" },
      },
    },
    semantic: {
      color: {
        primary: { $value: "{primitive.color.green}" },
        onPrimary: { $value: "{primitive.color.brown}" },
      },
    },
    component: {
      cta: {
        background: { $value: "{semantic.color.primary}" },
        foreground: { $value: "{semantic.color.onPrimary}" },
      },
    },
  };
  assert.equal(normalizeHex(resolveJsonToken(json, "component.cta.background")), EXACT_PALETTE.primaryGreen);
  assert.equal(normalizeHex(resolveJsonToken(json, "component.cta.foreground")), EXACT_PALETTE.darkBrown);

  const css = `
    /* formatting and comments must not matter */
    :root {
      --primitive-green : #a0af14 ;
      --primitive-brown:\n#3b2a18;
      --semantic-primary: var( --primitive-green );
      --semantic-on-primary : var(--primitive-brown);
      --cta-bg: var(--semantic-primary);
      --cta-fg: var( --semantic-on-primary );
    }
  `;
  const properties = parseCssCustomProperties(css);
  assert.equal(normalizeHex(resolveCssVariable(properties, "--cta-bg")), EXACT_PALETTE.primaryGreen);
  assert.equal(normalizeHex(resolveCssVariable(properties, "--cta-fg")), EXACT_PALETTE.darkBrown);
});

test("CSS font-face extraction recognizes Road UA sources independently of quote style", () => {
  const css = `
    @font-face {
      src: url("./fonts/RoadUA-Regular.otf?rev=1") format("opentype");
      font-family: "Road UA";
    }
    @font-face { font-family: 'Other'; src: url('./Other.otf'); }
    @font-face {
      font-family: Road UA;
      src: url(./fonts/RoadUA-Bold.otf#font);
    }
  `;

  assert.deepEqual(
    [...extractRoadUaFontFiles(css)].sort(),
    ["RoadUA-Bold.otf", "RoadUA-Regular.otf"],
  );
});

test("mirror hash assertion checks existing copies and reports a changed byte", () => {
  withTempDirectory((baseDir) => {
    const canonical = "assets/canonical.svg";
    const copy = "web/public/copy.svg";
    writeFile(baseDir, canonical, "approved-logo");
    writeFile(baseDir, copy, "approved-logo");

    assert.deepEqual(
      assertMirroredAssetHashes(baseDir, [{ canonical, copy }]),
      { checked: 1, skipped: 0 },
    );

    writeFile(baseDir, copy, "changed-logo");
    assert.throws(
      () => assertMirroredAssetHashes(baseDir, [{ canonical, copy }]),
      /SHA-256 mismatch.*copy\.svg.*canonical\.svg/,
    );
  });
});

test("mirror hash assertion skips absent optional mirrors but requires one real copy", () => {
  withTempDirectory((baseDir) => {
    writeFile(baseDir, "assets/canonical.svg", "approved-logo");
    assert.throws(
      () =>
        assertMirroredAssetHashes(baseDir, [
          { canonical: "assets/canonical.svg", copy: "mobile/assets/missing.svg" },
        ]),
      /No web\/mobile brand mirrors/,
    );
  });
});

test("live design-token check locks green CTA to semantic dark-brown foreground", () => {
  const result = assertDesignTokens();
  assert.equal(result.palette, 5);
  assert.ok(result.fontFaces >= 8);
});

test("mirror mapping covers both applications and legacy web logo aliases", () => {
  const mappings = createMirrorMappings();
  assert.ok(mappings.some(({ copy }) => copy.startsWith("web/public/brand/logo/")));
  assert.ok(mappings.some(({ copy }) => copy.startsWith("mobile/assets/brand/logos/")));
  assert.ok(mappings.some(({ copy }) => copy === "web/public/brand/polska-flora-logo.svg"));
  assert.ok(mappings.some(({ copy }) => copy === "web/public/brand/polska-flora-logo-dark.svg"));
});
