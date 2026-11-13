export const BOOK_WIDTH = 232
export const BOOK_HEIGHT = 64
// The turning leaf can rise above the cover, but never moves its outline or hands.
export const PAGE_RISE = 24
// Trim the fully occluded lower sheet at the top of the spine. This also keeps
// rear antialiasing from bleeding through the cover's bottom outline.
export const PAGE_HEIGHT = PAGE_RISE + 17

// These paths also drive the layout preview, so its book and hands match the MOD asset.
export const BOOK_PATHS = [
  {
    name: 'book',
    fill: true,
    commands: [
      ['moveTo', 36, 8],
      ['bezierCurveTo', 64, 6, 92, 8, 116, 17],
      ['bezierCurveTo', 140, 8, 168, 6, 196, 8],
      ['lineTo', 196, 59],
      ['bezierCurveTo', 165, 57, 139, 58, 116, 62],
      ['bezierCurveTo', 93, 58, 67, 57, 36, 59],
      ['lineTo', 36, 8],
      ['closePath'],
    ],
  },
  {
    name: 'spine',
    fill: false,
    commands: [
      ['moveTo', 116, 17],
      ['lineTo', 116, 62],
    ],
  },
  {
    name: 'left-hand',
    fill: true,
    commands: [
      ['moveTo', 36, 23],
      ['bezierCurveTo', 25, 24, 17, 35, 18, 47],
      ['bezierCurveTo', 18, 57, 24, 62, 33, 62],
      ['bezierCurveTo', 43, 62, 49, 54, 48, 44],
      ['bezierCurveTo', 48, 36, 42, 32, 34, 33],
      ['lineTo', 36, 23],
      ['closePath'],
    ],
  },
  {
    name: 'right-hand',
    fill: true,
    commands: [
      ['moveTo', 196, 23],
      ['bezierCurveTo', 207, 24, 215, 35, 214, 47],
      ['bezierCurveTo', 214, 57, 208, 62, 199, 62],
      ['bezierCurveTo', 189, 62, 183, 54, 184, 44],
      ['bezierCurveTo', 184, 36, 190, 32, 198, 33],
      ['lineTo', 196, 23],
      ['closePath'],
    ],
  },
]
