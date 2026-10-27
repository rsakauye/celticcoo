// Share-card renderer. Brand values come from one tokens file.
// This file does not name a site. Another site swaps that tokens file.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const X = 80;
const NAME_MAX_W = 740;
const SIDE_MAX_W = 740;
const NAME_SIZES = [80, 76, 72, 68, 64, 60, 56];
const LINE_H = 1.08;
const TYPE_SIZE = 30;
const LOC_SIZE = 36;
const TOP = 150;
const GAP_TYPE_NAME = 22;
const GAP_NAME_LOC = 58;
const W = 1200;
const H = 630;
const MED_CX = 1000;
const MED_CY = 300;
const MED_R = 135;
const TAG_Y = 548;

function gnum(n) {
  const rounded = Math.round((n + Number.EPSILON) * 1000) / 1000;
  return String(rounded);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function loadPackage(name) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i += 1) {
    for (const pkg of [path.join(dir, 'site', 'package.json'), path.join(dir, 'package.json')]) {
      if (!fs.existsSync(pkg)) continue;
      try {
        return createRequire(pkg)(name);
      } catch {
        // This package.json cannot see the module. Keep walking.
      }
    }
    dir = path.dirname(dir);
  }
  throw new Error(`Install ${name} next to the site that renders share cards.`);
}

const fontCache = new Map();

function typeface(file) {
  if (!fontCache.has(file)) {
    const opentype = loadPackage('opentype.js');
    fontCache.set(file, opentype.parse(fs.readFileSync(file)));
  }
  return fontCache.get(file);
}

function width(text, file, size) {
  return typeface(file).getAdvanceWidth(text, size);
}

function ellipsize(text, file, size, maxWidth) {
  if (width(text, file, size) <= maxWidth) return text;
  let rest = text;
  while (rest && width(`${rest.trimEnd()}\u2026`, file, size) > maxWidth) rest = rest.slice(0, -1);
  return `${rest.replace(/[ ,\u2013-]+$/u, '')}\u2026`;
}

