# Shared share cards

Build-time pictures for a shared link. 1200 by 630. There is no site name in the renderer. Another site swaps `og-brand-tokens.json` and the font and mark files that JSON points at.

## Layout

| Path | What it is |
|---|---|
| `engine.js` | Template, text fitting, and PNG render. |
| `og-brand-tokens.json` | The only per-site file: colours, fonts, sett, mark, site name, URL, tagline. |
| `fonts/` | Atkinson Hyperlegible Bold and Regular, plus the OFL licence. Paths in the tokens file. |
| `mark-coo.svg` | The mark named by the tokens. |

## Use it

```js
import { loadBrand, renderCardPng } from './index.js';

const brand = loadBrand(new URL('./og-brand-tokens.json', import.meta.url));
const png = renderCardPng({ name, type, location }, brand);
```

`loadBrand` throws if either TTF is missing. The renderer loads those files itself and does not use a system font.

## Text

- The name column is 740 pixels wide.
- One line at 80px, otherwise two lines, otherwise smaller sizes down to 56px, otherwise an ellipsis.
- Type and location are one line, uppercased for the type, and ellipsized past 740 pixels.
- An empty type or location is omitted. No type pulls the name up. No location leaves the space above the tagline empty.
- A missing name falls back to `site_name`.

## Another site

1. Copy this folder.
2. Edit `og-brand-tokens.json`. Point `fonts.bold`, `fonts.regular`, and `mark.svg` at that site's files.
3. Install `opentype.js` and `@resvg/resvg-js` in the site that renders the cards.
4. Leave `engine.js` alone.
