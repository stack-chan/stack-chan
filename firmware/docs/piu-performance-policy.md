# Piu UI Performance Policy

This note records the performance rules used by the current UI implementation under `host/modules/ui`.

## Sources

- Piu internals: `reference/moddable/modules/piu/All/piuContent.c`, `piuContainer.c`, `piuSkin.c`, `piuLabel.c`, `reference/moddable/modules/piu/MC/piuPort.c`, `piuView.c`, `piuRegion.c`, `piuDie.c`, `piuImageBuffer.c`
- Piu documentation: `reference/moddable/documentation/piu/piu.md`
- Examples: `reference/moddable/examples/piu/list/main.js`, `spiral/main.js`, `spinner/main.js`, `heartrate/main.js`

## Rules

- Do not change `x`, `y`, `width`, `height`, or `coordinates` on every frame.
- Use `Port` drawing for hot face parts and effects.
- Keep breathing and transient animation inside behavior state and draw paths.
- Reuse `Skin`, `Style`, `Texture`, and fixed state objects.
- Do not allocate new objects in `onTimeChanged`.
- Convert colors to strings only at Piu drawing or text-style boundaries.
- Prefer sprite sheets and `drawTexture` for blinking, mouth frames, and effects.
- Use `Die` or constrained regions when a face can move visually without moving layout coordinates.
- Update labels only when displayed text actually changes.

## Current Application

- `components/face/behaviors/face.ts` keeps face state in reusable `FaceState` views and moves breath with `moveBy`.
- `components/face/parts/eye.ts` caches Piu skins and draws through `Port`.
- `components/face/parts/mouth.ts` and dog accent parts store numeric color state and draw through `Port.fillColor`.
- `components/effects/emoticon.ts` uses one texture atlas and numeric state, converting color only for `drawTexture`.
- `components/bubble/*` cache text styles and skins by palette.
- `views/main/face-view.ts` uses a `Die` region around the active face.

## Verification

The structural tests enforce the most important parts of this policy.

- `FaceBehavior applies breathing without reassigning coordinates on every tick`
- `UI animation hot paths do not allocate Piu skins/styles or update text each tick`
- `UI palette state stays numeric and converts colors at Piu render boundaries`
- `periodic motion hot paths reuse fixed state and callbacks`

Run:

```sh
npm run test:unit
npm run test:moddable
```
