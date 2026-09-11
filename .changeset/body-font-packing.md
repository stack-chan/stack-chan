---
"stack-chan": patch
---

Pack the complete body font into a smaller monochrome atlas, saving 32 KiB of firmware flash while preserving every glyph and its metrics. Require one texture page so future repertoire growth fails visibly if it no longer fits.
