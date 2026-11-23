# Guruguru + Muse voice (opt-in)

The face/touch view is shared with `guruguru_voice`; that existing cascaded MOD is unchanged. This MOD requires a host exporting `muse-voice` from the opt-in Muse voice manifest and the standard `stackchan/voice` runtime. It does not install native support into an existing host.

Before the first call, provision the existing `muse` preference domain with `host`, `vmId`, `token` (owner WsBearer), `appId`, and stable `nodeId`. Missing keys prevent startup. The MOD reads these values locally, never prints them, and does not implement pairing or token issuance. Do not put credentials in this source or commit them.

- Hold A to start the call and speak after admission. Release A to mute capture.
- B explicitly closes the call, attempting remote end-call and bounded playback drain.
- Unloading closes the call and restores the previous button handlers and face.
- Touch the face's nine regions to change gaze/head direction.

Provider turn settlement and playback completion are different. The mouth follows actual `output.level` events even if provider work has already settled. A settled turn is not evidence that all audio has played.

Build from `firmware` using `npm run mod:build -- mods/examples/guruguru_muse/manifest.json --mode=release`. This does not add native modules to the host. Node mock tests cover button gating, missing settings, teardown and avatar events; they do not establish live Muse service, pairing, microphone or speaker interoperability.

Behavior reference: [M5GuruguruAvatar](https://github.com/nananauno/M5GuruguruAvatar), MIT. The view is an independently implemented placeholder, not a copy of the original image assets.
