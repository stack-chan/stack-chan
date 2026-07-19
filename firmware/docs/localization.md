# Firmware localization

[日本語](./localization_ja.md)

The firmware supports Japanese (`ja`), English (`en`), and Simplified Chinese (`zh-CN`).
The host and installed MOD use the same `context.i18n` API while keeping their catalog resources separate.

## Public API

A MOD reads the current locale and localized strings from the `StackchanContext` passed to `onContextCreated`.

```ts
context.i18n.locale
context.i18n.localize(key, values?)
```

`localize` does not depend on `this`, so it is safe to destructure.

```js
export function onContextCreated(context) {
  const { localize } = context.i18n
  context.ui.drawer.addDrawerButton({
    key: 'weather:forecast',
    label: localize('weather.drawer.forecast'),
    callback(nextContext) {
      nextContext.ui.closeDrawer()
    },
  })
}
```

Messages resolve in this order:

1. The installed MOD's `modLocals` catalog
2. The host `locals` catalog
3. The untranslated key itself

Prefix MOD-owned keys, for example with `weather.*`, to avoid collisions with host and other MOD keys.
A MOD does not need to duplicate a host message when it only uses a shared host key.

## Add catalogs to a MOD

Add all three JSON catalogs to the MOD directory.

```text
my_mod/
├── manifest.json
├── mod.js
└── strings/
    ├── en.json
    ├── ja.json
    └── zh-CN.json
```

Every catalog must define the same keys and placeholder names.
`en.json` is also required to initialize `Locals`.

`en.json`

```json
{
  "weather.drawer.forecast": "Weather",
  "weather.temperature": "Temperature: {value}°C"
}
```

Add the catalogs to the manifest resources.

```json
{
  "include": ["$(MODDABLE)/examples/manifest_mod.json"],
  "modules": {
    "*": ["./mod"]
  },
  "resources": {
    "*": ["./strings/*"]
  }
}
```

`mcrun` compiles them into the MOD-owned `modLocals.mhi` and `modLocals.<locale>.mhr` resources.
Do not import `Locals` or the host-internal `localization` module from a MOD; call `context.i18n.localize()` instead.
See [`mods/examples/localized_drawer`](../mods/examples/localized_drawer/) for the minimal working example.

## Use an arbitrary Piu Label

The result of `localize()` is an ordinary `string`, so it can be passed to any `Label`, not only a Drawer Button.

```js
import { Label, Style } from 'piu/MC'

export function onContextCreated(context) {
  const status = new Label(null, {
    left: 8,
    right: 8,
    top: 40,
    height: 24,
    string: context.i18n.localize('weather.status.ready'),
    style: new Style({ font: 'OpenSans-Regular-16', color: 'black' }),
  })
  context.ui.addEffect(status, 'weather:status')
}
```

Piu's `Label.string` is a concrete string and does not subscribe to locale changes.
If runtime locale switching is added, assign a newly localized value to `Label.string` or rebuild the view.

## Fonts

Translation lookup and glyph coverage are separate concerns.
`context.i18n.localize()` returns Unicode text, but the selected font must contain every rendered glyph.

Host screens and Drawer Buttons use a UI font subset covering the host catalogs.
For MOD-specific CJK text in an arbitrary `Label`, bundle an appropriately licensed font with the MOD and set `"localization": true` on its font resource.
Drawer Buttons currently use the host style, so arbitrary MOD-specific CJK glyphs are not guaranteed there.
The minimal sample intentionally uses characters already present in the host font.

## Add a host screen

For host UI, add the same key to all three files under `host/app/strings/{ja,en,zh-CN}.json` and call `localize()` from the `localization` module.
Use `{name}` placeholders and keep placeholder names identical in every locale.
Architecture tests verify catalog keys, placeholders, and Simplified Chinese font glyphs.

## Official Moddable references

- [Piu Localization](https://github.com/Moddable-OpenSource/moddable/blob/public/documentation/piu/localization.md): `mclocal`, `Locals`, and catalog resources
- [Mods - User Installed Extensions](https://www.moddable.com/documentation/xs/mods): MOD manifests, resources, and builds
- [mcrun](https://www.moddable.com/documentation/tools/tools#mcrun): the MOD build tool
- [Piu Label Object](https://www.moddable.com/documentation/piu/piu#label-object): the `Label` and `string` APIs
- [Creating fonts for Moddable applications](https://www.moddable.com/documentation/commodetto/Creating%20fonts%20for%20Moddable%20applications): font resources including `localization: true`
- [mcrun source](https://github.com/Moddable-OpenSource/moddable/blob/public/tools/mcrun.js#L485): the `modLocals` resource name used for MOD catalogs
