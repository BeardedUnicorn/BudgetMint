#!/usr/bin/env node
/**
 * Makes BudgetMint's brand images from the SVG masters in assets/brand:
 *
 *   node scripts/brand/render.mjs
 *
 * - assets/brand/icon.png: the app icon (icon.svg), full-bleed, as TaskMint's.
 * - assets/brand/icon-macos.png: the same tile on Apple's icon grid (824 of
 *   1024, with its shadow), for the .icns and Android's launcher icons.
 * - assets/brand/mark.png, logo.png, logo-dark.png: the leaf and the wordmark.
 * - apps/desktop/src-tauri/icons/tray-template.png: the menu-bar icon.
 * - packages/client/public: the favicon, the icon and the wordmarks the app shows.
 * - apps/web/public: the web app's install icons (its manifest's, and the
 *   home screen's on iOS) and its link-preview card.
 *
 * The wordmark is set in Avenir Next Heavy, which macOS has; the PNGs are
 * committed, so only a change to a master needs this again. Then make the
 * bundle icons from icon.png and icon-macos.png (README → App icons).
 */
import { Resvg } from '@resvg/resvg-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const brand = join(root, 'assets/brand');
const FONT = '/System/Library/Fonts/Avenir Next.ttc';

const master = name => readFileSync(join(brand, name), 'utf8');
/** An SVG's contents, without its outer <svg> element. */
const inner = svg => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

const FONTS = { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'Avenir Next' };

const render = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: FONTS }).render();

/** `svg` cut to what it draws (plus `pad`, in its own units), `height` px high. */
function fitted(svg, height, pad = 12) {
  const box = new Resvg(svg, { font: FONTS }).getBBox();
  const [x, y, w, h] = [box.x - pad, box.y - pad, box.width + 2 * pad, box.height + 2 * pad];
  const cut = svg.replace(
    /viewBox="[^"]*" width="[^"]*" height="[^"]*"/,
    `viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}"`
  );
  return new Resvg(cut, { fitTo: { mode: 'height', value: height }, font: FONTS }).render();
}

function write(path, image) {
  const out = join(root, path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, image.asPng());
  console.log(`${path} (${image.width}×${image.height})`);
}

/** The tile on Apple's grid: 824 px of 1024, raised by a soft shadow. */
const macos = icon => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
    <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.32"/>
  </filter></defs>
  <g filter="url(#shadow)"><svg x="100" y="100" width="824" height="824" viewBox="0 0 1024 1024">${inner(icon)}</svg></g>
</svg>`;

/** `text` with its one `from` replaced; stops if a master changed and `from` isn't there once. */
function only(text, from, to) {
  if (text.split(from).length !== 2) throw new Error(`Expected one ${from} in the master`);
  return text.replace(from, to);
}

/** The link-preview card (Open Graph's 1200×630): the wordmark on the icon's tile. */
function card(wordmark) {
  const box = new Resvg(wordmark, { font: FONTS }).getBBox();
  const height = 150;
  const width = (box.width / box.height) * height;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs><linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#104B4F"/><stop offset="1" stop-color="#05292E"/>
  </linearGradient></defs>
  <rect width="1200" height="630" fill="url(#card)"/>
  <svg x="${(1200 - width) / 2}" y="200" width="${width}" height="${height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${inner(wordmark)}</svg>
  <text x="600" y="440" text-anchor="middle" font-family="Avenir Next" font-weight="500" font-size="40" fill="#DFF5E9">Your bills, your TaskMint payouts, and what’s left</text>
</svg>`;
}

if (!existsSync(FONT)) {
  console.error(`The wordmark needs ${FONT} (macOS).`);
  process.exit(1);
}

const icon = master('icon.svg');
const mark = master('mark.svg');
const logo = master('logo.svg').replace('MARK', inner(mark));
const logoDark = logo.replace('id="first" fill="#023222"', 'id="first" fill="#E8F5ED"');

write('assets/brand/icon.png', render(icon, 1024));
write('assets/brand/icon-macos.png', render(macos(icon), 1024));
write('assets/brand/mark.png', render(mark, 512));
write('assets/brand/logo.png', fitted(logo, 496));
write('assets/brand/logo-dark.png', fitted(logoDark, 496));
write('apps/desktop/src-tauri/icons/tray-template.png', render(master('tray-template.svg'), 64));
write('packages/client/public/favicon.png', render(icon, 64));
write('packages/client/public/budgetmint-icon.png', render(icon, 256));
// The wordmark the app shows, 128 px high (as TaskMint's)
write('packages/client/public/budgetmint-logo.png', fitted(logo, 128));
write('packages/client/public/budgetmint-logo-dark.png', fitted(logoDark, 128));
// The web app's: the tile as the app's, and full-bleed where the system
// draws its own shape (iOS's home screen; Android's masks, with the drawing
// inside their safe zone, the middle 80%)
const square = only(icon, 'rx="230"', 'rx="0"');
const maskable = only(square, 'scale(1.1)', 'scale(0.88)');
write('apps/web/public/icons/icon-192.png', render(icon, 192));
write('apps/web/public/icons/icon-512.png', render(icon, 512));
write('apps/web/public/icons/maskable-512.png', render(maskable, 512));
write('apps/web/public/apple-touch-icon.png', render(square, 180));
write('apps/web/public/social.png', render(card(logoDark), 1200));
