# Log Schema

Stack-chan firmware telemetry is emitted as one JSON object per line, prefixed
with `@stackchan-telemetry `. The prefix lets serial logs, xsbug output, CI
logs, and local tools distinguish machine-readable records from ordinary trace
messages.

Telemetry is diagnostic data, not a public MOD API. Additive fields are allowed
within the same schema version, but existing field names and error codes should
remain stable enough for tools and issue templates to aggregate failures.

## Record Format

Each telemetry line has this shape:

```text
@stackchan-telemetry {"v":1,"seq":1,"t":1234,"mod":"tts","ev":"playback.begin"}
```

Fields:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `v` | number | yes | Schema version. Current version is `1`. |
| `seq` | number | yes | Monotonic sequence number within the emitting channel. |
| `t` | number | yes | Milliseconds since boot. |
| `mod` | string | yes | Subsystem name, such as `tts`, `mic`, or `speaker`. |
| `ev` | string | yes | Event name. Span events use `.begin`, `.end`, or `.fail`. |
| `id` | number | no | Correlation id shared by one span and its marks. |
| `dur` | number | no | Elapsed milliseconds since the span began. |
| `err` | string | no | Stable error code. Error codes start with `E_`. |
| `mem` | number | no | Free memory in bytes when a sampler is installed. |
| `data` | object | no | Event payload. Values are strings, numbers, or booleans. |

## Event Vocabulary

TTS playback:

| Event | Meaning |
| --- | --- |
| `playback.begin` | TTS playback was accepted and a playback span started. |
| `playback.audio_open` | `AudioOut` was opened for the stream. |
| `playback.first_audio` | The first ready signal arrived and playback started. |
| `playback.stall` | Playback resumed after a buffer underrun. |
| `playback.end` | Playback finished successfully. |
| `playback.fail` | Playback failed. |
| `playback.rejected` | Playback was rejected before a span could start. |

TTS query:

| Event | Meaning |
| --- | --- |
| `query.begin` | A provider-specific synthesis or query request started. |
| `query.end` | The query finished successfully. |
| `query.fail` | The query failed. |

Microphone:

| Event | Meaning |
| --- | --- |
| `record.begin` | Recording started. |
| `record.end` | Recording completed and produced a WAV buffer. |
| `record.fail` | Recording failed or was aborted. |
| `record.rejected` | Recording was rejected before a span could start. |

Speaker:

| Event | Meaning |
| --- | --- |
| `play.begin` | Borrowed-buffer playback started. |
| `play.end` | Borrowed-buffer playback completed. |
| `play.fail` | Borrowed-buffer playback failed. |
| `play.rejected` | Playback input was rejected before a span could start. |

## Error Codes

| Code | Meaning |
| --- | --- |
| `E_TTS_BUSY` | TTS playback was already active. |
| `E_TTS_HTTP` | TTS provider returned an HTTP/server error. |
| `E_TTS_NET` | TTS provider failed due to network, socket, DNS, or connection trouble. |
| `E_TTS_ABORTED` | TTS work was aborted. |
| `E_TTS_ERROR` | TTS failed for an uncategorized reason. |
| `E_MIC_BUSY` | Recording was already active. |
| `E_MIC_ABORTED` | Recording was aborted by lifecycle shutdown or stop. |
| `E_MIC_ERROR` | Recording failed for an uncategorized reason. |
| `E_SPK_FORMAT` | Speaker input buffer was not a supported WAV payload. |
| `E_SPK_ERROR` | Speaker playback failed for an uncategorized reason. |

## Payload Conventions

- Use short stable keys in `data`.
- Store durations in milliseconds and suffix those keys with `Ms`.
- Store byte counts in bytes and name those keys `bytes`.
- Store provider labels under `engine`.
- Store truncated human-readable failure details under `reason`.
- Do not put secrets, API keys, Wi-Fi passwords, or full request URLs in telemetry.
