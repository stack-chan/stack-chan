# Body font packing — 2026-09-08

The same 7,170 glyphs now fit in a single 1024×768 atlas instead of 1024×1024. The bitmap occupies one bit per pixel in firmware, so this removes 32,768 bytes without removing characters, changing type size, or changing the font source. The BMFont table remains 143,472 bytes.

A glyph-by-glyph comparison against commit `00c280a` checked codepoint membership, bitmap width/height, offsets, advance width, page/channel, and each cropped RGBA raster. All match; only placement in the atlas and the atlas dimensions change. The input TTF, character list, locales, and monochrome rasterization stay the same. The generator now limits output to one page so repertoire growth cannot produce an unregistered additional texture.

`node scripts/update-body-font.mjs --check` reproduces the checked-in outputs. The generated font table SHA-256 is `40e5bc6127726c1c1505ee1931c27ece37b2e2c5d4545882353519d42bd824d1`; the PNG SHA-256 is `ef3c44c37f9fd21e1ed53509d401b077431a771e9d01cc5bda21f287f7042c52`.

All six release builds and `bundle:package` passed:

| Target | Image bytes | App partition bytes |
| --- | ---: | ---: |
| M5Stack | 3,766,864 | 3,801,088 |
| Core2 | 3,849,952 | 16,384,000 |
| CoreS3 | 3,974,704 | 16,318,464 |
| M5StackChan CoreS3 | 6,551,504 | 16,318,464 |
| Stack-chan RT | 3,970,608 | 16,318,464 |
| Takao Core2 SG90 | 3,849,952 | 16,384,000 |

M5Stack factory margin increases from 1,456 to 34,224 bytes. The normal pre-deployment artifact size guard remains required.

WASM and Web were rebuilt. Chromium loaded/exercised `01-face` and `03-input`, and the MOD compatibility/recovery suite passed. The recovery-screen screenshot was inspected for body-font rendering. Physical display acceptance remains separate from these checks.

This is a binary resource-size improvement. It does not count as a reduction of product source lines and does not satisfy the remaining F11 source-reduction requirement.
