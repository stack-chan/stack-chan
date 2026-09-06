"""Compare tracked source sizes without relying on build output or working-tree edits.

Run from any directory: python3 measure.py [revision, default HEAD] [--files]
Physical lines include comments and blanks; a decrease alone is not retirement proof.
"""

import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
BASE = "6eb462331dd1677791d6aa2a6b257a20da43b9a9"
EXTENSIONS = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".c", ".h", ".cpp", ".hpp"}
PRODUCT = {"firmware_runtime", "public_contracts", "web_runtime", "type_declarations"}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def role(path):
    name = Path(path).name
    if "/vendor/" in path or path == "web/simulator/mc.js":
        return "vendor_generated"
    if (any(part in path for part in ("/__tests__/", "/testing/", "/fixtures/", "/test/", "/contracts/sdk/"))
            or re.search(r"\.(test|spec|architecture)\.", name)
            or re.search(r"(?:^visual-|-(?:visual|visual-test)\.)", name)
            or name == "test-preview-server.mjs"):
        return "tests_and_support"
    if (any(path.startswith(prefix) for prefix in ("firmware/scripts/", "firmware/tools/", "firmware/benchmarks/"))
            or name.endswith(".config.ts") or name.startswith("check-") or name.endswith("-cli.mjs")
            or name == "compose.mjs"):
        return "development_tools"
    if any(path.startswith(prefix) for prefix in (
        "firmware/mods/", "firmware/lessons/", "web/mod-gallery/samples/", "web/simulator/samples/",
    )):
        return "examples_and_lessons"
    if name.endswith((".d.ts", ".d.mts")) or path.startswith("firmware/typings/"):
        return "type_declarations"
    if path.startswith(("firmware/sdk/", "firmware/contracts/")):
        return "public_contracts"
    return "web_runtime" if path.startswith("web/") else "firmware_runtime"


def snapshot(revision):
    commit = git("rev-parse", "--verify", revision + "^{commit}").decode().strip()
    paths = sorted(path for path in git("ls-tree", "-r", "--name-only", commit, "--", "firmware", "web").decode().splitlines()
                   if Path(path).suffix in EXTENSIONS)
    batch = subprocess.run(["git", "cat-file", "--batch"], cwd=ROOT,
                           input="".join(f"{commit}:{path}\n" for path in paths).encode(), capture_output=True, check=True)
    stream = io.BytesIO(batch.stdout)
    files = []
    groups = {}
    for path in paths:
        _, kind, size = stream.readline().split()
        assert kind == b"blob"
        data = stream.read(int(size))
        assert stream.read(1) == b"\n"
        group = role(path)
        lines = len(data.splitlines())
        files.append({"path": path, "role": group, "lines": lines, "sha256": hashlib.sha256(data).hexdigest()})
        counts = groups.setdefault(group, {"files": 0, "physical_lines": 0})
        counts["files"] += 1
        counts["physical_lines"] += lines
    product = {key: sum(group[key] for name, group in groups.items() if name in PRODUCT)
               for key in ("files", "physical_lines")}
    result = {"commit": commit, "groups": groups, "product": product}
    if "--files" in sys.argv:
        result["files"] = files
    return result


revisions = [argument for argument in sys.argv[1:] if argument != "--files"]
before = snapshot(BASE)
after = snapshot(revisions[0] if revisions else "HEAD")
print(json.dumps({"method": "Tracked TS/JS/C-family physical source lines; fixed roles in measure.py",
                  "base": before, "current": after,
                  "product_delta": {key: after["product"][key] - before["product"][key]
                                    for key in ("files", "physical_lines")}}, ensure_ascii=False, indent=2))
