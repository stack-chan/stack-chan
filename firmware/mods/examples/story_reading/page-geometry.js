// Build-time leaf silhouettes, in 232 x 88 sheet coordinates (cover origin y=24).
// The atlas crops them at the upper hinge, retaining only the upper 41 pixels.
// We face the reader, so a forward turn travels screen-left to screen-right.
// Both hinge endpoints stay fixed at the spine. The whole lower leaf is hidden
// by the opaque cover drawn afterwards; only its curled upper edge is visible.
// Frame zero is transparent, preserving the approved resting book exactly.
export const PAGE_PATHS = [
  [],
  [
    ['moveTo', 116, 41],
    ['bezierCurveTo', 94, 30, 65, 22, 42, 28],
    ['lineTo', 44, 78],
    ['bezierCurveTo', 70, 78, 96, 82, 116, 86],
    ['closePath'],
  ],
  [
    ['moveTo', 116, 41],
    ['bezierCurveTo', 105, 28, 87, 10, 74, 12],
    ['bezierCurveTo', 70, 26, 72, 53, 76, 66],
    ['bezierCurveTo', 90, 72, 105, 81, 116, 86],
    ['closePath'],
  ],
  [
    ['moveTo', 116, 41],
    ['bezierCurveTo', 112, 29, 113, 13, 119, 7],
    ['bezierCurveTo', 124, 28, 121, 52, 117, 67],
    ['bezierCurveTo', 116, 74, 116, 80, 116, 86],
    ['closePath'],
  ],
  [
    ['moveTo', 116, 41],
    ['bezierCurveTo', 127, 28, 145, 10, 158, 12],
    ['bezierCurveTo', 162, 26, 160, 53, 156, 66],
    ['bezierCurveTo', 142, 72, 127, 81, 116, 86],
    ['closePath'],
  ],
  [
    ['moveTo', 116, 41],
    ['bezierCurveTo', 138, 30, 167, 22, 190, 28],
    ['lineTo', 188, 78],
    ['bezierCurveTo', 162, 78, 136, 82, 116, 86],
    ['closePath'],
  ],
]
