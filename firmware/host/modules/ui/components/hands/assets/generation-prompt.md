# Image generation prompt

The source sheet was generated with the built-in image generation tool using
this prompt:

```text
Use case: stylized-concept
Asset type: a production-oriented 2D UI hand sprite-sheet concept for a tiny embedded robot face display

Primary request: Create EXACTLY 32 separate floating cartoon RIGHT-HAND sprites arranged in a precise 4-row by 8-column grid. Each sprite is a naturally redrawn directional pose, not merely the identical shape mechanically rotated.

Grid semantics:
- Columns, from left to right: gesture upward, upper-right, right, lower-right, downward, lower-left, left, upper-left.
- The hand must naturally point, lean, spread, and pose toward each requested direction. Subtle changes of silhouette and posture between directions are desirable.
- Row 1: FIST. A cute closed fist shaped like an asymmetric rounded bean or soft squircle, with a subtly flatter knuckle side and a thumb-side bulge. Definitely not a perfect circle.
- Row 2: POINT. Only the thumb and index finger are visibly extended. The index finger clearly indicates the column direction. Make it unmistakably an index-pointing gesture, never resembling a raised middle finger. The thumb is thick, begins near the wrist side, and balances the silhouette. Other fingers are merged into the rounded palm.
- Row 3: PEACE SIGN. Two short, thick, blunt, rounded fingers make a clear V sign toward the column direction. The remaining fingers and tucked thumb merge simply into the palm.
- Row 4: OPEN HAND. One thick thumb plus exactly three short, thick, rounded long fingers. Cute four-digit cartoon hand, not anatomically five-fingered.

Style/medium: extremely simple flat two-color vector-like UI sprite art; playful and chubby; smooth confident silhouette; suitable for reduction to a small bitmap.
Color palette: outer silhouette and thick outline in solid deep navy #111827; inner region in solid white #FFFFFF.
Shape rules:
- Every hand must read as one connected outline shape.
- No internal separator lines between fingers and palm.
- Fingers are short, thick, nearly constant-width, with rounded tips and no narrow pinched roots.
- Thumb is especially thick and its root sits toward the wrist side.
- No arm, no forearm line, no cuff, no wrist stem. Each hand floats by itself.
- Closed clean bottom edge on the palm.
- Keep outline thickness visually consistent across all 32 sprites.
- Use the same design language, approximate scale, and palm-center anchor across every cell.

Composition/framing: exact 4 by 8 array; equal square cells; every hand centered in its cell with generous clear gutters; no sprite overlaps another; no cropping; no labels; no captions; no arrows; no row or column headers; no borders and no visible grid lines.

Scene/backdrop: perfectly flat solid #00FF00 chroma-key background for later background removal. The background must be one uniform exact color with no shadows, gradients, texture, reflections, floor plane, or lighting variation. Do not use #00FF00 anywhere in the sprites.

Constraints: exactly 32 hands, exactly four rows and eight columns; right-hand design consistently; purely flat colors; crisp edges; no lighting; no shading; no highlights; no 3D rendering; no texture; no facial features; no objects; no text; no watermark.
Avoid: realistic anatomy, skinny fingers, long fingers, fingernails, finger joints, internal palm lines, extra fingers, missing required fingers, disconnected parts, gloves with cuffs, arms, mechanical rotation-copy appearance.
```

## Side-open source

The side-open source was generated in built-in tool mode with
`hands-source-right.png` as a style reference. The selected source was then
edited once to make the eight screen-plane directions explicit.

Initial generation prompt:

```text
Use case: stylized-concept
Asset type: 2D UI sprite sheet for a tiny robot display
Input image role: Image 1 is a style reference only. Match its simple navy outline, white interior, cute proportions, and flat vector-like finish. Create a new image containing only the new pose.

Create EXACTLY 8 separate floating cartoon glove icons in a single horizontal row of 8 equal cells. Every icon is the same RIGHT glove in a narrow side-facing clapping pose, like a soft rounded mitten viewed edge-on. It must not show the broad front face of an open glove.

Column directions, left to right: up, upper-right, right, lower-right, down, lower-left, left, upper-left. The direction describes where the rounded top of the glove points. Redraw each direction naturally while keeping one consistent design and scale.

Silhouette: narrow, compact, soft, and cute. The upper portion is one unified rounded lobe with only subtle shallow bumps along its outside edge. Add one modest rounded side bulge near the lower end to suggest the folded thumb. One connected outer silhouette per icon, with no interior detail lines.
Colors: solid deep navy #111827 outer silhouette and thick outline; solid white #FFFFFF inner region.
Background: perfectly uniform flat #00FF00 chroma-key green, with no shadow, gradient, texture, reflection, floor, or lighting variation. Never use green in an icon.
Layout: exactly one row and eight columns; consistent centers and size; generous gaps; no overlap, cropping, grid lines, labels, arrows, text, or watermark.
Do not include arms, cuffs, wrist stems, separated digits, spread-open poses, front-facing palms, fists, pointing signs, peace signs, realistic anatomy, fingernails, joints, objects, 3D rendering, shading, highlights, or extra marks.
```

Direction edit prompt:

```text
Use case: precise-object-edit
Asset type: 2D UI sprite sheet for a tiny robot display
Input image role: Image 1 is the EDIT TARGET.

Primary request: Keep the exact same eight side-facing cartoon glove designs, colors, outline style, single-row layout, scale, green background, and spacing. Change ONLY the orientation of each complete glove icon so the row becomes an eight-direction sprite set.

Required orientation by column, left to right:
1. point the glove's long rounded top straight UP (0 degrees)
2. point it UPPER-RIGHT (45 degrees clockwise)
3. point it RIGHT (90 degrees clockwise)
4. point it LOWER-RIGHT (135 degrees clockwise)
5. point it DOWN (180 degrees)
6. point it LOWER-LEFT (225 degrees clockwise)
7. point it LEFT (270 degrees clockwise)
8. point it UPPER-LEFT (315 degrees clockwise)

Rotate/repose the WHOLE glove silhouette in each cell, including the lower side bulge. The changing directions must be unmistakable. Preserve exactly 8 separate icons in one row, all fully visible and centered in equal conceptual cells with generous gaps.
Constraints: change only orientation; preserve the narrow edge-on clapping pose; perfectly flat uniform #00FF00 background; deep navy #111827 outline/outer silhouette and white fill; no grid, labels, arrows, text, shadows, shading, arms, cuffs, extra icons, or watermark.
```
