# Stack-chan external subplatforms

These directories define Stack-chan firmware targets as Moddable external subplatforms.
They let `xs-dev build` and `xs-dev run` select the board with `--device esp32:<platform-directory>` while keeping target-specific hardware configuration out of beginner-facing commands.

| Directory | Device |
| --- | --- |
| `stackchan_m5stack` | M5Stack Basic/Gray/Fire |
| `stackchan_m5stack_core2` | M5Stack Core2 |
| `stackchan_m5stack_cores3` | M5Stack CoreS3 |
| `m5stackchan_cores3` | M5Stack版StackChan CoreS3 |

For day-to-day use, prefer the npm scripts from `firmware/package.json`, such as `npm run flash`, `npm run flash:core2`, and `npm run debug`.
