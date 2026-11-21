"""Run the pinned SDK's platform-independent voice core tests only."""
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
source = Path(__file__).resolve().parents[1] / "vendor/muse-gadget-sdk/voice_core"
spec = importlib.util.spec_from_file_location("muse_voice_tests", source / "test_muse_voice_call.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.MUSE = source
module.TESTS = source
unittest.main(module=module, defaultTest="VoiceCallCore")
