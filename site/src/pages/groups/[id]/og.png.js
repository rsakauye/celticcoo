// One share card per club, built at deploy from the shared template.
import path from 'node:path';
import { groups } from '../../../lib/data.js';
import { clubCardFields } from '../../../lib/groupProfiles.js';
import { loadBrand, renderCardPng } from '../../../../../shared/og/index.js';

const brand = loadBrand(path.resolve(process.cwd(), '../shared/og/og-brand-tokens.json'));

export function getStaticPaths() {
  return groups.map((g) => ({ params: { id: g.id }, props: { g } }));
}

export function GET({ props }) {
  const png = renderCardPng(clubCardFields(props.g), brand);
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
}
