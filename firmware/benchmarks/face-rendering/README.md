# Face rendering benchmark

This benchmark measures the shared face rendering path on M5StackChan CoreS3 or
M5Stack Core2. It runs six deterministic scenarios, warms each one for two
seconds, and emits 30 one-second JSON samples prefixed with
`[face-rendering-benchmark]`. Samples are buffered in fixed typed arrays and
emitted after each measured window, so JSON logging allocations do not
contaminate the GC measurement. The benchmark takes direct ownership of the
instrumentation counters so the platform's periodic reporter cannot reset CPU
or frame samples mid-window.

Build and flash it from `firmware/`. The unsuffixed commands target CoreS3:

```sh
npm run benchmark:face-rendering:build
npm run benchmark:face-rendering:flash

npm run benchmark:face-rendering:build:core2
npm run benchmark:face-rendering:flash:core2
```

The manifest's `"*"` module entry intentionally links native sources that do
not export JavaScript modules: `instrumentation-control.c` provides the
benchmark hook, while the SBC and ADPCM sources satisfy the custom CoreS3
platform's `pins/audioout-original` backend. The `instrumentation` import in
`main.ts` continues to resolve to the Moddable JavaScript module supplied by the
included UI/platform manifests; mapping that module name to the C file would
replace the JavaScript API instead of only adding the benchmark hook.

Capture the serial/debug output once on the baseline revision and once on the
candidate revision. Analyze either one run or compare both:

```sh
npm run benchmark:face-rendering:analyze -- candidate.log
npm run benchmark:face-rendering:analyze -- baseline.log candidate.log
```

The comparison fails unless `continuous-blink` and `blink-mouth` improve the
maximum-core CPU p95 by at least 30%. Candidate validation also requires at
least 30 samples per scenario, no missed 33 ms ticks, and no garbage collection
during the measured windows. A display-list overflow or native exception stops
the run before a valid sample set can be produced.

Use the same device, firmware mode, display brightness, and power source for
both captures. The benchmark loops after all scenarios, so stop capture after
the first complete cycle.

## Visual check on the lin simulator

Build the standalone visual app from `firmware/`:

```sh
source ~/.local/share/xs-dev-export.sh
node scripts/run-mcconfig.mjs -d -m -p lin/m5stack -t build \
  "$PWD/benchmarks/face-rendering/manifest.visual.json"
"$MODDABLE/build/bin/lin/release/mcsim" \
  "$PWD/dist/bin/lin/m5stack/debug/face-rendering/mc.so"
```

It continuously blends `NEUTRAL → ANGRY → SAD → HAPPY` while applying the
standard blink motion. The two eyes use iris radii of 8 and 16 pixels so that
proportional eyelid sizing can be checked during both blinking and expression
transitions.
