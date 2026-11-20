# AI HTTPS trust anchors

The AI manifest selects SDK certificate files explicitly instead of bundling the
entire SDK trust store. With Moddable 10.1.0, it includes:

| Resource | Root | SDK subject key identifier |
| --- | --- | --- |
| `ca233.der` | GTS Root R1 | `E4AF2B26711A2B4827852F52662CEFF08913713E` |
| `ca236.der` | GTS Root R4 | `804CD6EB74FF4936A3D5D8FCB53EC56AF0941D8C` |

The SDK's [OpenAI TTS example](https://github.com/Moddable-OpenSource/moddable/blob/10.1.0/examples/pins/audioout/openai-stream/manifest_openaistreamer.json)
selects `ca236`. Its [ChatAudioIO manifest](https://github.com/Moddable-OpenSource/moddable/blob/10.1.0/modules/network/services/chatAudioIO/manifest.json)
includes both GTS roots for a set of providers that includes OpenAI and Gemini.
These are source-level selection evidence, not a live TLS test of this module's
three default API endpoints (`api.openai.com`, `api.anthropic.com`, and
`generativelanguage.googleapis.com`). In particular, Anthropic's current chain
has not been validated with this selection.

The existing audio and ChatAudioIO manifests retain their certificate selections.
The CoreS3 WebRTC manifest is unchanged. `ca.ski` is still supplied by the SDK TLS
manifest; the certificate filenames and index entries must remain paired. No
certificate-validation or hostname-validation settings are changed.

## Other HTTPS endpoints and certificate rotation

An endpoint override does not automatically add trust anchors. For a custom
endpoint, verify its certificate chain and explicitly add the required public CA
to the firmware build manifest. For example, an SDK root is included using:

```json
{
  "data": {
    "*": ["$(MODDABLE)/modules/crypt/data/ca233"]
  }
}
```

Choose the root from evidence for the actual endpoint, not this example's number.
For roots outside the SDK index, provide the CA through a supported explicit TLS
certificate option rather than inventing a `caN` index. The AI transport does not
currently expose such an option. Rebuild and validate TLS for the selected
endpoint; never disable verification to accommodate an untrusted chain.

Root selections require maintenance. [Google's guidance](https://pki.goog/faq/)
states that service certificate chains can change and recommends an updatable
trust store. The two roots above are not a guarantee of compatibility with every
Google or OpenAI-compatible endpoint or future certificate rotation.

## Verification limits for this change

Manifest-rule and generated certificate-archive checks preserve the existing
M5Stack roots and `ca.ski`; Node tests, architecture checks, and Biome pass.
Live provider-chain checks and on-device TLS have not been completed. The
M5Stack firmware must also pass the real release-size check before this change
is considered verified for release.
