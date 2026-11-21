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

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _cc_command() -> list[str]:
    cmd = shlex.split(os.environ.get("CC", "cc"))
    # Fail rather than skip: a missing compiler must not let the pairing
    # security checks pass silently.
    if not cmd or shutil.which(cmd[0]) is None:
        raise RuntimeError("C compiler not available; set CC")
    return cmd


class LinkPairingSignerPolicyTest(unittest.TestCase):
    def test_empty_block_is_the_only_community_efuse_state(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / "pairing_signer_policy_test"
            subprocess.run(
                [
                    *_cc_command(),
                    "-std=c11",
                    "-Wall",
                    "-Wextra",
                    "-Werror",
                    "-I",
                    str(ROOT / "main"),
                    str(ROOT / "main" / "pairing_signer_policy.c"),
                    str(ROOT / "tests" / "link_pairing_signer_policy_harness.c"),
                    "-o",
                    str(binary),
                ],
                check=True,
            )
            subprocess.run([str(binary)], check=True)


if __name__ == "__main__":
    unittest.main()
