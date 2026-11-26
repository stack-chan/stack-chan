#!/usr/bin/env python3
"""Run the ESP32 queue code with a deterministic DMA/XS task switch on the build host.

Run with MODDABLE set. --stock runs the same PCM check against the unpatched SDK.
The hardware functions below the PCM writer are replaced by a recording sink.
"""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--stock", action="store_true")
args = parser.parse_args()
sdk = Path(os.environ["MODDABLE"])
tests = Path(__file__).resolve().parent
firmware = tests.parents[4]
driver = sdk / "modules/embedded/io/audio/out/esp32/audioout-esp32.c"


def function(source, signature):
    # Compile the production definitions; their prototypes end in semicolons.
    lines = source.splitlines()
    first = next(i for i, line in enumerate(lines)
                 if line.startswith(signature + "(") and not line.endswith(";"))
    last = lines.index("}", first)
    return "\n".join(lines[first:last + 1])


with tempfile.TemporaryDirectory() as directory:
    work = Path(directory)
    if not args.stock:
        module = (firmware / "scripts/lib/buffered-audio-driver.mjs").as_uri()
        subprocess.run(["node", "--input-type=module", "-e",
                        f"import {{prepareBufferedAudioDriver}} from '{module}';"
                        "prepareBufferedAudioDriver(process.argv[1], process.argv[2]);",
                        str(sdk), str(work)], check=True)
        driver = work / "tmp/sdk-audioout/audioout-esp32.c"

    source = driver.read_text()
    declarations = source[source.index("typedef struct AudioOutElementRecord"):
                          source.index("static bool playedBuffer(")]
    functions = ["static bool playedBuffer", "static void audiooutDeliver",
                 "esp_err_t doWrite", "void audioOutLoop"]
    if not args.stock:
        functions.append("static void fixedOutLoop")
    (work / "driver-records.inc").write_text(declarations)
    (work / "driver-functions.inc").write_text('\n'.join(function(source, fn) for fn in functions))
    subprocess.run([os.environ.get("CC", "cc"), "-std=c11", "-fsanitize=address,undefined",
                    "-g", "-I", str(work), f"-DSTOCK={int(args.stock)}", str(tests / "exercise.c"), "-o", "driver"],
                   cwd=work, check=True)
    command = [str(work / "driver")]
    result = subprocess.run(command, timeout=10)
    if result.returncode:
        raise SystemExit(result.returncode)
    if not args.stock:
        for scenario in ("unity-gain", "tail-fragment", "close", "short-write"):
            subprocess.run([*command, scenario], check=True, timeout=10)
