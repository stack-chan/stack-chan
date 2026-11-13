# Story reading MOD

This preserves the working November 8–9, 2026 story-reading prototype. It streams the public こえの本棚 podcast feed and adds a book, hands, reading gaze, mouth animation, and page turns to the existing Podcast/Radio player. Startup loads the feed without autoplay.

The branch starts at the original build dependency, `966877ed2024868d2605bb9a5f80eea0354d2d5c`. It is a preservation snapshot; compatibility with later media APIs has not been verified. The original standalone source was `2026-11-08/momotaro-reading-animation/public-source-verification/public-story-player`. Runtime behavior and assets are unchanged. The manifest now uses repository-relative dependency paths, the existing tests use local imports, and source formatting follows the repository formatter.

## Behavior

- Visuals offers Reading, Music, and Off. Reading is the default and suppresses music notes.
- Gaze follows an inverse Z from the viewer's perspective over eight seconds.
- Reading runs for 20 seconds, then five page frames advance at 200 ms intervals. The cover, spine, and hands stay fixed while the leaf rises behind the cover and turns left to right.
- Mouth animation advances on the 120 ms reading timer. It is a rhythmic animation, not audio-level lip sync. The mouth closes and gaze holds during a page turn.
- Pause, buffering, and retry close the mouth. Playback resumption restarts the reading interval. Stop and errors remove the book.
- The latest fix delivers palette changes directly to child behaviors so playback can start while the face is detached behind the Podcast mini-app.

## Source map

| File | Responsibility |
| --- | --- |
| `book-geometry.js` | Vector paths for the cover, spine, left hand, and right hand |
| `book-effect.js` | Piu book container, drawing order, palette propagation |
| `page-geometry.js` | Source silhouettes for the turning leaf |
| `page-effect.js` and `assets/reading-page-*.png` | Piu variant selection and two small alpha atlases |
| `choreography.js` | Reading gaze, mouth rhythm, and page-turn timing |
| `presentation.js` | Playback-driven visuals, timer ownership, and Visuals choice |
| `face-renderer.js` and `face-observer.js` | Face state rendering and observation |
| `player.js`, `mod.js`, and `config.ts` | Existing Podcast/Radio integration and public feed |

The bundled font provides the feed and episode title glyphs available at the time of the prototype. Its SIL Open Font License is beside the font. Future feed titles may require additional glyphs. Audio, device dumps, logs, generated firmware, and local streaming servers are not included.

## Validation

From `firmware/`, with the repository's Node.js version:

```sh
node --experimental-vm-modules --test mods/examples/story_reading/*.test.mjs
npm run mod:build -- mods/examples/story_reading/manifest.json --mode=release
```

The original delivery records report successful MOD build, XS compatibility, native Piu regression checks, public HTTPS playback, return to the face, page-turn telemetry, pause/resume, and stop. The final restart fix was installed on November 8 at 22:52 UTC. These are historical results, not a new device verification of this snapshot. Full-episode playback, human listening assessment, and camera verification were not part of those automated checks.

The preservation check passed 22 Node.js tests, MOD compilation using Moddable 10.1.0, and Biome lint. Font compilation reported a missing glyph for character 127, the DEL control character. Biome reported one informational suggestion about string concatenation.

This snapshot has not been installed on a device. New media-interface migration, audio-driven lip sync, and broader content/font coverage remain separate follow-up work.
