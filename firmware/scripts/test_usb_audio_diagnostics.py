import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).with_name("usb-audio-diagnostics.py")
WIRE_VECTORS = (
    SCRIPT.parent.parent
    / "vendor"
    / "stack-chan-dock"
    / "contracts"
    / "usb-cdc-v2"
    / "test-vectors.json"
)
SPEC = importlib.util.spec_from_file_location("stackchan_usb_audio_diagnostics", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
diagnostics = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = diagnostics
SPEC.loader.exec_module(diagnostics)


class ReplayTraceTest(unittest.TestCase):
    def test_diagnostic_session_closes_open_resources_when_output_initialization_fails(self) -> None:
        class FakeSerialPort:
            instances: list["FakeSerialPort"] = []

            def __init__(self, **_kwargs: object) -> None:
                self.dtr = False
                self.rts = False
                self.port = ""
                self.opened = False
                self.closed = False
                self.instances.append(self)

            def open(self) -> None:
                self.opened = True

            def close(self) -> None:
                self.closed = True

        class FakeWireTrace:
            instances: list["FakeWireTrace"] = []

            def __init__(self, _output: Path) -> None:
                self.closed = False
                self.instances.append(self)

            def close(self) -> None:
                self.closed = True

        class FakeSerialModule:
            Serial = FakeSerialPort

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            blocked_parent = root / "not-a-directory"
            blocked_parent.write_text("blocked", encoding="utf-8")
            with (
                mock.patch.object(diagnostics, "serial", FakeSerialModule),
                mock.patch.object(diagnostics, "WireTrace", FakeWireTrace),
                self.assertRaises(FileExistsError),
            ):
                diagnostics.DiagnosticSession(
                    "/dev/fake",
                    blocked_parent / "diagnostics.csv",
                    root / "wire.jsonl",
                )

        self.assertTrue(FakeSerialPort.instances[-1].opened)
        self.assertTrue(FakeSerialPort.instances[-1].closed)
        self.assertTrue(FakeWireTrace.instances[-1].closed)

    def test_shared_wire_vectors_match_the_diagnostics_codec(self) -> None:
        fixture = json.loads(WIRE_VECTORS.read_text(encoding="utf-8"))
        self.assertEqual(diagnostics.PROTOCOL_VERSION, fixture["protocolVersion"])

        for vector in fixture["validFrames"]:
            source = vector["frame"]
            frame = diagnostics.Frame(
                frame_type=source["type"],
                flags=source["flags"],
                stream_id=source["streamId"],
                sequence=source["sequence"],
                sample_rate=source["sampleRate"],
                payload=bytes.fromhex(source["payloadHex"]),
            )
            encoded = diagnostics.encode_frame(frame)
            self.assertEqual(vector["encodedHex"], encoded.hex(), vector["name"])
            self.assertEqual([frame], diagnostics.FrameParser().push(encoded), vector["name"])

        for vector in fixture["invalidFrames"]:
            self.assertEqual([], diagnostics.FrameParser().push(bytes.fromhex(vector["encodedHex"])), vector["name"])

    def test_wire_trace_decodes_received_error_code_without_storing_payload(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "wire.jsonl"
            trace = diagnostics.WireTrace(output)
            trace.record_received_frame(
                diagnostics.Frame(
                    frame_type=diagnostics.TYPE_CONTROL,
                    flags=diagnostics.CONTROL_ERROR,
                    stream_id=2,
                    sequence=7,
                    sample_rate=0,
                    payload=(3).to_bytes(4, "little"),
                )
            )
            trace.close()

            record = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(3, record["errorCode"])
            self.assertEqual(4, record["payloadBytes"])
            self.assertNotIn("payload", record)

    def test_wire_trace_records_one_physical_write_with_multiple_frame_boundaries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "wire.jsonl"
            trace = diagnostics.WireTrace(output)
            started = trace.started_nanos + 1_000_000
            frames = [
                diagnostics.Frame(
                    frame_type=diagnostics.TYPE_CONTROL,
                    flags=diagnostics.CONTROL_SPEAKER_START,
                    stream_id=2,
                    sequence=1,
                    sample_rate=24_000,
                    payload=b"",
                ),
                diagnostics.Frame(
                    frame_type=diagnostics.TYPE_SPEAKER_PCM,
                    flags=0,
                    stream_id=2,
                    sequence=0,
                    sample_rate=24_000,
                    payload=bytes(3_840),
                ),
            ]
            trace.record_write_batch(frames, started, started, started + 2_000, 3_888, 3_888)
            trace.close()

            record = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(1, record["writeIndex"])
            self.assertEqual(2, record["frameCount"])
            self.assertEqual(3_888, record["requestedBytes"])
            self.assertEqual([0, 24], [frame["offsetBytes"] for frame in record["frames"]])
            self.assertEqual([24, 3_864], [frame["encodedBytes"] for frame in record["frames"]])

    def test_loads_android_write_boundaries_and_timing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            trace = Path(temporary) / "playback.jsonl"
            records = [
                {"schemaVersion": 2, "event": "session_started", "elapsedUs": 0},
                self.write_record(
                    started_us=1_000,
                    frame_type=diagnostics.TYPE_CONTROL,
                    flags=diagnostics.CONTROL_SPEAKER_START,
                    sequence=4,
                    payload_bytes=0,
                ),
                self.write_record(
                    started_us=1_125,
                    frame_type=diagnostics.TYPE_SPEAKER_PCM,
                    flags=0,
                    sequence=0,
                    payload_bytes=3_840,
                ),
            ]
            trace.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")

            writes = diagnostics.load_replay_writes(trace)

            self.assertEqual([1_000, 1_125], [write.started_elapsed_us for write in writes])
            self.assertEqual([24, 3_864], [write.requested_bytes for write in writes])
            self.assertEqual(bytes(3_840), writes[1].frame.payload)

    def test_rejects_a_write_size_that_does_not_match_the_frame(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            trace = Path(temporary) / "playback.jsonl"
            record = self.write_record(
                started_us=1_000,
                frame_type=diagnostics.TYPE_CONTROL,
                flags=diagnostics.CONTROL_SPEAKER_START,
                sequence=1,
                payload_bytes=0,
            )
            record["requestedBytes"] = 25
            trace.write_text(json.dumps(record) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "does not match"):
                diagnostics.load_replay_writes(trace)

    def test_replay_accepts_only_speaker_session_writes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            trace = Path(temporary) / "playback.jsonl"
            records = [
                self.write_record(
                    started_us=1_000,
                    frame_type=diagnostics.TYPE_CONTROL,
                    flags=diagnostics.CONTROL_SPEAKER_START,
                    sequence=1,
                    payload_bytes=0,
                ),
                self.write_record(
                    started_us=1_100,
                    frame_type=diagnostics.TYPE_CONTROL,
                    flags=16,
                    sequence=2,
                    payload_bytes=0,
                ),
            ]
            trace.write_text("".join(json.dumps(record) + "\n" for record in records), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "not allowed in a speaker replay"):
                diagnostics.load_replay_writes(trace)

    @staticmethod
    def write_record(
        *,
        started_us: int,
        frame_type: int,
        flags: int,
        sequence: int,
        payload_bytes: int,
    ) -> dict[str, int | str]:
        return {
            "schemaVersion": 2,
            "event": "usb_write",
            "startedElapsedUs": started_us,
            "requestedBytes": diagnostics.HEADER_BYTES + payload_bytes + diagnostics.CRC_BYTES,
            "frameTypeValue": frame_type,
            "flags": flags,
            "streamId": 2,
            "sequence": sequence,
            "sampleRate": 24_000,
            "payloadBytes": payload_bytes,
        }


if __name__ == "__main__":
    unittest.main()