function wrap(text, file, size, maxWidth) {
  const lines = [];
  let cur = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = (cur ? `${cur} ${word}` : word);
    if (!cur || width(next, file, size) <= maxWidth) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function loadBrand(tokensPath) {
  const file = path.resolve(tokensPath);
  const base = path.dirname(file);
  const tokens = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bold = path.resolve(base, tokens?.fonts?.bold || '');
  const regular = path.resolve(base, tokens?.fonts?.regular || '');
  for (const font of [bold, regular]) {
    if (!font || !fs.existsSync(font)) throw new Error(`Share-card font missing: ${font}`);
  }
  return { tokens, base, bold, regular, tokensPath: file };
}

function settPattern(id, sett, unit, weftOpacity, rotate = 0) {
  const n = sett.length;
  const size = unit * n;
  const warp = sett.map((color, i) => `<rect x="${gnum(i * unit)}" y="0" width="${gnum(unit)}" height="${gnum(size)}" fill="${color}"/>`).join('');
  const weft = sett.map((color, i) => `<rect x="0" y="${gnum(i * unit)}" width="${gnum(size)}" height="${gnum(unit)}" fill="${color}"/>`).join('');
  const transform = rotate ? ` patternTransform="rotate(${gnum(rotate)})"` : '';
  return `<pattern id="${id}" width="${gnum(size)}" height="${gnum(size)}" patternUnits="userSpaceOnUse"${transform}>${warp}<g opacity="${gnum(weftOpacity)}">${weft}</g></pattern>`;
}

function markSvg(tokens, base) {
  const mark = tokens.mark || {};
  if (!mark.svg) return { defs: '', body: '' };
  const src = fs.readFileSync(path.resolve(base, mark.svg), 'utf8');
  let body = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  body = body.replace(/<title[\s\S]*?<\/title>/g, '');
  body = body.replace(/<!--[\s\S]*?-->/g, '');
  body = body.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  for (const [from, to] of Object.entries(mark.recolor || {})) {
    body = body.replaceAll(from, String(to).replace('{pattern}', 'url(#brand-sett-mark)'));
  }
  const pattern = tokens.pattern;
  const defs = settPattern('brand-sett-mark', pattern.sett, mark.mark_unit, pattern.weft_opacity, mark.mark_rotate || 0);
  const size = Math.round(MED_R * 1.63);
  const x = MED_CX - size / 2;
  const y = MED_CY - size / 2 - 5;
  return {
    defs,
    body: `<svg id="brand-mark" x="${gnum(x)}" y="${gnum(y)}" width="${size}" height="${size}" viewBox="${mark.viewbox}" aria-hidden="true">${body}</svg>`,
  };
}

export function templateSvg(brand) {
  const { tokens } = brand;
  const colors = tokens.colors;
  const fonts = tokens.fonts;
  const pattern = tokens.pattern;
  const family = `${fonts.family}, sans-serif`;
  const tagline = String(tokens.tagline || '').replaceAll('{site}', tokens.site_name || '');
  const band = pattern.band_height_px;
  const rule = pattern.rule_px;
  const mark = markSvg(tokens, brand.base);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    ${settPattern('brand-sett-band', pattern.sett, pattern.band_unit_px, pattern.weft_opacity)}
    ${mark.defs}
  </defs>
  <rect id="bg" width="${W}" height="${H}" fill="${colors.background}"/>
  <rect id="band-top" x="0" y="0" width="${W}" height="${band}" fill="url(#brand-sett-band)"/>
  <rect id="rule-top" x="0" y="${band}" width="${W}" height="${rule}" fill="${colors.rule}"/>
  <rect id="band-bottom" x="0" y="${H - band}" width="${W}" height="${band}" fill="url(#brand-sett-band)"/>
  <rect id="rule-bottom" x="0" y="${H - band - rule}" width="${W}" height="${rule}" fill="${colors.rule}"/>
  <circle id="medallion" cx="${MED_CX}" cy="${MED_CY}" r="${MED_R}" fill="${colors.medallion}"/>
  ${mark.body}
  <text id="slot-type" x="${X}" y="150" font-family="${family}" font-weight="700" font-size="30" letter-spacing="2" fill="${colors.type}">{type}</text>
  <text id="slot-name" x="${X}" y="248" font-family="${family}" font-weight="700" font-size="80" fill="${colors.name}"><tspan x="${X}" y="248">{name}</tspan></text>
  <text id="slot-location" x="${X}" y="306" font-family="${family}" font-weight="400" font-size="36" fill="${colors.location}">{location}</text>
  <rect id="tagline-rule" x="${X}" y="${TAG_Y - 62}" width="64" height="4" fill="${colors.type}"/>
  <text id="tagline" x="${X}" y="${TAG_Y}" font-family="${family}" font-weight="700" font-size="34" fill="${colors.tagline}">${escapeXml(tagline)}</text>
  <text id="site-url" x="1140" y="${TAG_Y}" text-anchor="end" font-family="${family}" font-weight="400" font-size="28" fill="${colors.url}">${escapeXml(tokens.site_url || '')}</text>
</svg>
`;
}

export function fitName(name, boldFile) {
  const text = String(name || '');
  for (const size of NAME_SIZES) {
    const lines = wrap(text, boldFile, size, NAME_MAX_W);
    if (lines.length <= 2 && lines.every((line) => width(line, boldFile, size) <= NAME_MAX_W)) return { size, lines };
  }
  const size = NAME_SIZES[NAME_SIZES.length - 1];
  const lines = wrap(text, boldFile, size, NAME_MAX_W);
  const first = ellipsize(lines[0] || '', boldFile, size, NAME_MAX_W);
  const rest = lines.slice(1).join(' ');
  return { size, lines: rest ? [first, ellipsize(rest, boldFile, size, NAME_MAX_W)] : [first] };
}

export function layoutCard(fields, brand) {
  const name = String(fields?.name || '').trim() || String(brand.tokens.site_name || '').trim();
  const type = String(fields?.type || '').trim();
  const location = String(fields?.location || '').trim();
  const fitted = fitName(name, brand.bold);
  const typeText = type ? ellipsize(type.toUpperCase(), brand.bold, TYPE_SIZE, SIDE_MAX_W) : '';
  const locationText = location ? ellipsize(location, brand.regular, LOC_SIZE, SIDE_MAX_W) : '';
  const nameY = typeText
    ? TOP + GAP_TYPE_NAME + Math.round(fitted.size * 0.72) + 18
    : TOP + Math.round(fitted.size * 0.72) - 30;
  const last = nameY + Math.round(fitted.size * LINE_H) * (fitted.lines.length - 1);
  return {
    size: fitted.size,
    lines: fitted.lines,
    typeText,
    locationText,
    typeY: TOP,
    nameY,
    locationY: last + GAP_NAME_LOC,
  };
}

export function cardSvg(fields, brand) {
  const layout = layoutCard(fields, brand);
  const colors = brand.tokens.colors;
  const family = `${brand.tokens.fonts.family}, sans-serif`;
  let svg = templateSvg(brand);
  const tspans = layout.lines.map((line, i) => {
    const y = layout.nameY + i * Math.round(layout.size * LINE_H);
    return `<tspan x="${X}" y="${y}">${escapeXml(line)}</tspan>`;
  }).join('');
  svg = svg.replace(
    /<text id="slot-name"[\s\S]*?<\/text>/,
    `<text id="slot-name" x="${X}" y="${layout.nameY}" font-family="${family}" font-weight="700" font-size="${layout.size}" fill="${colors.name}">${tspans}</text>`,
  );
  if (layout.typeText) {
    svg = svg.replace(
      /<text id="slot-type"[\s\S]*?<\/text>/,
      `<text id="slot-type" x="${X}" y="${layout.typeY}" font-family="${family}" font-weight="700" font-size="30" letter-spacing="2" fill="${colors.type}">${escapeXml(layout.typeText)}</text>`,
    );
  } else {
    svg = svg.replace(/<text id="slot-type"[\s\S]*?<\/text>\s*/, '');
  }
  if (layout.locationText) {
    svg = svg.replace(
      /<text id="slot-location"[\s\S]*?<\/text>/,
      `<text id="slot-location" x="${X}" y="${layout.locationY}" font-family="${family}" font-weight="400" font-size="36" fill="${colors.location}">${escapeXml(layout.locationText)}</text>`,
    );
  } else {
    svg = svg.replace(/<text id="slot-location"[\s\S]*?<\/text>\s*/, '');
  }
  return svg;
}

export function renderSvgPng(svg, brand) {
  for (const font of [brand?.bold, brand?.regular]) {
    if (!font || !fs.existsSync(font)) throw new Error(`Share-card font missing: ${font}`);
  }
  const { Resvg } = loadPackage('@resvg/resvg-js');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: {
      fontFiles: [brand.bold, brand.regular],
      loadSystemFonts: false,
      defaultFontFamily: brand.tokens.fonts.family,
    },
  });
  const png = resvg.render().asPng();
  if (!png || png.length < 8) throw new Error('Share-card renderer produced an empty image.');
  return png;
}

export function renderCardPng(fields, brand) {
  return renderSvgPng(cardSvg(fields, brand), brand);
}
