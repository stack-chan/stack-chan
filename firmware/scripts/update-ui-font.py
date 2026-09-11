#!/usr/bin/env python3
"""Rebuild the UI font subset from the pinned upstream font and the locale catalogs."""
import hashlib
import json
from pathlib import Path
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = Path(sys.argv[1]) if len(sys.argv) == 2 else None
if source is None:
    raise SystemExit("Usage: python3 scripts/update-ui-font.py /path/to/NotoSansSC-VF.ttf (requires fonttools)")
if hashlib.sha256(source.read_bytes()).hexdigest() != "d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964":
    raise SystemExit("The source font differs from the pinned Noto Sans CJK SC 2.004 Regular font")
firmware = Path(__file__).resolve().parents[1]
codepoints = set(range(32, 127))
for locale in ("ja", "en", "zh-CN"):
    catalog = json.loads((firmware / "host/app/strings" / f"{locale}.json").read_text())
    codepoints.update(ord(char) for value in catalog.values() for char in value if not char.isspace())
font = instantiateVariableFont(TTFont(source, recalcTimestamp=False), {"wght": 400}, inplace=True)
options = subset.Options()
options.recalc_timestamp = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=codepoints)
subsetter.subset(font)
font.save(firmware / "host/modules/ui/assets/fonts/StackchanCJK-Regular.ttf")
print(f"UI font rebuilt for {len(codepoints)} codepoints")
