# JitomeFace CoreS3 benchmark

The instrumented benchmark runs four 18-second phases on a 320x240 M5Stack
CoreS3: static, unchanged FaceState delivery at 30 fps, blink-only animation at
30 fps, and worst-case eye/gaze/mouth motion at 30 fps. Discard the first five
one-second instrumentation samples in each phase. `Frames Drawn` counts Piu/Poco
frame submissions rather than LCD scanout refreshes. CPU values are whole-core
non-idle load, not time attributed only to JitomeFace.

Build and flash from `firmware/` with the clean Moddable 9.5.0 and ESP-IDF 6.1
environments active:

```sh
npm run benchmark:jitome-face:build:cores3
UPLOAD_PORT=/dev/ttyACM0 npm run benchmark:jitome-face:flash:cores3
UPLOAD_PORT=/dev/ttyACM0 npm run benchmark:jitome-face:capture:cores3
```

The capture command resets the installed benchmark, saves the raw serial output
to `dist/jitome-face-benchmark/run.log`, and writes the computed phase statistics
to `dist/jitome-face-benchmark/result.json`. It uses the active ESP-IDF Python
environment for serial reset; set `ESP_IDF_PYTHON` when that interpreter is not
named `python3` on `PATH`.
