// Site-wide share image (1200x630). Text uses the share-card fonts, loaded from the files
// named in the brand tokens. A missing font file fails the build.
import fs from 'node:fs';
import path from 'node:path';
import { loadBrand, renderSvgPng } from '../../../shared/og/index.js';

const brand = loadBrand(path.resolve(process.cwd(), '../shared/og/og-brand-tokens.json'));
const coo = fs.readFileSync(path.resolve(process.cwd(), 'public', 'coo.svg'), 'utf8')
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');
const family = `${brand.tokens.fonts.family}, sans-serif`;
const accent = brand.tokens.colors.url;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${brand.tokens.colors.background}"/>
  <circle cx="270" cy="315" r="200" fill="${brand.tokens.colors.medallion}"/>
  <svg x="85" y="130" width="370" height="370" viewBox="0 0 120 120">${coo}</svg>
  <text x="520" y="290" font-family="${family}" font-weight="700" font-size="80" fill="${brand.tokens.colors.name}">${brand.tokens.site_name}</text>
  <text x="524" y="365" font-family="${family}" font-weight="400" font-size="36" fill="${brand.tokens.colors.location}">Highland Games &amp; Celtic events</text>
  <text x="524" y="415" font-family="${family}" font-weight="400" font-size="36" fill="${brand.tokens.colors.location}">across Canada</text>
  <text x="524" y="480" font-family="${family}" font-weight="400" font-size="30" fill="${accent}">${brand.tokens.site_url}</text>
</svg>`;

export function GET() {
  const png = renderSvgPng(SVG, brand);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
}
