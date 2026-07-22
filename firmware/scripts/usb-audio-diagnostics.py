#!/usr/bin/env python3
"""Send deterministic PCM to Stack-chan and record device-side AudioOut telemetry."""

from __future__ import annotations

import argparse
import binascii
import csv
import json
import math
import struct
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import serial
except ModuleNotFoundError:
    serial = None


MAGIC = 0x5343
MAGIC_BYTES = b"\x43\x53"
PROTOCOL_VERSION = 2
HEADER_BYTES = 20
CRC_BYTES = 4
MAX_PAYLOAD_BYTES = 4096
MAX_CAPTION_BYTES = 1024
MAX_REPLAY_TRACE_BYTES = 16 * 1024 * 1024
MAX_REPLAY_WRITES = 10_000
MAX_REPLAY_SPAN_US = 10 * 60 * 1_000_000
MAX_WIRE_TRACE_RECORDS = 100_000

TYPE_CONTROL = 0
TYPE_SPEAKER_PCM = 2
TYPE_DIAGNOSTICS = 5

CONTROL_HELLO = 1
CONTROL_HELLO_ACK = 2
CONTROL_ERROR = 3
CONTROL_SPEAKER_START = 32
CONTROL_SPEAKER_CREDIT = 33
CONTROL_SPEAKER_END = 34
CONTROL_SPEAKER_DONE = 35
CONTROL_SPEAKER_ABORT = 36
CONTROL_SPEAKER_TEXT = 37
CONTROL_STATUS = 48

CAPABILITIES = 0x37F
CAPABILITY_SPEAKER_TEXT = 1 << 6
CAPABILITY_DIAGNOSTICS = 1 << 7
CAPABILITY_STATUS_ICON = 1 << 8
CAPABILITY_STREAM_ID = 1 << 9
DIAGNOSTICS_VERSION = 1
DIAGNOSTICS_PAYLOAD_BYTES = 52

DIAGNOSTIC_EVENTS = {
    1: "session_started",
    2: "audio_started",
    3: "snapshot",
    4: "completed",
    5: "aborted",
}

CSV_FIELDS = [
    "host_ms",
    "event",
    "flags",
    "device_ticks",
    "sample_rate",
    "queued_bytes",
    "writable_bytes",
    "received_bytes",
    "written_bytes",
    "received_frames",
    "writable_callbacks",
    "starvation_events",
    "max_receive_gap_ms",
    "max_writable_gap_ms",
    "device_tx_queue_bytes",
    "host_credit_bytes",
    "host_sent_bytes",
    "host_sent_frames",
]


@dataclass(frozen=True)
class Frame:
    frame_type: int
    flags: int
    stream_id: int
    sequence: int
    sample_rate: int
    payload: bytes


@dataclass(frozen=True)
class ReplayWrite:
    started_elapsed_us: int
    requested_bytes: int
    frame: Frame


class ProtocolError(RuntimeError):
    def __init__(self, code: int, stream_id: int) -> None:
        super().__init__(f"Stack-chan returned protocol error {code}, stream={stream_id}")
        self.code = code
        self.stream_id = stream_id


