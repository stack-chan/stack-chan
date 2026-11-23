# Copyright (c) Meta Platforms, Inc. and affiliates.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Exercise the actual firmware handshake with real host crypto.

Run after ESP-IDF and managed components are installed:
  IDF_PATH=/path/to/esp-idf python3 -m unittest tests.test_link_pairing_handshake
Optional overrides: MBEDTLS_SOURCE_DIR (Mbed TLS project root containing
 tf-psa-crypto/) and CJSON_SOURCE_DIR (directory containing cJSON.c and cJSON.h).
The eFuse hardware handle maps to a throwaway test scalar; no physical device or
production key is accessed. This does not validate ESP32 hardware signing.
"""
from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LinkPairingHandshakeTest(unittest.TestCase):
    def test_actual_pairing_modes_and_session_transitions(self) -> None:
        idf_path = os.environ.get("IDF_PATH")
        crypto_path = os.environ.get("MBEDTLS_SOURCE_DIR")
        if crypto_path:
            mbedtls = Path(crypto_path).resolve()
        elif idf_path:
            mbedtls = Path(idf_path).resolve() / "components/mbedtls/mbedtls"
        else:
            self.skipTest("Set IDF_PATH or MBEDTLS_SOURCE_DIR for real-crypto pairing tests")
        crypto = mbedtls / "tf-psa-crypto"
        self.assertTrue(
            (crypto / "CMakeLists.txt").is_file(),
            "The selected ESP-IDF/Mbed TLS source has no tf-psa-crypto project",
        )
        cjson = Path(os.environ.get("CJSON_SOURCE_DIR", str(
            ROOT / "managed_components/espressif__cjson/cJSON"
        ))).resolve()
        self.assertTrue(
            all((cjson / name).is_file() for name in ("cJSON.c", "cJSON.h")),
            f"Install managed cJSON or set CJSON_SOURCE_DIR (checked {cjson})",
        )
        cc = shlex.split(os.environ.get("CC", "cc"))
        cmake = shutil.which("cmake")
        self.assertTrue(cmake and cc and shutil.which(cc[0]), "Host C compiler and CMake are required")

        def run(command: list[str], cwd: Path) -> str:
            result = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout[-12000:] + result.stderr[-12000:])
            return result.stdout

        with tempfile.TemporaryDirectory(prefix="link-pairing-test-") as directory:
            temp = Path(directory).resolve()
            compat = temp / "compat"
            (compat / "mbedtls").mkdir(parents=True)
            # IDF relocated these public wrappers while retaining upstream APIs.
            # Map directly to the software headers; do not enable ESP hardware.
            for name in ("bignum", "ecp"):
                (compat / "mbedtls" / f"{name}.h").write_text(
                    '#pragma once\n#define MBEDTLS_DECLARE_PRIVATE_IDENTIFIERS\n'
                    f'#include "mbedtls/private/{name}.h"\n'
                )
            (compat / "sdkconfig.h").write_text("")
            build = temp / "crypto-build"
            run([
                cmake, "-S", str(mbedtls), "-B", str(build),
                "-DENABLE_TESTING=OFF", "-DENABLE_PROGRAMS=OFF", "-DGEN_FILES=OFF",
                "-DMBEDTLS_FATAL_WARNINGS=OFF", "-DDISABLE_PACKAGE_CONFIG_AND_INSTALL=ON",
                "-DCMAKE_BUILD_TYPE=Release", f"-DCMAKE_C_COMPILER={cc[0]}",
                "-DCMAKE_C_FLAGS=-I" + shlex.quote(str(compat)),
            ], temp)
            run([cmake, "--build", str(build), "--target", "tfpsacrypto", "-j", "4"], temp)
            built_crypto = build / "tf-psa-crypto"
            includes = [
                ROOT / "tests/pairing_fakes", compat, ROOT / "main", cjson,
                crypto / "include", crypto / "drivers/builtin/include", crypto / "core",
                crypto / "drivers/builtin/src", built_crypto / "core",
            ]
            # Every archive the tfpsacrypto target built: the set and the names
            # differ between TF-PSA-Crypto releases (ESP-IDF v6.0.1 has 1.0,
            # v6.0.3 has 1.1).
            core = built_crypto / "core/libtfpsacrypto.a"
            libraries = [core, *sorted(set(built_crypto.rglob("*.a")) - {core})]
            for enabled in (False, True):
                with self.subTest(manufacturer_attestation=enabled):
                    executable = temp / f"pairing-{int(enabled)}"
                    command = [
                        *cc, "-std=c11", "-Wall", "-Wextra", "-Werror",
                        "-Wno-unused-function", "-Wno-unused-variable",
                        f"-DTEST_PAIRING_EFUSE_AUTH={int(enabled)}",
                    ]
                    for include in includes:
                        command.extend(["-I", str(include)])
                    library_args = [str(path) for path in libraries]
                    if sys.platform.startswith("linux"):
                        library_args = ["-Wl,--start-group", *library_args, "-Wl,--end-group"]
                    command.extend([
                        str(ROOT / "tests/link_pairing_handshake_harness.c"),
                        str(ROOT / "main/pairing_transcript.c"),
                        str(ROOT / "main/pairing_signer_policy.c"), str(cjson / "cJSON.c"),
                        *library_args, "-o", str(executable),
                    ])
                    run(command, temp)
                    self.assertIn("PASS actual pairing:", run([str(executable)], temp))


if __name__ == "__main__":
    unittest.main()
