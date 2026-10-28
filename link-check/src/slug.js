// Same folding rules Celtic Coo uses for page anchors, kept here so this folder can be copied on its own.
export function slugify(value) {
  return String(value).toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