class WireTrace:
    def __init__(self, output: Path) -> None:
        self.output = output
        self.started_at_utc = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        self.started_nanos = time.monotonic_ns()
        self.records: list[dict[str, Any]] = []
        self.dropped_records = 0
        self.write_index = 0
        self.read_index = 0
        self.previous_write_started_nanos: int | None = None
        self.previous_write_completed_nanos: int | None = None

    def elapsed_us(self, monotonic_nanos: int) -> int:
        return max(0, (monotonic_nanos - self.started_nanos) // 1_000)

    def record_write(
        self,
        frame: Frame,
        queued_nanos: int,
        started_nanos: int,
        completed_nanos: int,
        requested_bytes: int,
        written_bytes: int,
    ) -> None:
        self.record_write_batch(
            [frame],
            queued_nanos,
            started_nanos,
            completed_nanos,
            requested_bytes,
            written_bytes,
        )

    def record_write_batch(
        self,
        frames: list[Frame],
        queued_nanos: int,
        started_nanos: int,
        completed_nanos: int,
        requested_bytes: int,
        written_bytes: int,
    ) -> None:
        if not frames:
            raise ValueError("USB write batch must contain at least one frame")
        self.write_index += 1
        record = self._record("usb_write", completed_nanos)
        record.update(
            {
                "writeIndex": self.write_index,
                "queuedElapsedUs": self.elapsed_us(queued_nanos),
                "startedElapsedUs": self.elapsed_us(started_nanos),
                "completedElapsedUs": self.elapsed_us(completed_nanos),
                "mutexWaitUs": (started_nanos - queued_nanos) // 1_000,
                "writeDurationUs": (completed_nanos - started_nanos) // 1_000,
                "gapFromPreviousWriteStartUs": self._gap(started_nanos, self.previous_write_started_nanos),
                "gapFromPreviousWriteCompleteUs": self._gap(started_nanos, self.previous_write_completed_nanos),
                "requestedBytes": requested_bytes,
                "writtenBytes": written_bytes,
                "frameCount": len(frames),
            }
        )
        if len(frames) == 1:
            record.update(frame_fields(frames[0]))
        else:
            offset = 0
            frame_records: list[dict[str, int | str | None]] = []
            for frame in frames:
                encoded_bytes = HEADER_BYTES + len(frame.payload) + CRC_BYTES
                frame_records.append(
                    {
                        "offsetBytes": offset,
                        "encodedBytes": encoded_bytes,
                        **frame_fields(frame),
                    }
                )
                offset += encoded_bytes
            record["frames"] = frame_records
        self.previous_write_started_nanos = started_nanos
        self.previous_write_completed_nanos = completed_nanos

    def record_read(self, waiting_bytes: int, started_nanos: int, completed_nanos: int, read_bytes: int) -> None:
        self.read_index += 1
        record = self._record("usb_read", completed_nanos)
        record.update(
            {
                "readIndex": self.read_index,
                "waitingBytes": waiting_bytes,
                "startedElapsedUs": self.elapsed_us(started_nanos),
                "completedElapsedUs": self.elapsed_us(completed_nanos),
                "readDurationUs": (completed_nanos - started_nanos) // 1_000,
                "readBytes": read_bytes,
            }
        )

    def record_received_frame(self, frame: Frame) -> None:
        record = self._record("frame_received")
        record.update(frame_fields(frame))
        if frame.frame_type == TYPE_CONTROL and len(frame.payload) == 4:
            value = struct.unpack("<I", frame.payload)[0]
            if frame.flags == CONTROL_ERROR:
                record["errorCode"] = value
            elif frame.flags == CONTROL_SPEAKER_CREDIT:
                record["creditBytes"] = value

    def close(self) -> None:
        self.output.parent.mkdir(parents=True, exist_ok=True)
        if self.dropped_records:
            self.records.append(
                {
                    "schemaVersion": 2,
                    "sessionStartedAtUtc": self.started_at_utc,
                    "elapsedUs": self.elapsed_us(time.monotonic_ns()),
                    "event": "trace_truncated",
                    "droppedRecords": self.dropped_records,
                }
            )
        text = "".join(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n" for record in self.records)
        self.output.write_text(text, encoding="utf-8")

    def _record(self, event: str, monotonic_nanos: int | None = None) -> dict[str, Any]:
        if len(self.records) >= MAX_WIRE_TRACE_RECORDS:
            self.dropped_records += 1
            return {}
        elapsed_us = self.elapsed_us(monotonic_nanos if monotonic_nanos is not None else time.monotonic_ns())
        record: dict[str, Any] = {
            "schemaVersion": 2,
            "sessionStartedAtUtc": self.started_at_utc,
            "elapsedUs": elapsed_us,
            "elapsedMs": elapsed_us // 1_000,
            "event": event,
        }
        self.records.append(record)
        return record

    @staticmethod
    def _gap(current: int, previous: int | None) -> int | None:
        return None if previous is None else (current - previous) // 1_000


def frame_fields(frame: Frame) -> dict[str, int | str | None]:
    controls = {
        CONTROL_HELLO: "HELLO",
        CONTROL_HELLO_ACK: "HELLO_ACK",
        CONTROL_ERROR: "ERROR",
        CONTROL_SPEAKER_START: "SPEAKER_START",
        CONTROL_SPEAKER_CREDIT: "SPEAKER_CREDIT",
        CONTROL_SPEAKER_END: "SPEAKER_END",
        CONTROL_SPEAKER_DONE: "SPEAKER_DONE",
        CONTROL_SPEAKER_ABORT: "SPEAKER_ABORT",
        CONTROL_SPEAKER_TEXT: "SPEAKER_TEXT",
        CONTROL_STATUS: "STATUS",
    }
    frame_types = {TYPE_CONTROL: "CONTROL", TYPE_SPEAKER_PCM: "SPEAKER_PCM", TYPE_DIAGNOSTICS: "DIAGNOSTICS"}
    return {
        "frameType": frame_types.get(frame.frame_type, f"TYPE_{frame.frame_type}"),
        "frameTypeValue": frame.frame_type,
        "control": controls.get(frame.flags) if frame.frame_type == TYPE_CONTROL else None,
        "flags": frame.flags,
        "streamId": frame.stream_id,
        "sequence": frame.sequence,
        "sampleRate": frame.sample_rate,
        "payloadBytes": len(frame.payload),
    }


class FrameParser:
    def __init__(self) -> None:
        self.pending = bytearray()

    def push(self, chunk: bytes) -> list[Frame]:
        self.pending.extend(chunk)
        result: list[Frame] = []
        while len(self.pending) >= HEADER_BYTES + CRC_BYTES:
            magic_offset = self.pending.find(MAGIC_BYTES)
            if magic_offset < 0:
                del self.pending[:-1]
                break
            if magic_offset:
                del self.pending[:magic_offset]
            if len(self.pending) < HEADER_BYTES + CRC_BYTES:
                break
            magic, version, frame_type, flags, stream_id, sequence, sample_rate, length = struct.unpack_from(
                "<HBBHHIII", self.pending
            )
            if (
                magic != MAGIC
                or version != PROTOCOL_VERSION
                or frame_type > TYPE_DIAGNOSTICS
                or length > MAX_PAYLOAD_BYTES
            ):
                del self.pending[0]
                continue
            frame_length = HEADER_BYTES + length + CRC_BYTES
            if len(self.pending) < frame_length:
                break
            candidate = bytes(self.pending[:frame_length])
            expected_crc = struct.unpack_from("<I", candidate, HEADER_BYTES + length)[0]
            actual_crc = binascii.crc32(candidate[: HEADER_BYTES + length]) & 0xFFFFFFFF
            if actual_crc != expected_crc:
                del self.pending[0]
                continue
            result.append(
                Frame(
                    frame_type=frame_type,
                    flags=flags,
                    stream_id=stream_id,
                    sequence=sequence,
                    sample_rate=sample_rate,
                    payload=candidate[HEADER_BYTES : HEADER_BYTES + length],
                )
            )
            del self.pending[:frame_length]
        return result


def encode_frame(frame: Frame) -> bytes:
    if len(frame.payload) > MAX_PAYLOAD_BYTES:
        raise ValueError("payload is too large")
    header = struct.pack(
        "<HBBHHIII",
        MAGIC,
        PROTOCOL_VERSION,
        frame.frame_type,
        frame.flags,
        frame.stream_id,
        frame.sequence & 0xFFFFFFFF,
        frame.sample_rate,
        len(frame.payload),
    )
    body = header + frame.payload
    return body + struct.pack("<I", binascii.crc32(body) & 0xFFFFFFFF)


def parse_diagnostics(payload: bytes) -> dict[str, int | str]:
    if len(payload) != DIAGNOSTICS_PAYLOAD_BYTES:
        raise ValueError(f"unexpected diagnostic payload length: {len(payload)}")
    version, event, flags = struct.unpack_from("<BBH", payload)
    if version != DIAGNOSTICS_VERSION:
        raise ValueError(f"unsupported diagnostics version: {version}")
    values = struct.unpack_from("<12I", payload, 4)
    return {
        "event": DIAGNOSTIC_EVENTS.get(event, f"unknown_{event}"),
        "flags": flags,
        "device_ticks": values[0],
        "sample_rate": values[1],
        "queued_bytes": values[2],
        "writable_bytes": values[3],
        "received_bytes": values[4],
        "written_bytes": values[5],
        "received_frames": values[6],
        "writable_callbacks": values[7],
        "starvation_events": values[8],
        "max_receive_gap_ms": values[9],
        "max_writable_gap_ms": values[10],
        "device_tx_queue_bytes": values[11],
    }


def make_pcm_frame(sample_rate: int, frame_milliseconds: int, frequency: float, first_sample: int) -> bytes:
    sample_count = sample_rate * frame_milliseconds // 1000
    result = bytearray(sample_count * 2)
    for index in range(sample_count):
        angle = 2 * math.pi * frequency * (first_sample + index) / sample_rate
        struct.pack_into("<h", result, index * 2, round(math.sin(angle) * 8000))
    return bytes(result)


def load_replay_writes(trace: Path) -> list[ReplayWrite]:
    if trace.stat().st_size > MAX_REPLAY_TRACE_BYTES:
        raise ValueError(f"{trace}: trace exceeds {MAX_REPLAY_TRACE_BYTES} bytes")
    writes: list[ReplayWrite] = []
    for line_number, line in enumerate(trace.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"{trace}:{line_number}: invalid JSON: {error}") from error
        if record.get("event") != "usb_write":
            continue
        try:
            frame_type = int(record["frameTypeValue"])
            flags = int(record["flags"])
            stream_id = int(record["streamId"])
            sequence = int(record["sequence"])
            sample_rate = int(record["sampleRate"])
            payload_bytes = int(record["payloadBytes"])
            requested_bytes = int(record["requestedBytes"])
            started_elapsed_us = int(record["startedElapsedUs"])
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"{trace}:{line_number}: incomplete usb_write record") from error
        if payload_bytes < 0 or payload_bytes > MAX_PAYLOAD_BYTES:
            raise ValueError(f"{trace}:{line_number}: invalid payloadBytes={payload_bytes}")
        if started_elapsed_us < 0:
            raise ValueError(f"{trace}:{line_number}: startedElapsedUs must not be negative")
        if requested_bytes != HEADER_BYTES + payload_bytes + CRC_BYTES:
            raise ValueError(
                f"{trace}:{line_number}: requestedBytes={requested_bytes} does not match payloadBytes={payload_bytes}"
            )
        payload = replay_payload(frame_type, flags, payload_bytes)
        if flags == CONTROL_STATUS and (frame_type != TYPE_CONTROL or stream_id != 0):
            raise ValueError(f"{trace}:{line_number}: STATUS must be a stream-zero control frame")
        if frame_type == TYPE_SPEAKER_PCM or flags in {
            CONTROL_SPEAKER_START,
            CONTROL_SPEAKER_END,
            CONTROL_SPEAKER_ABORT,
            CONTROL_SPEAKER_TEXT,
        }:
            if stream_id == 0:
                raise ValueError(f"{trace}:{line_number}: speaker write has streamId=0")
            if sample_rate not in (8_000, 16_000, 24_000):
                raise ValueError(f"{trace}:{line_number}: unsupported speaker sampleRate={sample_rate}")
        writes.append(
            ReplayWrite(
                started_elapsed_us=started_elapsed_us,
                requested_bytes=requested_bytes,
                frame=Frame(
                    frame_type=frame_type,
                    flags=flags,
                    stream_id=stream_id,
                    sequence=sequence,
                    sample_rate=sample_rate,
                    payload=payload,
                ),
            )
        )
        if len(writes) > MAX_REPLAY_WRITES:
            raise ValueError(f"{trace}: trace exceeds {MAX_REPLAY_WRITES} USB writes")
    if not writes:
        raise ValueError(f"{trace}: no schema-version 2 usb_write records")
    for previous, current in zip(writes, writes[1:]):
        if current.started_elapsed_us < previous.started_elapsed_us:
            raise ValueError(f"{trace}: usb_write startedElapsedUs is not monotonic")
    starts = [
        write
        for write in writes
        if write.frame.frame_type == TYPE_CONTROL and write.frame.flags == CONTROL_SPEAKER_START
    ]
    if len(starts) != 1:
        raise ValueError(f"{trace}: expected exactly one SPEAKER_START write")
    if writes[-1].started_elapsed_us - writes[0].started_elapsed_us > MAX_REPLAY_SPAN_US:
        raise ValueError(f"{trace}: replay span exceeds {MAX_REPLAY_SPAN_US} microseconds")
    active_stream_id = starts[0].frame.stream_id
    return [write for write in writes if write.frame.stream_id in (0, active_stream_id)]


def replay_payload(frame_type: int, flags: int, payload_bytes: int) -> bytes:
    if frame_type == TYPE_SPEAKER_PCM:
        if payload_bytes % 2:
            raise ValueError("speaker PCM payload must contain complete 16-bit samples")
        return bytes(payload_bytes)
    if frame_type != TYPE_CONTROL:
        raise ValueError(f"cannot synthesize replay payload for frame type {frame_type}")
    if flags not in {
        CONTROL_SPEAKER_START,
        CONTROL_SPEAKER_END,
        CONTROL_SPEAKER_ABORT,
        CONTROL_SPEAKER_TEXT,
        CONTROL_STATUS,
    }:
        raise ValueError(f"control {flags} is not allowed in a speaker replay")
    if flags == CONTROL_SPEAKER_TEXT:
        return b"x" * payload_bytes
    if flags == CONTROL_STATUS:
        if payload_bytes != 1:
            raise ValueError("STATUS replay payload must be one byte")
        return bytes(payload_bytes)
    if payload_bytes:
        raise ValueError(f"cannot synthesize {payload_bytes} payload bytes for control {flags}")
    return b""


class DiagnosticSession:
    def __init__(self, port: str, output: Path, wire_output: Path, control_lines_active: bool = False) -> None:
        if serial is None:
            raise ModuleNotFoundError(
                "pyserial is unavailable. Run this command after "
                "`source ~/.local/share/xs-dev-export.sh`."
            )
        # Configure control lines before opening the port so pyserial does not
        # pulse DTR/RTS while the first HELLO frame is being written.
        self.port = serial.Serial(
            port=None,
            baudrate=115200,
            timeout=0,
            write_timeout=2,
            exclusive=True,
        )
        self.port.dtr = control_lines_active
        self.port.rts = control_lines_active
        self.port.port = port
        self.port.open()
        self.parser = FrameParser()
        self.control_sequence = 0
        self.speaker_sequence = 0
        self.credit = 0
        self.stream_id = 1
        self.sent_bytes = 0
        self.sent_frames = 0
        self.done = False
        self.error: ProtocolError | None = None
        self.start_monotonic = time.monotonic()
        self.wire_trace = WireTrace(wire_output)
        self.latest_diagnostics: dict[str, int | str] | None = None
        output.parent.mkdir(parents=True, exist_ok=True)
        self.output_file = output.open("w", encoding="utf-8", newline="")
        self.writer = csv.DictWriter(self.output_file, fieldnames=CSV_FIELDS)
        self.writer.writeheader()

    def close(self) -> None:
        try:
            self.output_file.close()
        finally:
            try:
                self.port.close()
            finally:
                self.wire_trace.close()

    def send_control(
        self,
        control: int,
        sample_rate: int = 0,
        payload: bytes = b"",
        stream_id: int = 0,
    ) -> None:
        self._send(
            Frame(
                frame_type=TYPE_CONTROL,
                flags=control,
                stream_id=stream_id,
                sequence=self.control_sequence,
                sample_rate=sample_rate,
                payload=payload,
            )
        )
        self.control_sequence += 1

    def send_pcm(self, sample_rate: int, payload: bytes) -> None:
        self._send(
            Frame(
                frame_type=TYPE_SPEAKER_PCM,
                flags=0,
                stream_id=self.stream_id,
                sequence=self.speaker_sequence,
                sample_rate=sample_rate,
                payload=payload,
            )
        )
        self.speaker_sequence += 1
        self.credit -= len(payload)
        self.sent_bytes += len(payload)
        self.sent_frames += 1

    def _send(self, frame: Frame) -> None:
        self._send_batch([frame])

    def _send_batch(self, frames: list[Frame]) -> None:
        if not frames:
            raise ValueError("USB write batch must contain at least one frame")
        encoded = b"".join(encode_frame(frame) for frame in frames)
        queued_nanos = time.monotonic_ns()
        started_nanos = time.monotonic_ns()
        written = self.port.write(encoded)
        completed_nanos = time.monotonic_ns()
        self.wire_trace.record_write_batch(
            frames,
            queued_nanos,
            started_nanos,
            completed_nanos,
            len(encoded),
            written,
        )
        if written != len(encoded):
            raise RuntimeError(f"short USB write: {written}/{len(encoded)}")

    def send_caption_pcm_batch(
        self,
        sample_rate: int,
        caption_payloads: list[bytes],
        pcm_payloads: list[bytes],
    ) -> None:
        frames: list[Frame] = []
        for offset, payload in enumerate(caption_payloads):
            frames.append(
                Frame(
                    frame_type=TYPE_CONTROL,
                    flags=CONTROL_SPEAKER_TEXT,
                    stream_id=self.stream_id,
                    sequence=self.control_sequence + offset,
                    sample_rate=sample_rate,
                    payload=payload,
                )
            )
        for offset, payload in enumerate(pcm_payloads):
            frames.append(
                Frame(
                    frame_type=TYPE_SPEAKER_PCM,
                    flags=0,
                    stream_id=self.stream_id,
                    sequence=self.speaker_sequence + offset,
                    sample_rate=sample_rate,
                    payload=payload,
                )
            )
        self._send_batch(frames)
        self.control_sequence += len(caption_payloads)
        self.speaker_sequence += len(pcm_payloads)
        pcm_bytes = sum(len(payload) for payload in pcm_payloads)
        self.credit -= pcm_bytes
        self.sent_bytes += pcm_bytes
        self.sent_frames += len(pcm_payloads)

    def receive_frames(self) -> list[Frame]:
        waiting = self.port.in_waiting
        started_nanos = time.monotonic_ns()
        chunk = self.port.read(min(max(waiting, 1), 16384))
        completed_nanos = time.monotonic_ns()
        if not chunk:
            return []
        self.wire_trace.record_read(waiting, started_nanos, completed_nanos, len(chunk))
        frames = self.parser.push(chunk)
        for frame in frames:
            self.wire_trace.record_received_frame(frame)
        return frames

    def receive(self) -> None:
        for frame in self.receive_frames():
            self._handle_frame(frame)

    def _handle_frame(self, frame: Frame) -> None:
        if frame.frame_type == TYPE_CONTROL:
            if frame.stream_id != self.stream_id:
                return
            if frame.flags == CONTROL_SPEAKER_CREDIT:
                if len(frame.payload) != 4:
                    raise RuntimeError("invalid speaker credit")
                self.credit += struct.unpack("<I", frame.payload)[0]
            elif frame.flags == CONTROL_SPEAKER_DONE:
                self.done = True
            elif frame.flags == CONTROL_ERROR:
                code = struct.unpack("<I", frame.payload)[0] if len(frame.payload) == 4 else -1
                self.error = ProtocolError(code, frame.stream_id)
                raise self.error
            return
        if frame.frame_type != TYPE_DIAGNOSTICS:
            return
        if frame.stream_id != self.stream_id:
            return
        diagnostics = parse_diagnostics(frame.payload)
        diagnostics.update(
            {
                "host_ms": round((time.monotonic() - self.start_monotonic) * 1000, 3),
                "host_credit_bytes": self.credit,
                "host_sent_bytes": self.sent_bytes,
                "host_sent_frames": self.sent_frames,
            }
        )
        self.writer.writerow(diagnostics)
        self.output_file.flush()
        self.latest_diagnostics = diagnostics


def handshake(session: DiagnosticSession, timeout_seconds: float = 8) -> tuple[int, int]:
    deadline = time.monotonic() + timeout_seconds
    next_hello = 0.0
    while time.monotonic() < deadline:
        now = time.monotonic()
        if now >= next_hello:
            session.send_control(CONTROL_HELLO, payload=struct.pack("<II", MAX_PAYLOAD_BYTES, CAPABILITIES))
            next_hello = now + 0.5
        for frame in session.receive_frames():
            if frame.frame_type == TYPE_CONTROL and frame.flags == CONTROL_HELLO_ACK:
                if frame.stream_id != 0 or len(frame.payload) != 8:
                    raise RuntimeError("invalid HELLO_ACK")
                return struct.unpack("<II", frame.payload)
            session._handle_frame(frame)
        time.sleep(0.002)
    raise TimeoutError("Stack-chan did not return HELLO_ACK")


def replay_android_trace(session: DiagnosticSession, trace: Path, timing_scale: float, wait_seconds: float) -> None:
    writes = load_replay_writes(trace)
    speaker_start = next(write for write in writes if write.frame.flags == CONTROL_SPEAKER_START)
    session.stream_id = speaker_start.frame.stream_id
    trace_origin_us = writes[0].started_elapsed_us
    replay_origin_nanos = time.monotonic_ns()
    print(f"replay={trace} writes={len(writes)} stream={session.stream_id} timing_scale={timing_scale}")

    for write in writes:
        target_nanos = replay_origin_nanos + round(
            (write.started_elapsed_us - trace_origin_us) * timing_scale * 1_000
        )
        while time.monotonic_ns() < target_nanos:
            session.receive()
            remaining_seconds = (target_nanos - time.monotonic_ns()) / 1_000_000_000
            if remaining_seconds > 0:
                time.sleep(min(0.0005, remaining_seconds))
        session._send(write.frame)
        if write.frame.frame_type == TYPE_SPEAKER_PCM:
            session.credit -= len(write.frame.payload)
            session.sent_bytes += len(write.frame.payload)
            session.sent_frames += 1

    deadline = time.monotonic() + wait_seconds
    while not session.done and time.monotonic() < deadline:
        session.receive()
        time.sleep(0.001)
    if not session.done and session.error is None:
        session.send_control(
            CONTROL_SPEAKER_ABORT,
            sample_rate=speaker_start.frame.sample_rate,
            stream_id=session.stream_id,
        )
        print("replay reached the observation deadline without SPEAKER_DONE or ERROR")


def run(args: argparse.Namespace) -> Path:
    output = args.output
    session = DiagnosticSession(args.port, output, args.wire_log, args.control_lines == "active")
    try:
        time.sleep(0.5)
        max_payload, capabilities = handshake(session)
        print(f"max_payload={max_payload} capabilities=0x{capabilities:08x}")
        if args.handshake_only:
            return output
        if not capabilities & CAPABILITY_DIAGNOSTICS and args.replay_trace is None:
            raise RuntimeError("connected firmware does not advertise diagnostics")
        if not capabilities & CAPABILITY_STREAM_ID:
            raise RuntimeError("connected firmware does not advertise mandatory stream IDs")
        if (args.caption or args.initial_caption_count) and not capabilities & CAPABILITY_SPEAKER_TEXT:
            raise RuntimeError("connected firmware does not advertise speaker captions")
        if args.replay_trace is not None:
            replay_android_trace(session, args.replay_trace, args.timing_scale, args.replay_wait)
            print(f"wire_log={args.wire_log}")
            return output
        frame_bytes = args.sample_rate * 2 * args.frame_ms // 1000
        if frame_bytes > max_payload:
            raise ValueError(f"PCM frame ({frame_bytes} bytes) exceeds negotiated maximum ({max_payload})")
        target_frames = round(args.duration * 1000 / args.frame_ms)
        session.send_control(
            CONTROL_SPEAKER_START,
            sample_rate=args.sample_rate,
            stream_id=session.stream_id,
        )

        credit_deadline = time.monotonic() + 3
        while session.credit < frame_bytes and time.monotonic() < credit_deadline:
            session.receive()
            time.sleep(0.001)
        if session.credit < frame_bytes:
            raise TimeoutError("Stack-chan did not grant initial speaker credit")

        if args.caption:
            caption = args.caption.strip().encode("utf-8")
            if not caption:
                raise ValueError("--caption must contain non-whitespace text")
            if len(caption) > MAX_CAPTION_BYTES:
                raise ValueError(f"--caption must be at most {MAX_CAPTION_BYTES} UTF-8 bytes")
            session.send_control(
                CONTROL_SPEAKER_TEXT,
                sample_rate=args.sample_rate,
                payload=caption,
                stream_id=session.stream_id,
            )

        caption_payloads = [b"x" * args.initial_caption_bytes for _ in range(args.initial_caption_count)]
        if args.combined_initial_pcm_frames:
            initial_pcm_bytes = args.combined_initial_pcm_frames * frame_bytes
            if session.credit < initial_pcm_bytes:
                raise ValueError(
                    "--combined-initial-pcm-frames exceeds the initial speaker credit "
                    f"({initial_pcm_bytes}/{session.credit} bytes)"
                )
            pcm_payloads = [
                make_pcm_frame(
                    args.sample_rate,
                    args.frame_ms,
                    args.frequency,
                    (session.sent_frames + index) * frame_bytes // 2,
                )
                for index in range(args.combined_initial_pcm_frames)
            ]
            session.send_caption_pcm_batch(args.sample_rate, caption_payloads, pcm_payloads)
        else:
            for payload in caption_payloads:
                session.send_control(
                    CONTROL_SPEAKER_TEXT,
                    sample_rate=args.sample_rate,
                    payload=payload,
                    stream_id=session.stream_id,
                )

        stream_started = time.monotonic()
        next_paced_send = stream_started
        while session.sent_frames < target_frames:
            session.receive()
            sent = False
            now = time.monotonic()
            while session.credit >= frame_bytes and session.sent_frames < target_frames:
                if args.mode == "paced" and now < next_paced_send:
                    break
                pcm = make_pcm_frame(
                    args.sample_rate,
                    args.frame_ms,
                    args.frequency,
                    session.sent_frames * frame_bytes // 2,
                )
                session.send_pcm(args.sample_rate, pcm)
                sent = True
                if args.mode == "paced":
                    next_paced_send += args.frame_ms / 1000
                    break
            if not sent:
                time.sleep(0.001)

        session.send_control(
            CONTROL_SPEAKER_END,
            sample_rate=args.sample_rate,
            stream_id=session.stream_id,
        )
        # Credit-driven mode can finish USB transmission well before physical playback.
        done_deadline = time.monotonic() + max(10, args.duration + 5)
        while not session.done and time.monotonic() < done_deadline:
            session.receive()
            time.sleep(0.001)
        if not session.done:
            session.send_control(
                CONTROL_SPEAKER_ABORT,
                sample_rate=args.sample_rate,
                stream_id=session.stream_id,
            )
            raise TimeoutError("Stack-chan did not finish draining speaker PCM")

        diagnostics = session.latest_diagnostics
        if diagnostics is None:
            raise RuntimeError("no device diagnostics were received")
        print(f"log={output}")
        print(f"wire_log={args.wire_log}")
        print(
            "sent_bytes={sent} received_bytes={received} written_bytes={written} "
            "starvation_events={starvation} max_receive_gap_ms={receive_gap} "
            "max_writable_gap_ms={writable_gap}".format(
                sent=session.sent_bytes,
                received=diagnostics["received_bytes"],
                written=diagnostics["written_bytes"],
                starvation=diagnostics["starvation_events"],
                receive_gap=diagnostics["max_receive_gap_ms"],
                writable_gap=diagnostics["max_writable_gap_ms"],
            )
        )
        return output
    finally:
        session.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", default="/dev/ttyACM0")
    parser.add_argument("--sample-rate", type=int, choices=(8000, 16000, 24000), default=24000)
    parser.add_argument("--duration", type=float, default=15)
    parser.add_argument("--frame-ms", type=int, choices=(10, 20, 40, 80), default=80)
    parser.add_argument("--frequency", type=float, default=440)
    parser.add_argument("--caption", help="UTF-8 text to show while the following PCM is played")
    parser.add_argument(
        "--initial-caption-count",
        type=int,
        default=0,
        help="number of valid caption frames to place immediately before PCM",
    )
    parser.add_argument("--initial-caption-bytes", type=int, default=1024)
    parser.add_argument(
        "--combined-initial-pcm-frames",
        type=int,
        default=0,
        help="append this many initial PCM frames to the first combined host write",
    )
    parser.add_argument("--mode", choices=("credit-driven", "paced"), default="credit-driven")
    parser.add_argument("--replay-trace", type=Path, help="Android playback JSONL containing usb_write events")
    parser.add_argument(
        "--timing-scale",
        type=float,
        default=1.0,
        help="multiply Android write intervals by this value; zero sends every write back-to-back",
    )
    parser.add_argument("--replay-wait", type=float, default=5.0)
    parser.add_argument("--control-lines", choices=("inactive", "active"), default="active")
    parser.add_argument("--handshake-only", action="store_true")
    default_name = f"stackchan-usb-audio-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
    parser.add_argument("--output", type=Path, default=Path("dist/usb-audio-diagnostics") / default_name)
    parser.add_argument("--wire-log", type=Path)
    args = parser.parse_args()
    if args.wire_log is None:
        args.wire_log = args.output.with_suffix(".wire.jsonl")
    if args.duration <= 0:
        parser.error("--duration must be positive")
    if args.frequency <= 0 or args.frequency >= args.sample_rate / 2:
        parser.error("--frequency must be between 0 and the Nyquist frequency")
    if args.initial_caption_count not in range(17):
        parser.error("--initial-caption-count must be between 0 and 16")
    if args.initial_caption_bytes not in range(1, MAX_CAPTION_BYTES + 1):
        parser.error(f"--initial-caption-bytes must be between 1 and {MAX_CAPTION_BYTES}")
    if args.combined_initial_pcm_frames not in range(17):
        parser.error("--combined-initial-pcm-frames must be between 0 and 16")
    if args.timing_scale < 0 or args.timing_scale > 10:
        parser.error("--timing-scale must be between 0 and 10")
    if args.replay_wait <= 0 or args.replay_wait > 60:
        parser.error("--replay-wait must be between 0 and 60 seconds")
    if args.replay_trace is not None and not args.replay_trace.is_file():
        parser.error(f"--replay-trace does not exist: {args.replay_trace}")
    return args


if __name__ == "__main__":
    run(parse_args())
