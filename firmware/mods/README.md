# MODs and examples

[日本語](./README_ja.md)

A **MOD** is a user application that runs on the Stack-chan host firmware.
Published MODs and source examples have different entry points.

## Try a MOD

The [MOD Gallery](https://stack-chan.github.io/stack-chan/web/mod-gallery/) is the catalog of published MODs.
It lets you search by name or capability, change block-based projects in the editor, and run a MOD in the simulator or on a device.

Before writing to a device, the Gallery checks the MOD's target, XS version, and firmware compatibility.
Some MODs use external services or network access, so review the capabilities and target shown on the card, then inspect the linked source code before installing one.

The [`examples`](./examples/) directory contains source code for learning APIs, testing, and local development.
The distribution-oriented Gallery and development-oriented `examples` directory serve different purposes and do not have a one-to-one catalog.

## Create a MOD

### Create one in a browser

The [block editor](https://stack-chan.github.io/stack-chan/web/editor/) lets you assemble behavior with Blockly and build a MOD in the browser.
You can test the result in the [simulator](https://stack-chan.github.io/stack-chan/web/simulator/) and install it on a compatible device.
Follow the [block editor tutorial](https://stack-chan.github.io/stack-chan/web/editor/tutorial.html) to create a first project.

### Create one from source

A MOD can be implemented as a JavaScript or TypeScript module.
TypeScript MODs use the public Stack-chan capability types and Moddable module specifiers.

To install a MOD from a local environment, specify its manifest from the `firmware` directory:

```console
npm run mod -- mods/examples/look_around/manifest.json
```

See [Build and flash programs](../docs/flashing-firmware.md) for setup, target-specific commands, and installation details.

## MOD runtime model

Installing a MOD runs it in place of the product default behavior supplied by the host.
Button and screen behavior therefore depends on the installed MOD.

A MOD must be built for the target device and the XS version used by its host.
For the WASM host, load an `.xsb` or archive built with a TypeScript-capable target such as `lin`.

Add localized UI text as described in [Firmware localization](../docs/localization.md) through `context.i18n`.
To add a Piu UI while retaining the face screen and host AppBar, use the experimental [mini-app framework (Japanese)](../docs/mini-apps_ja.md).

## Representative source examples

| Example | What it demonstrates |
| --- | --- |
| [`look_around`](./examples/look_around/) | Minimal head movement through the motion API |
| [`localized_drawer`](./examples/localized_drawer/) | Localized UI through `context.i18n` |
| [`mini_app_sample`](./examples/mini_app_sample/) | A mini app that retains the face screen and AppBar |
| [`local_peer_hello`](./examples/local_peer_hello/) | Typed device-to-device messages without the internet |
| [`web_radio`](./examples/web_radio/) | Network audio playback on M5StackChan CoreS3 |
| [`m5stackchan_smoke`](./examples/m5stackchan_smoke/) | [M5StackChan CoreS3 servo-power and head LED checks](../docs/m5stackchan-cores3-smoke.md) |

## References

- [Build and flash programs](../docs/flashing-firmware.md)
- [Firmware API](../docs/api.md)
- [MOD package specification](../../docs/specs/stackchan-mod.md)
- [Localization](../docs/localization.md)
- [Mini apps (experimental, Japanese)](../docs/mini-apps_ja.md)
