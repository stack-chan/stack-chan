# Static hand sprite atlas

The runtime hand colors are not baked into these images. Draw
`hands-outer-mask.png` with the face primary color, then draw
`hands-inner-mask.png` at the same position with the face secondary color.
The UI manifests use Moddable's supported `*-alpha-monochrome` resource target
so both masks stay compact four-bit alpha textures while retaining their PNG
resource names at the Piu API boundary.

Both atlases are 768 x 960 pixels and use 96 x 96 pixel cells.

Columns, from left to right:

1. up
2. up-right
3. right
4. down-right
5. down
6. down-left
7. left
8. up-left

Rows, from top to bottom:

1. right fist
2. right point
3. right peace
4. right open
5. right side-open
6. left fist
7. left point
8. left peace
9. left open
10. left side-open

`hands-source-right.png` is the built-in image generation result.
`hands-source-right-alpha.png` is the same source after chroma-key removal.
`hands-source-right-side-open.png` is the separately generated side-view row,
and `hands-source-right-side-open-alpha.png` is its chroma-keyed source.
The left-hand rows are generated from the right-hand rows. The direction is
remapped before mirroring so that, for example, both `right/up-right` and
`left/up-right` still gesture toward the upper right.

Regenerate the masks and preview with:

```sh
python "${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py" \
  --input host/modules/ui/components/hands/assets/hands-source-right.png \
  --out host/modules/ui/components/hands/assets/hands-source-right-alpha.png \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill \
  --force

python "${CODEX_HOME:-$HOME/.codex}/skills/.system/imagegen/scripts/remove_chroma_key.py" \
  --input host/modules/ui/components/hands/assets/hands-source-right-side-open.png \
  --out host/modules/ui/components/hands/assets/hands-source-right-side-open-alpha.png \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill \
  --force

python host/modules/ui/components/hands/tools/build-static-atlas.py \
  host/modules/ui/components/hands/assets/hands-source-right-alpha.png \
  host/modules/ui/components/hands/assets/hands-source-right-side-open-alpha.png \
  host/modules/ui/components/hands/assets
```

The source generation prompt is recorded in `generation-prompt.md`.
