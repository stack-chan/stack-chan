# Moddable v10 settings button corners

Release impact: patch.

Settings action buttons use the SDK RoundRect background with the existing UI.radius (6), while retaining the 44px active area, existing skins, labels, icons and touch behavior. Pressed, disabled and selected states update the background child. All 17 Port icons remain unchanged. No SVGImage resource, cache or WASM stack increase is introduced. Include the RoundRect manifest after existing Piu dependencies so its preload can access Content.

The four-way SDK10 comparison selected RoundRect only: first instrumented heap used increased by 280 bytes in the shared fixture, compared with 1,784 bytes for one palette SVG and 55,248 bytes for all SVG icons. The control source adds 13 lines / 407 bytes to implement the rounded background. SVG conversion is deferred because the full conversion needs WASM stack 1024, and clipping of a 24px check icon differs from the old Port. Native simulator heap and ELF sizes are not device RAM or flash measurements.

`npm run test:ui-controls` compares all enabled and disabled icon pixels against the original framebuffer, verifies normal/disabled/selected button frames, and exercises tap, drag, cancel, label updates and re-enabling through the Piu behavior. `npm run test:ui-controls:build` produces the XS module with the same preloaded ui-controls path as the host.

The default 0-degree simulator path is validated. Rotation, circular displays and hardware touch/RAM remain unverified; no device is flashed.
