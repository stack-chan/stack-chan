# Localized Drawer

This minimal MOD adds a Drawer Button localized for the current UI language using its own `strings/*.json` files and `context.i18n.localize()`.
The `./strings/*` entry in `manifest.json` is required to compile the `en`, `ja`, and `zh-CN` catalogs into the MOD-owned `modLocals` resources.
Keep keys and placeholder names aligned across catalogs, and retain `en.json` because `Locals` uses it during initialization.

See [Firmware localization](../../../docs/localization.md) for the API contract and an example using an arbitrary Piu `Label`.
