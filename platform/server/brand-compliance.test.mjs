import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const platformDir = path.resolve(serverDir, '..');
const repositoryDir = path.resolve(platformDir, '..');
const prototypeDir = path.join(platformDir, 'public', 'prototypes');
const brandDir = path.join(platformDir, 'public', 'brand');
const prototypes = [
  'start.html',
  'portal-klienta.html',
  'gabinet-wyceniajacego.html',
  'arbor-mobile.html',
  'arbor-os.html',
];

test('brand stylesheet contains the exact Brand Book palette and Road UA faces', async () => {
  const css = await readFile(path.join(brandDir, 'brand.css'), 'utf8');
  for (const color of ['#3B2A18', '#766440', '#A0AF14', '#B4C232', '#BD701E']) {
    assert.ok(css.includes(color), `Brak koloru Brand Booka ${color}`);
  }
  for (const font of ['RoadUA-Regular.otf', 'RoadUA-Bold.otf', 'RoadUA-ExtraBold.otf']) {
    assert.ok(css.includes(font), `Brak oficjalnej odmiany ${font}`);
    await access(path.join(brandDir, 'fonts', font));
  }
  assert.match(css, /h1\s*\{[\s\S]*?font-weight:\s*800/);
  assert.match(css, /h2,[\s\S]*?font-weight:\s*700/);
});

test('all merged prototypes use local branding and official SVG logos', async () => {
  for (const fileName of prototypes) {
    const html = await readFile(path.join(prototypeDir, fileName), 'utf8');
    assert.ok(html.includes('href="/brand/brand.css"'), `${fileName}: brak brand.css`);
    assert.ok(html.includes("font-family: 'Road UA'"), `${fileName}: brak Road UA`);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|Hanken Grotesk/i, `${fileName}: obcy font`);
    assert.match(html, /<img[^>]+pf-official-logo[^>]+src="\/brand\/logo\/(?:with|without)-descriptor-[^"]+\.svg"/i);
  }
});

test('official logos exist and active web/mobile themes retain Brand Book colors', async () => {
  const logos = [
    'with-descriptor-horizontal-dark.svg',
    'with-descriptor-horizontal-light.svg',
    'without-descriptor-horizontal-dark.svg',
  ];
  for (const logo of logos) {
    const source = await readFile(path.join(brandDir, 'logo', logo), 'utf8');
    assert.match(source, /<svg\b/i, logo);
  }

  const webFiles = [
    path.join(repositoryDir, 'web', 'index.html'),
    path.join(repositoryDir, 'web', 'src', 'styles', 'polska-flora-brand.css'),
    path.join(repositoryDir, 'web', 'src', 'styles', 'ui-ux-pro-max-final.css'),
  ];
  for (const file of webFiles) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /Hanken Grotesk|fonts\.googleapis\.com/i, path.relative(repositoryDir, file));
  }

  const mobileBrand = await readFile(path.join(repositoryDir, 'mobile', 'constants', 'brand.ts'), 'utf8');
  const mobileTheme = await readFile(path.join(repositoryDir, 'mobile', 'constants', 'theme.ts'), 'utf8');
  for (const color of ['#3B2A18', '#766440', '#A0AF14', '#B4C232', '#BD701E']) {
    assert.ok(mobileBrand.includes(color), `mobile: brak koloru ${color}`);
  }
  assert.match(mobileTheme, /POLSKA_FLORA_COLORS/);
  assert.match(mobileBrand, /RoadUA-ExtraBold\.otf/);
});
