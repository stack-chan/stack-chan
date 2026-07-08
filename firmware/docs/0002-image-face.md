# Image Face And Image Avatar UI

## Summary

The image-based face UI now lives under `host/modules/ui/components/face/parts/image`.
It is selected through `config.ui.type = "image"` and receives the shared `FaceState` view used by the app runtime.

The current implementation has two image paths.

- `ImageFace` uses the bundled Moddable-avatar eye, eyelid, and mouth assets.
- `ImageAvatarFace` uses an `ImageAvatarPack` and the bundled `stackchan-demo` pack by default.

## Current Structure

```text
host/
  modules/
    ui/
      assets/images/faces/
        image-face/moddable-avatar/
        image-avatar/stackchan-demo/
      components/face/parts/image/
        atlas.ts
        eye-sprite.ts
        eyelid-sprite.ts
        image-avatar-face.ts
        image-avatar-pack.ts
        image-avatar-state.ts
        iris-sprite.ts
        mouth-sprite.ts
```

The UI manifest owns the bundled image assets.
Sample-only avatar packs stay under `mods/examples` and are not bundled into the host registry.

## State Mapping

All image parts consume `FaceState`.

- `face.emotion` selects an expression through `ImageAvatarPack.emotionMap`.
- `face.eyes.left.open` and `face.eyes.right.open` select eyelid frames.
- `face.mouth.open` selects mouth frames.
- `face.theme.primary` and `face.theme.secondary` are converted at the Piu boundary only when a Piu resource requires a color string.

The image face path does not expose a separate face-state contract.
New variants should extend `FaceState` or `ImageAvatarPack` data, not add another UI-specific state shape.

## Configuration

```json
{
  "config": {
    "ui": {
      "type": "image",
      "avatar": "stackchan-demo"
    }
  }
}
```

`avatar` is optional.
Missing or unknown pack IDs fall back to `stackchan-demo`.

## Testing

Image face changes should keep these checks green.

- `npm run test:unit`
- `npm run test:moddable`
- `host/modules/ui/components/face/parts/image/__tests__/image-avatar-pack.test.ts`
- `host/modules/ui/application/__tests__/piu-simple/manifest.test.json`

Manual checks should verify eyelid frame changes, mouth frame changes, emotion expression changes, and fallback behavior for unknown avatar pack IDs.
