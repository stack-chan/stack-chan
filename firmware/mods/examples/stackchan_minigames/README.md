# Mini-app example: Stack-chan Mini Games

This sample registers two games in the mini-app launcher from one archive:

- `Stack-chan JUMP`: tap to jump over incoming obstacles.
- `Stack-chan CATCH`: move across three lanes, collect regular items, and avoid bombs.

The maintained game implementations are `jump.ts` and `catch.ts`; `mod.ts` imports both with the SDK Piu extension. No source concatenation is required. This package replaces the former standalone `mini_app_sample` and `stackchan_catch` archives. See their README files for detailed rules.

Build from `firmware/` using Moddable 9.5.0:

```console
npm run mod:build -- mods/examples/stackchan_minigames/manifest.json --mode=release
```

Use a host supporting API 3. The archive uses app API 2 and a normal `mod` entrypoint. The app owns screen registration; the host owns the viewport and AppBar Back button. Both games use screen taps and stop their `Port` timer when undisplayed. See [the SDK contract](../../../sdk/README_ja.md#piu-の画面拡張) for screen lifetime and cleanup.

## Sprite attribution

JUMP's `stack-chan.png` is based on [meganetaaan/mouse-follower](https://github.com/meganetaaan/mouse-follower/blob/3258fc6d0890019a3c94024e3a456175cd563a6a/packages/mouse-follower/assets/stack-chan.png) at commit `3258fc6d`. CATCH's player poses use the same image as their design reference. See [LICENSE.mouse-follower](./LICENSE.mouse-follower) for its terms.
