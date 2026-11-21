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

"""Realtime voice calls: muse_voice_call_core.c (JSON scanner, base64, append
framing, audio decode, lifecycle, half-duplex gate) checked against CPython's
json, base64 and datetime, and the production muse_voice_call.cpp run against
host fakes of FreeRTOS and the session's streams. Every fixture is synthetic:
tones and silence generated here, placeholder ids, and event shapes from the
public field names only."""

import base64
import datetime
import email.utils
import json
import math
import os
import random
import shlex
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MUSE = ROOT / 'components/muse'
TESTS = ROOT / 'tests'
FAKES = TESTS / 'voice_call_fakes'
JSON_SRC = Path(os.environ.get('CJSON_SOURCE_DIR', ROOT / 'managed_components/espressif__cjson/cJSON'))
SANITIZE = ['-O1', '-g', '-fsanitize=address,undefined', '-fno-omit-frame-pointer']
WARN = ['-Wall', '-Wextra', '-Werror']
ENV = {**os.environ,
       # Fill every allocation (not just its first 4 KB) so state read before
       # it's set up shows as garbage rather than zeros.
       'ASAN_OPTIONS': 'detect_leaks=0:abort_on_error=1:max_malloc_fill_size=1048576',
       'UBSAN_OPTIONS': 'halt_on_error=1:print_stacktrace=1'}
CC = shlex.split(os.environ.get('CC', 'cc'))
CXX = shlex.split(os.environ.get('CXX', 'c++'))


