# Stack-chan Web MOD Build and Transfer Design

**Goal:** let a browser user choose or edit a Stack-chan MOD, build it into a `.xsa` archive through the web app, then transfer that archive to a real Stack-chan over Web Serial or BLE Serial without installing local CLI tools.

## Architecture

The feature is split into four explicit boundaries:

1. **Browser MOD workspace** — owns source files, target selection, validation, and status UI.
2. **Build service** — receives a constrained MOD source package, runs the Moddable `mcrun`/`mcconfig` archive build in an isolated worker, and returns a signed `.xsa` artifact plus build logs.
3. **Transfer protocol** — chunks the `.xsa` archive, frames each chunk with sequence and CRC metadata, and waits for device acknowledgements before advancing.
4. **Transport adapters** — implement the same byte-stream contract for Web Serial and BLE Serial.

The browser never gets repository secrets and never executes arbitrary Moddable toolchain binaries locally. Device transfer is intentionally a separate step from building so users can rebuild, inspect logs, and retry a transfer without re-running the build.

## Build service

The web app sends a JSON manifest and file payloads to `POST /api/mod-builds`:

- `target`: one of the allowed Stack-chan targets, initially `esp32/m5stack`, `esp32/m5stack_core2`, or `esp32/m5stack_cores3`.
- `entry`: the MOD entry file, normally `mod.js`.
- `files`: UTF-8 source files and small binary assets with path allowlisting.
- `requestedTransports`: `web-serial`, `ble-serial`, or both.

The service responds with a build job ID. The browser polls or subscribes for log events until the job finishes with:

- `artifactName`: a `.xsa` filename.
- `artifactBytes` or a time-limited download URL.
- `sha256` and `size` for UI display and transfer preflight.
- `buildLog` with the exact Moddable command and target.

## Web Serial

Web Serial is the preferred first transport for desktop Chrome/Edge:

- user gesture calls `navigator.serial.requestPort()`;
- connect at the Stack-chan MOD transfer baud rate;
- send a protocol `hello` frame and require a compatible device response;
- stream chunks with backpressure from `WritableStreamDefaultWriter.write()`;
- expose disconnect and timeout as retryable transfer failures.

## BLE Serial

BLE Serial is the phone-friendly fallback when Web Serial is unavailable:

- user gesture calls `navigator.bluetooth.requestDevice()` with the Stack-chan BLE service UUID;
- discover TX/RX characteristics;
- fragment protocol frames under the negotiated BLE payload size;
- subscribe to RX notifications for acknowledgements;
- throttle writes so BLE notification latency does not overrun the device.

## Transfer protocol

The protocol is transport-neutral and binary-safe:

1. `hello` — browser sends protocol version and artifact metadata.
2. `ready` — device reports maximum chunk size, available MOD partition bytes, and current firmware compatibility.
3. `chunk` — browser sends sequence number, byte offset, payload length, and CRC32.
4. `ack` / `nack` — device confirms the sequence or asks for a retry.
5. `commit` — browser sends final SHA-256 and archive size.
6. `done` — device confirms the archive was written and can be launched after reboot/restart.

MVP chunking should default below both UART and BLE limits; adapters may lower the payload size after `ready`.

## Security boundaries

- The build service must reject paths outside the MOD workspace, oversized archives, network access during build, and unknown target names.
- The device must validate artifact size before erase/write and validate final SHA-256 before marking the MOD active.
- The browser must show the build target, archive size, and device compatibility before the destructive transfer step.
- Web Bluetooth UUIDs and Web Serial filters are hints, not trust boundaries; the `hello`/`ready` exchange is the real compatibility check.

## MVP acceptance gates

- A sample MOD can be built by the web app into a `.xsa` artifact with visible build logs.
- The same artifact can be sent through a mocked Web Serial adapter and a mocked BLE Serial adapter with identical protocol events.
- Transfer resume/retry handles at least one dropped chunk without restarting the build.
- The UI clearly separates Build, Connect, Transfer, and Restart/Launch states.
- Failure messages preserve enough context for a user to know whether build, connection, transfer, or device validation failed.

## Branch stack

1. `design/web-mod-transfer-01-architecture` — this architecture note and design guard test.
2. `design/web-mod-transfer-02-build-contract` — browser/build-service request and result validation.
3. `design/web-mod-transfer-03-serial-transport` — Web Serial adapter contract and testable mock behavior.
4. `design/web-mod-transfer-04-ble-transport` — BLE Serial adapter contract and fragmentation behavior.
5. `design/web-mod-transfer-05-transfer-protocol` — artifact chunk protocol and retry state machine.
6. `design/web-mod-transfer-06-ui-integration` — simulator/web UI shell that wires Build → Connect → Transfer states without touching real hardware by default.
