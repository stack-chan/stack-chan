# SPDX-License-Identifier: Apache-2.0
"""Compile the native translation unit using a completed managed CoreS3 release.
Run from firmware with the same Linux SDK and ESP-IDF environment as that build.
"""
import json
import re
import shlex
import subprocess
from pathlib import Path

base = Path("dist/tmp/esp32/m5stackchan_cores3/release/stack-chan-host").resolve()
source = Path("host/modules/ui/components/face/avatar-native/native.c").resolve()
output = Path("dist/avatar-dsl-esp32-abi")
output.mkdir(exist_ok=True)
extra = output / "abi-flags.mk"
# Extract flags without building prerequisites or touching the SDK.
extra.write_text("avds-abi-command:\n\t@echo '$(CC) $(C_DEFINES) $(C_INCLUDES) $(C_FLAGS)'\n")
plan = subprocess.run(
    ["make", "-s", "-f", str(base / "makefile"), "-f", str(extra), "avds-abi-command"],
    capture_output=True, text=True, check=True,
)
commands = [shlex.split(line) for line in plan.stdout.splitlines() if "gcc" in line]
assert len(commands) == 1, len(commands)
args = commands[0] + [str(source), "-o", str(output / "native.o")]
assert "gcc" in args[0]
assert "-DkPocoRotation=0" in args, "CoreS3 release must start at rotation 0"
results = []
for rotation in [0, 90, 180, 270]:
    command = [arg.replace("-DkPocoRotation=0", f"-DkPocoRotation={rotation}") for arg in args]
    command[command.index("-o") + 1] = str(output / f"native-r{rotation}.o")
    subprocess.run(command, check=True)
    reader = command[0].replace("gcc", "readelf")
    dump = subprocess.run(
        [reader, "--debug-dump=info", command[command.index("-o") + 1]],
        capture_output=True, text=True, check=True,
    ).stdout
    # Read actual compiler-emitted type sizes rather than assuming host sizes.
    dies = {}
    current = None
    for line in dump.splitlines():
        match = re.search(r"<\d+><([0-9a-f]+)>:.*\((DW_TAG_\w+)\)", line)
        if match:
            current = {"tag": match[2]}
            dies[int(match[1], 16)] = current
        elif current is not None:
            match = re.search(r"DW_AT_(name|byte_size|type)\s*:\s*(.*)", line)
            if match:
                current[match[1]] = match[2]

    def size(die):
        if "byte_size" in die:
            return int(die["byte_size"], 0)
        return size(dies[int(re.search(r"<0x([0-9a-f]+)>", die["type"])[1], 16)])

    names = [
        "FT_Pos", "PocoOutlineRecord", "PocoCoordinate", "PocoDimension",
        "AvdsOutline", "AvdsFaceState", "AvdsPrimitive",
    ]
    values = {
        name: size(next(die for die in dies.values() if die.get("name", "").split(": ")[-1] == name))
        for name in names
    }
    assert values["FT_Pos"] == 4 and values["PocoCoordinate"] == 2 and values["PocoDimension"] == 2
    assert values["PocoOutlineRecord"] % values["FT_Pos"] == 0
    results.append({"rotation": rotation, "compiled": True, "abiSizes": values})
result = {
    "compiler": subprocess.run([args[0], "--version"], capture_output=True, text=True, check=True).stdout.splitlines()[0],
    "elf": "Xtensa ELF32 ESP32-S3",
    "rotations": results,
    "note": "Native translation unit uses the completed managed release build flags. Only compile-time ABI verified; no MCU execution.",
}
(output / "result.json").write_text(json.dumps(result, indent=2) + "\n")
print(json.dumps(result))