def build(commands):
    for command in commands:
        result = subprocess.run(command, capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(' '.join(map(str, command)) + '\n' + result.stdout + result.stderr)


def resample(samples, in_rate, out_rate):
    """The firmware's Q16 linear resampler, as a reference (step rounded up)."""
    step = -((-in_rate << 16) // out_rate)
    pos, prev, out = 0, 0, []
    n = len(samples)
    while (pos >> 16) < n:
        i = pos >> 16
        a = samples[i - 1] if i else prev
        b = samples[i]
        out.append(max(-32768, min(32767, a + (((b - a) * (pos & 0xffff)) >> 16))))
        pos += step
    return out


def tone(n, rate, hz=440.0, amplitude=8000.0, phase=0.0):
    return [int(round(amplitude * math.sin(phase + 2 * math.pi * hz * i / rate))) for i in range(n)]


def pcm_bytes(samples):
    return struct.pack('<%dh' % len(samples), *samples)


def rfc3339(value):
    assert value.endswith('Z') and len(value) == 24, value
    return datetime.datetime.strptime(value, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=datetime.timezone.utc)


def random_json(rng, depth=0):
    kind = rng.randrange(7 if depth < 5 else 4)
    if kind == 0:
        return rng.choice([True, False, None])
    if kind == 1:
        return rng.choice([0, -1, 3.25, 1e-7, 123456789012, -0.5])
    if kind in (2, 3):
        return ''.join(rng.choice('ab"\\/\n\t\u00e9\u2019\U0001f600{}[]:, ') for _ in range(rng.randrange(8)))
    if kind == 4:
        return [random_json(rng, depth + 1) for _ in range(rng.randrange(4))]
    return {''.join(rng.choice('abc_.') for _ in range(rng.randrange(1, 5))): random_json(rng, depth + 1)
            for _ in range(rng.randrange(4))}


class VoiceCallCore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.out = Path(cls.tmp.name)
        cls.binary = cls.out / 'core'
        build([[*CC, '-std=c11', *SANITIZE, *WARN, '-I', str(MUSE),
                str(TESTS / 'muse_voice_call_core_harness.c'), str(MUSE / 'muse_voice_call_core.c'),
                '-lm', '-o', str(cls.binary)]])

    def run_raw(self, *args, data=b''):
        result = subprocess.run([str(self.binary), *map(str, args)], input=data, capture_output=True, env=ENV)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        return result.stdout

    def run_mode(self, *args, data=b''):
        result = subprocess.run([str(self.binary), *map(str, args)], input=data, capture_output=True, env=ENV)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
        return result.stdout.decode()

    def test_lifecycle_gate_and_line_bounds(self):
        self.assertEqual(self.run_mode('unit').strip(), 'ok')

    def test_scanner_agrees_with_python_on_validity(self):
        rng = random.Random(7)
        docs = [json.dumps(random_json(rng), ensure_ascii=rng.random() < 0.5) for _ in range(400)]
        bad = ['', '{', '}', '{"a":}', '{"a":1,}', '[1,]', '{"a" 1}', '{a:1}', '"\\x"', '"\\u12"', '01', '1.',
               '-', '1e', 'tru', 'nul', '{"a":1}}', '[[[[', '"\x01"', '{"a":"b"', '{}{}', '{"a":[1,2}',
               '[' * 40 + ']' * 40]
        lines = docs + bad
        got = self.run_mode('valid', data='\n'.join(lines).encode() + b'\n').split()
        for line, flag in zip(lines, got):
            try:
                json.loads(line)
                expected = '1'
            except ValueError:
                expected = '0'
            if line.startswith('[' * 40):
                expected = '0'   # deeper than MUSE_VC_JSON_DEPTH: refused, bounded
            self.assertEqual(flag, expected, line)

    def test_keys_only_match_their_own_path(self):
        frames = base64.b64encode(b'\x01\x00\x02\x00').decode()
        cases = [
            ({'type': 't', 'audio_delta': {'audio_frames': frames}}, 'string ' + frames.encode().hex()),
            # The key's text inside another string, escaped, is not a key.
            ({'type': 't', 'note': '{"audio_delta":{"audio_frames":"AAAA"}}'}, 'none '),
            ({'type': 't', 'k': 'audio_delta.audio_frames'}, 'none '),
            # Nor is the same key under another object, or in an array.
            ({'type': 't', 'other': {'audio_frames': frames}}, 'none '),
            ({'type': 't', 'audio_delta': [{'audio_frames': frames}]}, 'none '),
            ({'type': 't', 'audio_delta': {'inner': {'audio_frames': frames}}}, 'none '),
            ({'type': 't', 'audio_delta': {'audio_frames': 7}}, 'number 7'),
            ({'audio_delta': {'format': {'type': ''}, 'num_frames': 1, 'audio_frames': frames}, 'type': 't'},
             'string ' + frames.encode().hex()),
        ]
        lines = '\n'.join(json.dumps(doc) for doc, _ in cases) + '\n'
        got = self.run_mode('get', 'audio_delta.audio_frames', data=lines.encode()).splitlines()
        for (doc, expected), line in zip(cases, got):
            self.assertEqual(line, expected, doc)

    def test_unescape_matches_python_and_truncates_whole_characters(self):
        rng = random.Random(3)
        texts = [''.join(rng.choice('az"\\/\b\f\n\r\t\u00e9\u2019\U0001f600') for _ in range(rng.randrange(30)))
                 for _ in range(200)]
        raws = [json.dumps(t, ensure_ascii=rng.random() < 0.5)[1:-1] for t in texts]
        got = self.run_mode('unescape', 4096, data='\n'.join(raws).encode() + b'\n').splitlines()
        for text, line in zip(texts, got):
            self.assertEqual(bytes.fromhex(line).decode(), text)
        # A small cap never ends inside a character.
        got = self.run_mode('unescape', 6, data=b'ab\\u00e9\\u00e9\nabc\xe2\x80\x99d\n\\ud83d\\ude00x\n\\q\n').splitlines()
        self.assertEqual(got, ['ab\u00e9'.encode().hex(), b'abc'.hex(), '\U0001f600x'.encode().hex(), '!bad'])

    def test_base64_is_strict(self):
        rng = random.Random(5)
        blobs = [rng.randbytes(rng.randrange(0, 40)) for _ in range(200)]
        good = [base64.b64encode(b).decode() for b in blobs]
        got = self.run_mode('b64', data='\n'.join(good).encode() + b'\n').splitlines()
        for blob, line in zip(blobs, got):
            self.assertEqual(line, blob.hex())
        bad = ['A', 'AB', 'ABC', 'AB=A', '=AAA', 'A===', 'AAAA=', 'AA-A', 'AA A', 'AAA=AAAA', 'AA\\nA']
        self.assertEqual(self.run_mode('b64', data='\n'.join(bad).encode() + b'\n').split(), ['-1'] * len(bad))
        # A JSON "\/" escape is a slash.
        self.assertEqual(self.run_mode('b64', data=b'\\/w==\n').strip(), base64.b64decode('/w==').hex())

    def test_mic_becomes_paced_40ms_appends_of_24khz(self):
        mic = tone(16000, 16000, hz=300.0, amplitude=12000.0)
        expected = resample(mic, 16000, 24000)
        frames = len(expected) // 960
        for piece in (1, 320, 333, 4096):
            out = self.run_mode('uplink', piece, data=pcm_bytes(mic))
            lines = out.splitlines()
            self.assertEqual(len(lines), frames)
            audio = b''
            for line in lines:
                event = json.loads(line)
                self.assertEqual(set(event), {'type', 'audio'})
                self.assertEqual(event['type'], 'input_audio_buffer.append')
                chunk = base64.b64decode(event['audio'], validate=True)
                self.assertEqual(len(chunk), 1920)   # 960 samples, PCM16LE
                audio += chunk
            got = list(struct.unpack('<%dh' % (len(audio) // 2), audio))
            self.assertEqual(got, expected[:frames * 960], piece)

    def test_downlink_audio_and_events(self):
        rng = random.Random(11)
        phase = 0.0
        sent = []
        lines = []
        for i in range(25):
            amplitude = 9000.0 if i < 20 else 0.0
            samples = tone(960, 24000, amplitude=amplitude, phase=phase)
            phase += 2 * math.pi * 440.0 * 960 / 24000
            sent += samples
            frames = base64.b64encode(pcm_bytes(samples)).decode()
            self.assertEqual(len(frames), 2560)
            delta = {'audio_frames': frames, 'format': {'rate': 24000, 'type': ''}, 'num_channels': 1,
                     'num_frames': 1}
            event = {'type': 'continuous_audio_video.delta', 'audio_delta': delta, 'timestamp_ms': i * 40,
                     'response_id': 'resp_0', 'future_field': {'x': [1, 2]}}
            if i % 3:
                event['event_id'] = 'evt_%d' % i   # sometimes absent
            items = list(event.items())
            rng.shuffle(items)   # key order doesn't matter
            lines.append(json.dumps(dict(items)))
        legacy = tone(480, 24000, amplitude=5000.0)
        lines += [
            json.dumps({'type': 'response.output_audio.delta', 'event_id': 'e', 'delta':
                        base64.b64encode(pcm_bytes(legacy)).decode()}),
            json.dumps({'type': 'continuous_audio_video.delta', 'audio_delta': {
                'audio_frames': base64.b64encode(pcm_bytes(legacy)).decode(), 'format': {'rate': 16000}}}),
            json.dumps({'type': 'continuous_audio_video.delta', 'audio_delta': {'audio_frames': 'AA=='}}),
            json.dumps({'type': 'continuous_audio_video.delta', 'audio_delta': {'audio_frames': 'not base64!'}}),
            json.dumps({'type': 'continuous_audio_video.delta', 'video_delta': {'frames': 'AAAA'}}),
            json.dumps({'type': 'hatch.voice.session', 'call_id': 'c', 'session_id': 's-1', 'thread_id': 't'}),
            json.dumps({'type': 'input_audio_buffer.speech_started', 'event_id': 'e', 'item_id': 'i'}),
            json.dumps({'type': 'response.done', 'event_id': 'e', 'response': {'status': 'cancelled'}}),
            json.dumps({'type': 'hatch.voice.switch_input_hold', 'event_id': 'e', 'held': True}),
            json.dumps({'type': 'hatch.voice.switch_input_hold', 'event_id': 'e', 'held': 'yes'}),
            json.dumps({'type': 'response.output_audio_transcript.delta', 'delta': 'Hi \u2019there\u2019'}),
            json.dumps({'type': 'conversation.item.input_audio_transcription.completed', 'transcript': 'weather'}),
            json.dumps({'type': 'conversation.item.added', 'item': {
                'id': 'item_1', 'type': 'session_control', 'role': 'assistant', 'status': 'completed',
                'call_id': 'control-1', 'name': 'stop', 'arguments': '{}'}}),
            json.dumps({'type': 'conversation.item.added', 'item': {'type': 'device_action', 'name': 'stop'}}),
            json.dumps({'type': 'conversation.item.added', 'item': {'type': 'message', 'content': [
                {'type': 'session_control', 'name': 'stop'}]}}),
            json.dumps({'type': 'error', 'error': {'type': 'backend_unavailable', 'message': 'm'}}),
            json.dumps({'type': 'brand.new_event', 'payload': {'audio_delta': {'audio_frames': 'AAAA'}}}),
            '{"type":"continuous_audio_video.delta","audio_delta":{"audio_frames":"' + 'A' * 40000 + '"}}',
            '[1,2,3]',
            '{"no_type":1}',
            '{"type":"truncated',
        ]
        stream = ('\r\n'.join(lines) + '\n').encode()
        expected_events = ['audio'] * 25 + [
            'audio', 'audio', 'audio', 'audio', 'other', 'session s-1', 'speech_started', 'response_done cancelled',
            'hold 1', 'other', 'reply_text Hi \u2019there\u2019', 'user_text weather', 'stop', 'other', 'other',
            'error m', 'other', 'invalid', 'invalid', 'invalid', 'skipped 1']
        for seed in (1, 2, 3):
            pcm_path = self.out / ('down%d.pcm' % seed)
            got = self.run_mode('down', seed, pcm_path, data=stream).splitlines()
            kinds = [' '.join(g.split()[:1] + g.split()[3:]) if g.startswith('audio') else g for g in got]
            self.assertEqual([k.split(' ')[0] if k.startswith('audio') else k for k in kinds], expected_events)
            audio = [g.split() for g in got if g.startswith('audio')]
            self.assertEqual([a[1:] for a in audio[:25]], [['640', 'audible']] * 20 + [['640', 'silent']] * 5)
            self.assertEqual(audio[25][2], 'audible')   # the legacy delta
            self.assertEqual(audio[26][1:], ['-2', 'bad'])   # 16 kHz: not ours
            self.assertEqual(audio[27][1:], ['-1', 'bad'])   # an odd byte count
            self.assertEqual(audio[28][1:], ['-1', 'bad'])
            raw = pcm_path.read_bytes()
            got_pcm = list(struct.unpack('<%dh' % (len(raw) // 2), raw))
            self.assertEqual(got_pcm, resample(sent + legacy, 24000, 16000))

    def test_resampler_takes_any_block_size_within_its_bound(self):
        # Blocks past 65536 samples once wrapped the 32-bit Q16 position, and a
        # rounded-down step let 16->24 kHz outgrow n*out/in + 2 over long blocks.
        rng = random.Random(13)
        for in_rate, out_rate in ((16000, 24000), (24000, 16000), (16000, 16000), (44100, 16000)):
            n = 200000
            pcm = [rng.randrange(-32768, 32768) for _ in range(n)]
            expected = resample(pcm, in_rate, out_rate)
            self.assertLessEqual(len(expected), n * out_rate // in_rate + 2)
            for piece in (0, 65535, 65536, 65537, 131072, 320, 333):
                out = self.run_raw('resample', in_rate, out_rate, piece, data=pcm_bytes(pcm))
                got = list(struct.unpack('<%dh' % (len(out) // 2), out))
                self.assertEqual(got, expected, (in_rate, out_rate, piece))

    def test_admission_record(self):
        call_id = '0f0e0d0c-0b0a-4908-8706-050403020100'
        record = self.run_mode('admission', call_id, 'homelink-00a1b2', 1)
        self.assertTrue(record.endswith('\n') and record.count('\n') == 1)
        self.assertEqual(json.loads(record), {
            'type': 'hatch.voice.call.start', 'call_id': call_id, 'call_media_type': 'audio',
            'device': 'mcu-wearable', 'device_id': 'homelink-00a1b2', 'proactive_greeting_enabled': True})
        self.assertEqual(json.loads(self.run_mode('admission', call_id, '', 0)), {
            'type': 'hatch.voice.call.start', 'call_id': call_id, 'call_media_type': 'audio',
            'device': 'mcu-wearable', 'proactive_greeting_enabled': False})
        self.assertEqual(json.loads(self.run_mode('admission', 'a"b', 'x\\y', 0))['device_id'], 'x\\y')

    def test_end_call_body(self):
        wall = 1791527758123
        body = json.loads(self.run_mode('endcall', 'call-1', 'thread-1', wall, 61500))
        self.assertEqual(set(body), {'call_id', 'call_started_at', 'call_ended_at', 'thread_id'})
        self.assertEqual((body['call_id'], body['thread_id']), ('call-1', 'thread-1'))
        started, ended = rfc3339(body['call_started_at']), rfc3339(body['call_ended_at'])
        self.assertEqual(ended, datetime.datetime.fromtimestamp(wall / 1000, datetime.timezone.utc))
        self.assertEqual(ended - started, datetime.timedelta(milliseconds=61500))
        # Ended within the same millisecond: still after the start; no thread, no field.
        body = json.loads(self.run_mode('endcall', 'call-2', '', wall, 0))
        self.assertNotIn('thread_id', body)
        self.assertEqual(rfc3339(body['call_ended_at']) - rfc3339(body['call_started_at']),
                         datetime.timedelta(milliseconds=1))

    def test_time_helpers(self):
        rng = random.Random(9)
        stamps = [0, 951782400000, 1791527758123] + [rng.randrange(0, 4102444800000) for _ in range(300)]
        got = self.run_mode('time', data=''.join('ms %d\n' % s for s in stamps).encode()).split()
        for ms, text in zip(stamps, got):
            self.assertEqual(rfc3339(text), datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc))
        dates = [email.utils.formatdate(s / 1000, usegmt=True) for s in stamps[:100]]
        bad = ['Fri, 9 Oct 2026 06:35:58 GMT', 'Fri, 09 Oct 2026 06:35:58 UTC', 'Fri, 09 Foo 2026 06:35:58 GMT',
               'Fri, 09 Oct 2026 24:35:58 GMT', 'Friday, 09-Oct-26 06:35:58 GMT', '']
        got = self.run_mode('time', data=''.join('date %s\n' % d for d in dates + bad).encode()).split('\n')
        for date, ms in zip(dates, got):
            self.assertEqual(int(ms), int(email.utils.parsedate_to_datetime(date).timestamp()) * 1000)
        self.assertEqual(got[len(dates):len(dates) + len(bad)], ['-1'] * len(bad))


class VoiceCallSession(unittest.TestCase):
    """The production muse_voice_call.cpp between a fake voice task and a fake session."""

    CASES = ['happy', 'barge_in', 'hold', 'rejected', 'dropped_before_head', 'post_head_error', 'connection_lost',
             'send_fails', 'no_answer', 'idle', 'stop', 'remote_end', 'generations', 'unreachable',
             'hang_up_before_start', 'long_line', 'backpressure', 'end_call_unconfirmed', 'hold_race',
             'long_speech', 'pre_ready_identity', 'mute_partial', 'cleanup_before_new_call',
             'cleanup_stale_answer', 'cleanup_bounded', 'cleanup_expires', 'cleanup_gate_inflight',
             'cleanup_4xx_then_lost', 'ptt_startup', 'ptt_overflow', 'ptt_press_during_reply',
             'ptt_silent_press', 'ptt_rapid_edges', 'ptt_edges_while_opening', 'ptt_disconnect',
             'ptt_end_and_generations', 'ptt_waiting', 'ptt_server_hold', 'ptt_gate_capacity',
             'ptt_gate_latest_item', 'ptt_gate_follow_up', 'ptt_stale_completion', 'ptt_hold_clock_gap', 'ptt_abandoned_start',
             'ptt_quiet_after_early_audio', 'ptt_cutover', 'ptt_many_edges_while_connecting',
             'ptt_bad_turn_identity', 'ptt_playing_while_waiting', 'ptt_captions', 'ptt_end_while_held_reply',
             'ptt_end_mid_pump', 'ptt_stop_drains_deferred', 'ptt_stop_discards_ineligible',
             'ptt_stop_paced_ack_only', 'ptt_stop_paced_ack_eof', 'ptt_stop_paced_eof_ack', 'ptt_stop_paced_output_only',
             'ptt_stop_no_progress_deadline', 'ptt_stop_paced_interrupts', 'hands_free_working',
             'hands_free_interrupted_settle', 'hands_free_early_media_and_keep_cap']

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        out = Path(cls.tmp.name)
        inc = ['-I', str(FAKES), '-I', str(TESTS), '-I', str(MUSE)]
        cls.binary = out / 'call'
        build([
            [*CC, '-std=c11', *SANITIZE, *WARN, *inc, '-c', str(MUSE / 'muse_voice_call_core.c'), '-o',
             str(out / 'core.o')],
            [*CXX, '-std=gnu++17', *SANITIZE, *WARN, *inc, '-include', str(TESTS / 'host_compat.h'),
             '-include', str(FAKES / 'wall_clock.h'), '-c',
             str(MUSE / 'muse_voice_call.cpp'), '-o', str(out / 'call.o')],
            [*CXX, '-std=gnu++17', *SANITIZE, *WARN, *inc, '-c', str(TESTS / 'muse_voice_call_harness.cpp'), '-o',
             str(out / 'harness.o')],
            [*CXX, *SANITIZE, str(out / 'core.o'), str(out / 'call.o'), str(out / 'harness.o'), '-lm', '-o',
             str(cls.binary)],
        ])

    def run_case(self, name):
        result = subprocess.run([str(self.binary), str(self.CASES.index(name))], capture_output=True, text=True,
                                env=ENV)
        self.assertEqual(result.returncode, 0, result.stdout[-4000:] + result.stderr[-4000:])
        return [json.loads(line) for line in result.stdout.splitlines()]

    def check_end_call(self, ops, call_id):
        ends = [o for o in ops if o['op'] == 'end_call']
        self.assertEqual(len(ends), 1)
        self.assertEqual(ends[0]['path'], '/voice/end-call')
        self.assertTrue(ends[0]['end'])
        body = json.loads(ends[0]['body'])
        self.assertEqual(body['call_id'], call_id)
        self.assertLess(rfc3339(body['call_started_at']), rfc3339(body['call_ended_at']))
        return ends[0], body

    def test_ptt_held_audio_waits_for_the_call_and_only_it_goes_up(self):
        ops = self.run_case('ptt_startup')
        media = ops[0]
        self.assertEqual(media['op'], 'media')
        appends = [o for o in ops if o['op'] == 'send' and 'input_audio_buffer.append' in o['body']]
        bodies = {json.loads(o['body'])['type'] for o in ops if o['op'] == 'send' and o['body']}
        self.assertEqual(bodies, {'input_audio_buffer.append'})   # no commit, clear or response.create
        self.assertGreater(len(appends), 70)

    def test_ptt_start_buffer_overflow_is_reported_not_silent(self):
        self.run_case('ptt_overflow')

    def test_ptt_press_stops_the_reply_for_good(self):
        self.run_case('ptt_press_during_reply')

    def test_ptt_silent_press_never_resumes_the_old_reply(self):
        self.run_case('ptt_silent_press')

    def test_ptt_rapid_edges(self):
        self.run_case('ptt_rapid_edges')

    def test_ptt_edges_while_the_call_opens(self):
        self.run_case('ptt_edges_while_opening')

    def test_ptt_disconnect_replays_nothing_and_cleans_up(self):
        self.run_case('ptt_disconnect')

    def test_ptt_end_and_generations(self):
        self.run_case('ptt_end_and_generations')

    def test_ptt_reply_waiting_for_its_turn(self):
        self.run_case('ptt_waiting')

    def test_ptt_server_hold_and_hands_free_status(self):
        self.run_case('ptt_server_hold')

    def test_ptt_old_ids_stay_stale_and_a_full_table_ends_the_call(self):
        self.run_case('ptt_gate_capacity')

    def test_ptt_only_the_latest_items_turn_opens_a_reply(self):
        self.run_case('ptt_gate_latest_item')

    def test_ptt_older_work_reports_back_after_the_current_reply(self):
        self.run_case('ptt_gate_follow_up')

    def test_hands_free_shows_working_while_muse_is_on_it(self):
        self.run_case('hands_free_working')

    def test_an_interrupted_reply_settling_late_keeps_the_new_turn_unanswered(self):
        self.run_case('hands_free_interrupted_settle')

    def test_early_media_answers_its_turn_and_a_lost_reply_keeps_it_once(self):
        self.run_case('hands_free_early_media_and_keep_cap')

    def test_ptt_reply_done_is_the_current_replys_own(self):
        self.run_case('ptt_stale_completion')

    def test_ptt_quiet_does_not_catch_up_after_a_gap(self):
        self.run_case('ptt_hold_clock_gap')

    def test_ptt_start_replaced_before_the_session_takes_it(self):
        self.run_case('ptt_abandoned_start')

    def test_ptt_quiet_follows_early_held_audio_at_once(self):
        self.run_case('ptt_quiet_after_early_audio')

    def test_ptt_old_call_never_takes_the_new_calls_audio(self):
        self.run_case('ptt_cutover')

    def test_ptt_many_edges_while_connecting_last_wins(self):
        self.run_case('ptt_many_edges_while_connecting')

    def test_ptt_bad_turn_identity_plays_nothing(self):
        self.run_case('ptt_bad_turn_identity')

    def test_ptt_newest_reply_takes_over_and_press_cancels(self):
        self.run_case('ptt_playing_while_waiting')

    def test_ptt_reply_captions_follow_the_gate(self):
        self.run_case('ptt_captions')

    def test_ptt_end_while_a_reply_waits_plays_nothing(self):
        self.run_case('ptt_end_while_held_reply')

    def test_ptt_hang_up_mid_pump_stops_the_mic_at_once(self):
        self.run_case('ptt_end_mid_pump')

    def test_ptt_server_stop_drains_confirmed_deferred_reply(self):
        self.run_case('ptt_stop_drains_deferred')

    def test_ptt_server_stop_never_promotes_ineligible_reply(self):
        self.run_case('ptt_stop_discards_ineligible')

    def test_ptt_stop_paces_deferred_reply_after_ack(self):
        self.run_case('ptt_stop_paced_ack_only')

    def test_ptt_stop_paces_reply_after_ack_then_media_eof(self):
        self.run_case('ptt_stop_paced_ack_eof')

    def test_ptt_stop_paces_reply_after_media_eof_then_ack(self):
        self.run_case('ptt_stop_paced_eof_ack')

    def test_ptt_stop_paces_output_only_reply_longer_than_consumer_tail(self):
        self.run_case('ptt_stop_paced_output_only')

    def test_ptt_stop_without_playback_progress_ends_at_existing_deadline(self):
        self.run_case('ptt_stop_no_progress_deadline')

    def test_ptt_stop_queued_playback_keeps_all_interruption_fences(self):
        self.run_case('ptt_stop_paced_interrupts')

    def test_ptt_first_start_on_a_filled_heap(self):
        # A fresh process whose first act is a push-to-talk start: the reply
        # gate is read at that press, before any call has begun.
        self.run_case('ptt_startup')

    def test_happy_path_and_hang_up(self):
        ops = self.run_case('happy')
        media = ops[0]
        self.assertEqual(media['op'], 'media')
        self.assertTrue(media['path'].startswith('/voice/realtime?call_id='))
        call_id = media['path'].split('=', 1)[1]
        self.assertFalse(media['end'])   # the body stays open
        # The admission record, then the capability offer: end_call_stop.
        self.assertTrue(media['body'].endswith('\n') and media['body'].count('\n') == 2)
        first, offer = media['body'].splitlines()
        self.assertEqual(json.loads(offer), {'type': 'hatch.voice.capability.offer', 'end_call_stop': 1})
        record = json.loads(first)
        self.assertEqual(record['call_id'], call_id)
        self.assertEqual((record['type'], record['device'], record['device_id']),
                         ('hatch.voice.call.start', 'mcu-wearable', 'homelink-00a1b2'))
        appends = [o for o in ops if o['op'] == 'send' and o['body']]
        self.assertEqual(len(appends), 25)
        for op in appends:
            self.assertEqual(op['id'], media['id'])
            event = json.loads(op['body'])
            self.assertEqual(event['type'], 'input_audio_buffer.append')
            self.assertEqual(len(base64.b64decode(event['audio'], validate=True)), 1920)
        end, body = self.check_end_call(ops, call_id)
        self.assertEqual(body['thread_id'], '00000000-0000-4000-8000-000000000002')
        # The call's start comes from the response's Date header (no clock on the gadget).
        self.assertEqual(rfc3339(body['call_started_at']).date(), datetime.date(2026, 10, 9))
        # End-call first, then the half-close (an empty, final body chunk), then nothing.
        half = ops.index(end) + 1
        self.assertEqual(ops[half], {**ops[half], 'op': 'send', 'id': media['id'], 'end': True, 'body': ''})
        self.assertEqual(len(ops), half + 1)

    def test_session_control_stop_hangs_up_gracefully(self):
        ops = self.run_case('stop')
        call_id = ops[0]['path'].split('=', 1)[1]
        end, _ = self.check_end_call(ops, call_id)
        self.assertNotIn('reset', [o['op'] for o in ops])
        self.assertEqual(ops[ops.index(end) + 1]['end'], True)

    def test_rejection_still_sends_end_call(self):
        ops = self.run_case('rejected')
        self.check_end_call(ops, ops[0]['path'].split('=', 1)[1])

    def test_barge_in_flush_is_fenced(self):
        self.run_case('barge_in')

    def test_switch_input_hold(self):
        self.run_case('hold')

    def test_stream_dropped_before_head_leaves_no_call(self):
        self.run_case('dropped_before_head')

    def test_error_before_session(self):
        self.run_case('post_head_error')

    def test_lost_call_is_ended_on_the_next_connection(self):
        ops = self.run_case('connection_lost')
        call_id = ops[0]['path'].split('=', 1)[1]
        end, body = self.check_end_call(ops, call_id)
        self.assertEqual(body['thread_id'], '00000000-0000-4000-8000-000000000002')
        self.assertEqual([o['op'] for o in ops].count('media'), 1)   # nothing of the call replayed

    def test_new_call_waits_for_the_old_end_call(self):
        self.run_case('cleanup_before_new_call')

    def test_late_old_answer_leaves_the_new_call_alone(self):
        self.run_case('cleanup_stale_answer')

    def test_cleanup_tries_are_bounded(self):
        self.run_case('cleanup_bounded')

    def test_cleanup_expires(self):
        self.run_case('cleanup_expires')

    def test_start_during_background_try_waits_for_that_try_only(self):
        self.run_case('cleanup_gate_inflight')

    def test_refused_end_call_isnt_kept_when_the_connection_drops(self):
        self.run_case('cleanup_4xx_then_lost')

    def test_send_failure(self):
        self.run_case('send_fails')

    def test_no_answer_deadlines(self):
        self.run_case('no_answer')

    def test_idle_ignores_keepalive_silence(self):
        self.run_case('idle')

    def test_server_ends_media(self):
        self.run_case('remote_end')

    def test_generations_fence_calls(self):
        self.run_case('generations')

    def test_unreachable(self):
        self.run_case('unreachable')

    def test_hang_up_before_start(self):
        self.run_case('hang_up_before_start')

    def test_long_line(self):
        self.run_case('long_line')

    def test_backpressure_takes_a_whole_frame(self):
        self.run_case('backpressure')

    def test_unconfirmed_end_call_drops_the_connection(self):
        self.run_case('end_call_unconfirmed')

    def test_hold_released_before_poll_uploads_nothing_held(self):
        self.run_case('hold_race')

    def test_long_speech_is_not_idle(self):
        self.run_case('long_speech')

    def test_nothing_plays_or_uploads_before_exact_readiness(self):
        self.run_case('pre_ready_identity')

    def test_hang_up_drops_a_partial_append(self):
        self.run_case('mute_partial')


class VoicePeCallLoop(unittest.TestCase):
    """main/voice.c's call loop against board, player and call fakes: the mute
    switch stops captured audio before it's handed on, and no caller text is logged."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls.tmp.cleanup)
        cls.binary = Path(cls.tmp.name) / 'voice_pe'
        build([[*CC, '-std=gnu11', *SANITIZE, *WARN, '-Wno-unused-function', '-Wno-unused-parameter',
                '-Wno-unused-variable', '-I', str(FAKES / 'voice_pe'), '-I', str(FAKES), '-I', str(JSON_SRC),
                '-I', str(TESTS), '-I', str(ROOT / 'main'), '-I', str(MUSE),
                str(TESTS / 'voice_pe_call_harness.c'), str(MUSE / 'muse_voice_call_core.c'),
                str(JSON_SRC / 'cJSON.c'), '-lm', '-o', str(cls.binary)]])

    def run_case(self, case):
        result = subprocess.run([str(self.binary), str(case)], capture_output=True, text=True, env=ENV)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_mute_during_capture_drops_that_chunk(self):
        self.run_case(0)

    def test_mute_between_captures_drops_the_next(self):
        self.run_case(1)


class VoiceCallWiring(unittest.TestCase):
    """muse_chat_session.cpp compiles with calls on and off, and with them off
    it neither names an app ID nor calls into the call."""

    def compile_session(self, calls, *extra):
        inc = ['-I', str(FAKES / 'session'), '-I', str(FAKES), '-I', str(JSON_SRC), '-I', str(TESTS / 'link_fakes'),
               '-I', str(TESTS), '-I', str(MUSE), '-I', str(ROOT / 'components/noise_core/include'),
               '-I', str(ROOT / 'components/minimp3/include')]
        command = [*CXX, '-std=gnu++17', *WARN, *([] if calls else ['-DMUSE_TEST_CALLS_OFF']), *inc,
                   '-include', str(TESTS / 'host_compat.h'), *extra, str(MUSE / 'muse_chat_session.cpp')]
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr[-4000:])
        return result.stdout

    def test_session_compiles_with_calls_on(self):
        self.compile_session(True, '-fsyntax-only')

    def test_calls_off_leaves_the_session_as_it_was(self):
        self.compile_session(False, '-fsyntax-only')
        source = self.compile_session(False, '-E', '-P')
        body = source[source.index('static const char *TAG = "muse_chat_session"'):]
        self.assertNotIn('app_id', body)
        self.assertNotIn('muse_voice_call', body)
        self.assertNotIn('muse_session_call', body)

    def test_reply_handler_slices_stay_free_of_calls(self):
        # test_muse_chat_session.py compiles these ranges of the file on their own.
        source = (MUSE / 'muse_chat_session.cpp').read_text()
        for start, end in (('#define MIC_RATE', '/* ---- Voice task'), ('enum phase_t', '/* 10 KB'),
                           ('static int find_msg(', 'static void on_chat_ack('),
                           ('static bool turn_start(', 'static void turn_begin(')):
            piece = source[source.index(start):source.index(end)]
            self.assertNotIn('CALL', piece.upper().replace('CALLBACK', ''))


if __name__ == '__main__':
    unittest.main()
