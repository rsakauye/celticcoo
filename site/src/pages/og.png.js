// Social share image (1200x630), rendered at build time from the site's own logo with sharp (bundled with Astro).
// If sharp is unavailable the build still succeeds and falls back to the mascot SVG (most social sites will not show it).
import fs from 'node:fs';
import path from 'node:path';
const coo = Buffer.from(fs.readFileSync(path.resolve(process.cwd(), 'public', 'coo.svg'), 'utf8')).toString('base64');
const b64 = coo;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630"><rect width="1200" height="630" fill="#1f4d3a"/><circle cx="270" cy="315" r="200" fill="#f4e6c8"/><image x="85" y="130" width="370" height="370" href="data:image/svg+xml;base64,${b64}"/><text x="520" y="290" font-family="DejaVu Serif, serif" font-weight="bold" font-size="80" fill="#fff">The Celtic Coo</text><text x="524" y="365" font-family="DejaVu Sans, sans-serif" font-size="36" fill="#f4e6c8">Highland Games &amp; Celtic events</text><text x="524" y="415" font-family="DejaVu Sans, sans-serif" font-size="36" fill="#f4e6c8">across Canada</text><text x="524" y="480" font-family="DejaVu Sans, sans-serif" font-size="30" fill="#e0843f">celticcoo.ca</text></svg>`;
export async function GET() {
  try {
    const { default: sharp } = await import('sharp');
    const png = await sharp(Buffer.from(SVG)).png().toBuffer();
    return new Response(png, { headers: { 'Content-Type': 'image/png' } });
  } catch (e) {
    console.warn('[og.png] sharp unavailable, using fallback:', e.message);
    return new Response(fs.readFileSync(path.resolve(process.cwd(), 'public', 'coo.svg')), { headers: { 'Content-Type': 'image/png' } });
  }
}
