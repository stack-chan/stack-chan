# UI controls framebuffer regression

Run `npm run test:ui-controls` from firmware with the SDK, C compiler and glib-2.0 development package available. The build uses the repository output wrapper and never flashes a device.

The compressed golden is the 320×240 RGBA first frame of the original Port icons (17 names in both enabled states) before the RoundRect change. It was reproduced byte for byte on foundation c2791a2e40f40210bce0466ee03debcabb35949d with SDK10 5f215f776f93039755343dbe75a09aa2615045f4. Decompressed SHA256: 57f56385588c7e71a6e79076f076a0b331cd92e63b1d609f8b0963a74692c225.

Subsequent native frames exercise normal, disabled and re-enabled/selected states. The Piu Behavior methods exercise tap, drag, cancel, disabled activation and label changes. Button layout remains 140×44 in the fixture. A 24px check retains its old inner geometry; the old Port can draw one pixel outside those bounds, so the test does not assert clipping. The rounded button corner reveals the background while its interior retains the state skin.

The module preloads ui-controls as the host does. Startup objects include the 34 grid icons, action button and small check even when only the grid is displayed. Heap observations are simulator instrumentation, and collection timing can differ between implementations; they do not measure device free RAM. Only the default 0-degree display path is covered.
