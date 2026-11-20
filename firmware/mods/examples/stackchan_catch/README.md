# Mini-app example: Stack-chan CATCH

Stack-chan CATCH is a discrete-state catching game drawn by a single Piu `Port` in the mini-app viewport.
Install the archive, open the mini-app launcher, and choose `Stack-chan CATCH`.

- Tap the center third to start or retry.
- While playing, tap the left or right third to move Stack-chan one lane.
- The bottom `LEFT` / `START` / `RIGHT` guide renders the currently available touch zones in dark ink.
- Catch a screw, M5Stack, or speech bubble for one point. Missing one or catching a bomb adds a miss.
- Move to another lane to avoid bombs. Avoiding one does not add score.
- An independent continuous stream refills each free slot instead of waiting for a wave to end, keeping one or two objects on screen.
- Objects use slow, steady, and fast step timing. A later fast object can land before an earlier slow one, with at least three ticks between landings.
- Every five points shortens the 600 ms tick by 50 ms, down to 250 ms.

The game deliberately switches between fixed poses instead of moving sprites continuously. The LCD background, faint inactive poses, and dark active poses reproduce a Game & Watch-like afterimage.

External mini-apps currently receive touch events but no host device-button capability, so this sample does not bind the Core2/CoreS3 physical buttons. Always use the host-owned Back button to exit; the game timer also stops when its `Port` is undisplayed.

Build the archive from `firmware/`:

```console
npm run mod:build -- mods/examples/stackchan_catch/manifest.json --mode=release
```

## Sprite attribution

The player poses were generated with the built-in OpenAI image generator using the Stack-chan sprite from [meganetaaan/mouse-follower](https://github.com/meganetaaan/mouse-follower/blob/3258fc6d0890019a3c94024e3a456175cd563a6a/packages/mouse-follower/assets/stack-chan.png) (commit `3258fc6d`) as a design reference, then reduced to monochrome alpha masks for this game. The bomb was generated the same way with the existing item sprite sheet as its style reference. See [LICENSE.mouse-follower](./LICENSE.mouse-follower) for the source sprite's terms.
