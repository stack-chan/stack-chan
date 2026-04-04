# FaceContext as Views (Design)

## Goals
- Define FaceContext as a Moddable View (cdv) for fast, allocation-minimal read/write.
- Replace emotion strings with a numeric enum.
- Replace theme color strings with an RGB struct (r, g, b).
- Keep renderer behavior the same from the caller perspective.

## Non-goals
- Implementation changes (this document is design only).
- Feature changes beyond data representation and access speed.

## Current State (summary)
- Piu renderers use `FaceContext` with emotion as string and theme colors as `#RRGGBB` strings.
- Non-Piu renderer-base uses `FaceContext` with theme colors as `[r, g, b]` arrays.
- FaceContext is a plain JS object; updates allocate and copy via JS field-by-field.

## Proposed Data Model
### Emotion enum
Use a numeric enum stored as `uint8` in the view:

```
NEUTRAL = 0
ANGRY   = 1
SAD     = 2
HAPPY   = 3
SLEEPY  = 4
DOUBTFUL= 5
COLD    = 6
HOT     = 7
```

Notes:
- Keep this mapping stable to avoid cross-module confusion.
- Expose both `Emotion` enum and a `toEmotionName()` helper for debugging/logging.

### Theme color struct
Replace string colors with a struct:

```
struct ColorRGB {
  uint8 r;
  uint8 g;
  uint8 b;
  uint8 _pad; // alignment for 32-bit access
}
```

### FaceContext view layout
Use a view definition that matches a C struct for zero-copy access from JS and C.

```
struct MouthContext {
  float open;  // 0.0 - 1.0
}

struct EyeContext {
  float open;  // 0.0 - 1.0
  float gazeX; // -1.0 - 1.0
  float gazeY; // -1.0 - 1.0
}

struct ThemeContext {
  ColorRGB primary;
  ColorRGB secondary;
}

struct FaceContext {
  MouthContext mouth;
  EyeContext eyes_left;
  EyeContext eyes_right;
  float breath;      // 0.0 - 1.0
  uint8 emotion;     // Emotion enum
  uint8 _pad[3];     // alignment
  ThemeContext theme;
}
```

Rationale:
- `float` keeps current numeric semantics without introducing fixed-point conversions.
- Padding keeps alignment predictable for MCU access and fast reads.

## View Definition and Build Integration
- Create a `face-context` view definition (JSON for the `cdv` transform).
- Add the view to the relevant `manifest.json` with `"transform": "cdv"` and `"json": true` (as in `reference/moddable/examples/js/views`).
- The build will generate:
  - a JS module exposing the View class (e.g., `FaceContextView`)
  - a C header for the struct layout

Proposed file:
- `stackchan/renderers-piu/face-context-view.json` (or a shared location used by both renderers)

## JS/TS API Shape
### New API surface
- `createFaceContextView(): FaceContextView`
- `copyFaceContextView(src: FaceContextView, dst: FaceContextView): void`
- `toPiuColorNumber(color: ColorRGB): number`  // returns 0xRRGGBB
- `toColorString(color: ColorRGB): string`     // optional helper for logging/debug

### Example usage
```
const face = createFaceContextView()
face.eyes_left.open = 0.8
face.emotion = Emotion.HAPPY

const hex = toPiuColorNumber(face.theme.primary) // 0xRRGGBB
shape.skin = new Skin({ fill: hex })
```

## Integration Points
### Piu renderer
- Replace string comparisons with numeric enum comparisons.
- Replace `theme.primary`/`theme.secondary` string usage with `ColorRGB`.
- Convert `ColorRGB` to Piu color number when creating/updating `Skin`.
- Keep cached `lastPrimary/lastSecondary` as numbers to avoid repeated `Skin` creation.

### renderer-base (Poco)
- Replace array color usage with `ColorRGB`.
- Update `poco.makeColor(color.r, color.g, color.b)`.
- Update theme comparisons (either per-channel compare or a packed 0xRRGGBB helper).

### Robot and external APIs
- Update `setColor()` to write RGB components directly.
- If external APIs still accept color strings, add a conversion layer at the boundary.
- Add a small helper to parse `#RRGGBB` into `ColorRGB` when needed.

## Performance Considerations
- View-backed FaceContext avoids object allocations and reduces JS-to-C copying.
- Copy should use the view buffer (or native memcpy) rather than field-by-field JS assignments.
- Avoid converting colors to strings in hot paths; prefer numeric 0xRRGGBB for Piu `Skin`.

## Compatibility / Migration Plan
1. Add view definition and generated module.
2. Introduce new `FaceContextView` type and helper functions.
3. Update Piu renderer to consume view fields and numeric enum.
4. Update renderer-base to consume `ColorRGB`.
5. Update public APIs (Robot, modifiers, tests) to use the new types.
6. Remove old string-based theme helpers after all call sites migrate.

## Open Questions
- Finalize the shared location for the view definition to avoid duplication.
- Confirm Moddable `cdv` support for `float` types in view definitions.
- Decide whether to expose both view-backed and plain-object contexts for compatibility.
