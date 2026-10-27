# Style guide

Colours, type, spacing and controls already in the site CSS. This file does not introduce a new look. The same tokens render at `/style/` (noindex, and not listed in the sitemap).

Source of the tokens: `site/src/layouts/Base.astro` (`:root` and the global rules), component CSS next to those patterns, and `scripts/make_tartan.py` for the Fraser of Lovat stripe.

## Palette

Set on `:root` in `Base.astro`.

| Token | Hex | Use |
|---|---|---|
| `--fg` | `#2a1d14` | Body text |
| `--muted` | `#6b5a4c` | Secondary text (`.muted`, 0.92rem) |
| `--bg` | `#fbf6ec` | Page background |
| `--card` | `#fffdf8` | Cards |
| `--line` | `#eadfcb` | Card and field borders |
| `--green` | `#1f4d3a` | Headings, header, footer, primary icon colour, `theme-color` |
| `--green2` | `#2f6b52` | Inline links, header menu border |
| `--ginger` | `#a54e1e` | Primary buttons, dates, card top stripe |
| `--ginger2` | `#e0843f` | Header nav underline, coo fringe in the mascot drawing |
| `--cream` | `#f4e6c8` | Pills, icon-button hover, mascot badge |
| `--navy` | `#1d3557` | Feature tags, focus ring |
| `--focus` | `#1d3557` | `:focus-visible` outline |
| `--focus-halo` | `#fff` | Ring outside the focus outline |

Header and footer sit on `--green` with white text (`#fff`). Footer body copy is `#e9f1ec`. Footer muted text is `#c7d8ce`.

Other colours used beside the tokens:

| Hex | Use |
|---|---|
| `#8a4118` | `.btn:hover` fill |
| `#dcebe2` | Green pill background |
| `#5a3a1e` | Default pill text |
| `#fde7d6` / `#8a3b0d` | "Date TBA" pill |
| `#1f7a3a` | Free-admission pill (white text) |
| `#e3ebf5` | Feature tag background, with `--navy` text |
| `#cdbda3` | Text field border |
| `#fff4e8` / `#f1cfae` | Warm callout cards (booking, St Andrew's note) |
| `#fff` | Field background, focus halo |

Accessibility overrides, applied only when that setting is on:

- More contrast: `--fg #000`, `--muted #1f1f1f`, `--bg #fff`, `--card #fff`, `--line #000`, `--green #0d2e22`, `--green2 #0b4a32`, `--ginger #7a3510`.
- Colour distinction: `--green2 #005a9c`, `--ginger #9a4a00`.

## Tartan accents

Fraser of Lovat, one repeat, from `scripts/make_tartan.py` (written to `site/public/tartan-fraser-of-lovat.svg`). The header stripe paints that file at 10px.

| Colour | Hex |
|---|---|
| Red | `#B82E26` |
| Green | `#1F4D3A` |
| White | `#FFFFFF` |
| Navy | `#20284E` |

The tartan green is the same green as `--green`. The tartan navy is not `--navy` (`#1d3557`). Keep both.

The mascot drawing (`site/public/coo.svg`) uses the same cream, ginger and green, with a `#3b2414` stroke, round joins, and a 3px stroke on its 120 viewBox. That stroke is for the illustration, not for interface icons.

## Type

- Body: `1.0625rem` / `1.55`, `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, colour `--fg`.
- Headings: `Georgia, "Iowan Old Style", "Palatino Linotype", serif`, colour `--green`, line-height `1.2`. `h1` is `2.1rem`. `h2` is `1.5rem`.
- Muted: `0.92rem`, `--muted`.
- The accessibility "readable font" setting loads Atkinson Hyperlegible from `site/public/fonts/atkinson.css` (self-hosted). It is not the default.

## Spacing and radii

There is no named spacing scale. Values that recur:

- Page column: `.wrap` max-width `1100px`, padding `0.8rem 1.1rem`. Main adds `1.4rem` top and `3rem` bottom.
- Cards: padding `1rem 1.1rem`. Grid gap `1rem`. Card grid minimum column `260px`.
- Icon button row gap: `0.5rem`. Stack gap above that row: `0.35rem`.

Radii:

| Radius | Use |
|---|---|
| `6px` | Skip link |
| `8px` | Text fields |
| `10px` | Buttons, menus, icon buttons |
| `14px` | Cards, accessibility dialog |
| `99px` | Pills and filter chips |
| `50%` | Mascot badge in the header |

## Buttons

- **Primary** (`.btn`): background `--ginger`, white text, no border, radius `10px`, padding `0.6rem 1rem`, weight `600`, the system sans. Hover fill `#8a4118`.
- **Ghost** (`.btn.ghost`): transparent, text `--green`, `2px` solid `--green`. It still uses `.btn`, so the shared hover rule paints the fill `#8a4118`.
- **Calendar icon button**: not a `.btn`. Same green outline and `10px` radius as the ghost button, transparent fill, cream hover (`--cream`). The control is `44px` by `44px` (the minimum tap size, including on a narrow screen). The icon inside is `32px`.

Focus, site-wide: `:focus-visible` is a `3px` solid `--focus` outline, `2px` offset, plus a `5px` `--focus-halo` shadow. Header and footer swap that outline to white with a black halo. Do not remove the outline on icon buttons.

Inline links use `--green2`. Header links are white, with a `--ginger2` underline on hover and on the current page.

## Icons

Generic and self-hosted. Draw them inline in the page. Do not load an icon font, a sprite, or a script from somewhere else.

- ViewBox `0 0 24 24`. One stroke of `1.75`, round caps and round joins, `fill: none` on the line work, colour `currentColor` so the icon follows the control (green on a light card, cream when the same drawing sits on `--green`).
- The three calendar icons share that frame. One has a small `.ics` label in the body font. One has a small `G`. One has a small envelope. Same stroke and same size.
- Drawn size inside a calendar button is `32px` (`--cal-glyph`).
- The calendar glyph (`--cal-glyph`) stays at 24px or larger, because the .ics, G and envelope marks blur below that.
- The svg is `aria-hidden`. The control has the accessible name and a `title` tooltip with the same words.
- Current names: "Download calendar file", "Add to Google Calendar", "Add to Outlook calendar".

## Voice and copy

The Coo sounds like a friendly neighbour at the beer tent: warm, plain, a wee bit cheeky. Never corporate, never pushy.

**Tone**
- Short sentences. Contractions are fine (you're, we'll, it's).
- Concrete over clever: say what, where and when first.
- Ceilidh can be playful in headlines and empty states. Keep forms, privacy and booking copy plain.
- Canadian spelling (colour, centre, honour).

**Punctuation**
- No em dashes. Use a comma, a colon or a new sentence.
- One exclamation mark per screen, at most.
- Gaelic words keep their accents: Slàinte, ceilidh (lower case in running text, Ceilidh when it's her name).

**Buttons and links**
- Start with a verb and say what happens: "Add to Google Calendar", "Download calendar file", "Book a performer", "Get event reminders".
- Icon-only buttons always carry an aria-label with the full wording, e.g. aria-label="Add to Outlook calendar".
- No "Click here" or "Submit".

**Forms and messages**
- Labels are nouns ("Your email"), help text is one line.
- Errors say what to fix: "Add an email so we can reply."
- Success says what's next: "Thanks! Check your email to confirm."

**Tartans**
- Describe each tartan by its story and who wears it. Ceilidh wears Fraser of Lovat as a nod to the band, and visitors can pick from 8 tartans.
- Keep tartan copy to the story, the clan or region, and who wears it.

**Words to avoid**
Seamless, elevate, unlock, curated, journey, world-class, game-changer.
