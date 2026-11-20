# Moddable v10 settings button corners

Release impact: patch.

Confirmation and other action buttons use the SDK RoundRect background with the existing UI.radius (6), while retaining the 44px active area, existing skins, labels, icons and touch behavior. Pressed, disabled and selected states update the background child. Settings menus, language and time zone choices, mini-app entries and drawer rows use square backgrounds matching the gray AppBar surface with slightly brighter gray bottom boundaries. Pressed and selected rows use a dark highlight; disabled rows mute their icon. Wi-Fi SSID rows use the same gray surface and boundary colors. Back controls display only the original icon. Settings header controls fit the 40px header and vertically center the icon; the mini-app AppBar remains 44px. All 17 Port icons remain unchanged. No SVGImage resource, cache or WASM stack increase is introduced. Include the RoundRect manifest after existing Piu dependencies so its preload can access Content.

The initial four-way SDK10 comparison selected RoundRect only: first instrumented heap used increased by 280 bytes in the shared fixture, compared with 1,784 bytes for one palette SVG and 55,248 bytes for all SVG icons. That initial rounded-background change added 13 lines / 407 bytes. SVG conversion is deferred because the full conversion needs WASM stack 1024, and clipping of a 24px check icon differs from the old Port. Native simulator heap and ELF sizes are not device RAM or flash measurements.

`npm run test:ui-controls` compares all enabled and disabled icon pixels against the original framebuffer, verifies normal/pressed/disabled/selected button and row frames, subtle gray boundaries and header Back alignment, and exercises tap, drag, cancel, label updates and re-enabling through the Piu behavior. `npm run test:ui-controls:build` produces the XS module with the same preloaded ui-controls path as the host.

The default 0-degree simulator path is validated. Rotation, circular displays and hardware touch/RAM remain unverified; no device is flashed.
