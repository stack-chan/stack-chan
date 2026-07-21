#!/usr/bin/env python3
"""Send deterministic PCM to Stack-chan and record device-side AudioOut telemetry."""

from __future__ import annotations

import argparse
import binascii
import csv
import math
import struct
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

try:
    import serial
except ModuleNotFoundError:
    print(
        "pyserial is unavailable. Run this command after "
        "`source ~/.local/share/xs-dev-export.sh`.",
        file=sys.stderr,
    )
    raise


MAGIC = 0x5343
MAGIC_BYTES = b"\x43\x53"
PROTOCOL_VERSION = 2
HEADER_BYTES = 20
CRC_BYTES = 4
MAX_PAYLOAD_BYTES = 4096
MAX_CAPTION_BYTES = 1024

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


class DiagnosticSession:
    def __init__(self, port: str, output: Path, control_lines_active: bool = False) -> None:
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
        self.start_monotonic = time.monotonic()
        self.latest_diagnostics: dict[str, int | str] | None = None
        output.parent.mkdir(parents=True, exist_ok=True)
        self.output_file = output.open("w", encoding="utf-8", newline="")
        self.writer = csv.DictWriter(self.output_file, fieldnames=CSV_FIELDS)
        self.writer.writeheader()

    def close(self) -> None:
        self.output_file.close()
        self.port.close()

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
        encoded = encode_frame(frame)
        written = self.port.write(encoded)
        if written != len(encoded):
            raise RuntimeError(f"short USB write: {written}/{len(encoded)}")

    def receive(self) -> None:
        waiting = self.port.in_waiting
        chunk = self.port.read(min(max(waiting, 1), 16384))
        if not chunk:
            return
        for frame in self.parser.push(chunk):
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
                raise RuntimeError(f"Stack-chan returned protocol error {code}")
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
        waiting = session.port.in_waiting
        chunk = session.port.read(min(max(waiting, 1), 16384))
        for frame in session.parser.push(chunk):
            if frame.frame_type == TYPE_CONTROL and frame.flags == CONTROL_HELLO_ACK:
                if frame.stream_id != 0 or len(frame.payload) != 8:
                    raise RuntimeError("invalid HELLO_ACK")
                return struct.unpack("<II", frame.payload)
            session._handle_frame(frame)
        time.sleep(0.002)
    raise TimeoutError("Stack-chan did not return HELLO_ACK")


def run(args: argparse.Namespace) -> Path:
    output = args.output
    session = DiagnosticSession(args.port, output, args.control_lines == "active")
    try:
        time.sleep(0.5)
        max_payload, capabilities = handshake(session)
        print(f"max_payload={max_payload} capabilities=0x{capabilities:08x}")
        if args.handshake_only:
            return output
        if not capabilities & CAPABILITY_DIAGNOSTICS:
            raise RuntimeError("connected firmware does not advertise diagnostics")
        if not capabilities & CAPABILITY_STREAM_ID:
            raise RuntimeError("connected firmware does not advertise mandatory stream IDs")
        if args.caption and not capabilities & CAPABILITY_SPEAKER_TEXT:
            raise RuntimeError("connected firmware does not advertise speaker captions")
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
        # Burst mode can finish USB transmission well before physical playback.
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
    parser.add_argument("--mode", choices=("burst", "paced"), default="burst")
    parser.add_argument("--control-lines", choices=("inactive", "active"), default="active")
    parser.add_argument("--handshake-only", action="store_true")
    default_name = f"stackchan-usb-audio-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"
    parser.add_argument("--output", type=Path, default=Path("dist/usb-audio-diagnostics") / default_name)
    args = parser.parse_args()
    if args.duration <= 0:
        parser.error("--duration must be positive")
    if args.frequency <= 0 or args.frequency >= args.sample_rate / 2:
        parser.error("--frequency must be between 0 and the Nyquist frequency")
    return args


if __name__ == "__main__":
    run(parse_args())
