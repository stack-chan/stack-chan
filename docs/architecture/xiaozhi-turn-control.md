# XiaoZhi turn control

`ChatService` accepts `turnControl: 'halfDuplex' | 'downlink' | 'fullDuplex'`.
The default is `halfDuplex`; `fullDuplex` is reserved and throws before creating
audio resources or a Worker. This is a local policy, not a XiaoZhi wire field.
It is independent of the standard `listen.mode` setting.

```js
const peer = new ChatService({
  connection: createXiaozhiV1Connection({ endpoint, accessToken, deviceId, clientId }),
  turnControl: 'downlink',
  tools,
  callbacks,
})
peer.start()
```

The caller obtains credentials/tickets and chooses when to start, close, and
reconnect. The transport socket lives inside the Worker, alongside the Opus
decoder. Do not relay binary frames through a main-thread Promise queue.
`ChatService.supportsProtocol('xiaozhi-v1', 2)` checks for this contract.

Both XiaoZhi modes use the same audio engine. Downlink omits AudioIn, its input
buffer and capture ring, the Opus encoder, and automatic listen commands. It
stays connected after output drains. Hello, MCP results and other control
messages remain bidirectional. Other ChatAudioIO providers retain their SDK
implementation.

The optional `onOutputTurnStarted(turn)` and `onOutputTurnEnded(turn)` callbacks
are local playback hooks and may return promises. `turn.id` is local to the
connection; `turn.isCurrent()` becomes false after interruption or completion.
Use that predicate after asynchronous hardware work. A start hook gates output;
an end hook gates the following turn. Tool calls for a queued turn are held until
its start hook finishes. Keep hooks bounded and always clean up hardware when
closing the service. The engine does not send proprietary playback ACKs.

`tts.stop` marks the end of received audio, not immediate playback completion.
PCM and turn boundaries are FIFO. Output levels are computed when AudioOut
requests samples, not when packets arrive. The PCM ring bounds decoded audio;
closing output wakes a producer waiting for ring space before Worker shutdown.

The Host-owned XiaoZhi AudioIO base is derived from Moddable SDK 9.5 ChatAudioIO
and retains its LGPL notice. Native codecs and the PCM ring implementation are
provided by the Host; MODs do not need to add native code.
