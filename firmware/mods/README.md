# MODs and examples

[日本語](./README_ja.md)

A **MOD** is a user application that runs on the Stack-chan host firmware.


For a first program on this branch, start with the [SDK lessons](../lessons/README_ja.md). `look_around` and `monologue` now use the same SDK. The other examples still use legacy API 1; their dependencies and open issues are recorded in the [migration ledger](../../docs/architecture/legacy-mod-migration.md).

Every MOD must embed `stackchan-mod.json`. Copy the lesson’s `mod.js`, `manifest.json`, and declaration together, and start by editing only `mod.js`. Rebuild older archives that lack metadata; see [compatibility and recovery](../../docs/architecture/mod-package-compatibility.md).

## Try a MOD

Find published MODs in the [MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/).
Search by name or capability, then run a MOD in the simulator or on a device.
You can change block-based MODs in the block editor.

When choosing a MOD, review the capabilities and supported targets shown on its card.
If the MOD uses an external service or network access, inspect the linked source code before installing it.
At installation time, the Gallery automatically checks the target chip, XS version, and firmware compatibility.

[![MOD Gallery](../../docs/images/web-tools/mod-gallery-en.png)](https://stack-chan.github.io/stack-chan/web/mod-gallery/)

The [`examples`](./examples/) directory contains source code for learning APIs, testing, and local development.
Some examples are also published in the Gallery.
The Gallery and `examples` do not yet contain the same set of MODs, but they will be aligned over time.

## Create a MOD

### Create one in a browser

The [block editor](https://stack-chan.github.io/stack-chan/web/editor/) lets you assemble behavior with Blockly and build a MOD in the browser.
You can test the result in the [simulator](https://stack-chan.github.io/stack-chan/web/simulator/) and install it on a compatible device.
Follow the [block editor tutorial](https://stack-chan.github.io/stack-chan/web/editor/tutorial.html) to create a first project.

[![Block editor](../../docs/images/web-tools/block-editor-en.png)](https://stack-chan.github.io/stack-chan/web/editor/)

### Create one from source

A MOD can be implemented as a JavaScript or TypeScript module.
TypeScript MODs use the public Stack-chan capability types and Moddable module specifiers.

To install a MOD from a local environment, specify its manifest from the `firmware` directory:

```console
npm run mod -- mods/examples/look_around/manifest.json
```

See [Build and flash programs](../docs/flashing-firmware.md) for setup, target-specific commands, and installation details.

## MOD runtime model

Installing a MOD makes the host run that MOD instead of its default behavior.
Button and screen behavior therefore depends on the installed MOD.

A MOD must be built for the target device and the XS version used by its host.
For the WASM host, use the `.xsa` archive produced by the standard `npm run mod:build` command, including its MOD metadata.

Add localized UI text as described in [Firmware localization](../docs/localization.md) through `context.i18n`.
To add a Piu UI while retaining the face screen and host AppBar, use the [SDK Piu extension (Japanese)](../docs/mini-apps_ja.md).

## Representative source examples

| Example | What it demonstrates |
| --- | --- |
| [`look_around`](./examples/look_around/) | Minimal head movement through the motion API |
| [`localized_drawer`](./examples/localized_drawer/) | Localized UI through `context.i18n` |
| [`stackchan_minigames`](./examples/stackchan_minigames/) | One SDK app containing Stack-chan JUMP and CATCH |
| [`local_peer_hello`](./examples/local_peer_hello/) | Typed device-to-device messages without the internet |
| [`web_radio`](./examples/web_radio/) | Network audio playback on M5StackChan CoreS3 |
| [`m5stackchan_smoke`](./examples/m5stackchan_smoke/) | [M5StackChan CoreS3 servo-power and head LED checks](../docs/m5stackchan-cores3-smoke.md) |

## References

- [Build and flash programs](../docs/flashing-firmware.md)
- [Firmware API](../docs/api.md)
- [MOD package specification](../../docs/specs/stackchan-mod.md)
- [Localization](../docs/localization.md)
- [Mini apps (experimental, Japanese)](../docs/mini-apps_ja.md)
