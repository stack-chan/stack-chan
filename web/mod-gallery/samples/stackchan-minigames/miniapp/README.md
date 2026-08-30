# Mini-app example: Stack-chan Mini Games

This sample registers two games in the mini-app launcher from one archive:

- `Stack-chan JUMP`: tap to jump over incoming obstacles.
- `Stack-chan CATCH`: move across three lanes, collect regular items, and avoid bombs.

The existing [`mini_app_sample`](../mini_app_sample/) and [`stackchan_catch`](../stackchan_catch/) implementations remain the source of truth. `compose.mjs` combines them into one import-allowlist-compatible `miniapp.ts`. See each source sample's README for gameplay and rendering details.

After changing either source, compose and build from `firmware/`:

```console
node mods/examples/stackchan_minigames/compose.mjs
npm exec biome format --write mods/examples/stackchan_minigames/miniapp.ts
npm run mod:build -- mods/examples/stackchan_minigames/manifest.json --mode=release
```

Each game stops its `Port` timer when undisplayed. Use the host-owned AppBar Back button to exit. The external mini-app API does not expose device-button capabilities, so both games use screen taps only.

## Sprite attribution

JUMP's `stack-chan.png` is based on [meganetaaan/mouse-follower](https://github.com/meganetaaan/mouse-follower/blob/3258fc6d0890019a3c94024e3a456175cd563a6a/packages/mouse-follower/assets/stack-chan.png) at commit `3258fc6d`. CATCH's player poses use the same image as their design reference. See [LICENSE.mouse-follower](./LICENSE.mouse-follower) for its terms.
