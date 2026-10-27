# Shared profile links

Short public URLs for a directory: a readable slug and a permanent random short code. There is no package, no network, and no site name in the engine. Copy this folder into another site, edit a site pack, and call the two assigners.

## Layout

| Path | What it is |
|---|---|
| `engine.js` | Slugs, short codes, and static redirect lines. |
| `sites/celticcoo.js` | Filler words, suffixes, length, alphabet, and path prefixes for one site. |
| `index.js` | Re-exports. It does not import a site pack. |

## What you configure

| Field | Default | Meaning |
|---|---|---|
| `fillers` | the, of, and, a, an | Words dropped from a slug. |
| `suffixPhrases` | none | Multi-word suffixes dropped when other words remain. |
| `suffixWords` | none | Single-word suffixes dropped when other words remain. |
| `maxSlugLength` | 30 | Cut at a word boundary. A last word is kept when it lands within two characters. |
| `collisionField` | `city` | Record field appended when two slugs match. Never a number. |
| `collisionSkip` | none | Values of that field that are not a useful suffix (`national`). |
| `extraCollisionFields` | none | Later fields if the first suffix still collides. |
| `shortCodeLength` | 4 | Length of a new code. |
| `alphabet` | 31 symbols | Lowercase letters and digits, minus look-alikes `0`, `o`, `1`, `l`, and `i`. |
| `shortPrefix` | `/g/` | Public short path. |
| `profilePrefix` | `/` | Where a short code redirects. |
| `retiredCodes` | none | Codes that must never be minted again. |
| `shortCodeSeed` | | Seed used the first time codes were minted. |

## Use it

```js
import { assignShortCodes, assignSlugs, createRng, redirectLines } from './index.js';
import pack from './sites/celticcoo.js';

const slugs = assignSlugs(records, pack);
const codes = assignShortCodes(records, pack, createRng(pack.shortCodeSeed));
const redirects = redirectLines(records.map((record, i) => ({ ...record, slug: slugs[i], code: codes[i] })), pack);
```

`assignSlugs` returns a stored `slug` unchanged. `assignShortCodes` returns a stored `code` unchanged. Write both onto the record after the first run and leave them there. A new row with an empty `code` gets one new code. Deleting a row does not free its code: append that code to `retiredCodes`.

`redirectLines` emits one Cloudflare-style static redirect per case variant:

```
/g/k7mp /groups/example/ 301
/g/K7mp /groups/example/ 301
```

Put that list in the site's `_redirects` file. Lookup is case-insensitive because every variant is written out. The code itself is stored in lowercase and is not derived from the name.

## Another site

1. Copy `shared/slugs/`.
2. Add `sites/<your-site>.js` with that site's fillers, suffixes, and prefixes. Leave `engine.js` alone.
3. Point `profilePrefix` at the directory path and `shortPrefix` at the short path.
4. Commit the slugs, the codes, and the generated `_redirects` file.
