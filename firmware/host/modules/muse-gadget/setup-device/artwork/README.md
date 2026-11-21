# StopWatch expression artwork

The four PNG sheets were generated with the built-in image generation tool from
the existing nine-direction Kasane character sheet. Each sheet is 1254 × 1254.
Rows look up, forward, and down; columns look left, forward, and right.

- `nine-happy.png`: open eyes and a closed cheerful smile.
- `nine-sad.png`: open eyes, concerned eyebrows, and a closed downturned mouth.
- `nine-*-animation.png`: the matching expression with closed eyes and an open
  speaking mouth. The device draws the eye and mouth regions independently.

Generation preserved the character, glasses, clothing, head angles, and grid.
The expression prompts requested a gentle smile or a sympathetic concerned face,
not tears. Animation prompts requested a natural blink and a small speaking
mouth, with the rest of the reference unchanged.

From `firmware`, rebuild device PNGs and atlas coordinates with:

```powershell
powershell -NoProfile -File scripts/prepare-kasane-expressions.ps1
```

Pass `-PreviewDirectory <path>` to inspect composited animation frames. The
extractor uses the same 338-pixel face crop and 466-pixel device size as the
neutral sprites. The generator composites each feathered eye or mouth patch
onto its own unchanged base crop and saves an opaque PNG. This preserves the
composited pixels before ColorCell compression and avoids storing a full raw
RGB565 plus alpha bitmap for each expression patch. Eye and mouth patches use
separate pristine base crops because their bounding rectangles can overlap.

`view.model.setExpression('neutral' | 'happy' | 'sad')` selects the artwork.
The caller chooses the expression; this renderer does not infer emotion from
text. Change it once at a response boundary, not for every streamed token.
Blinking and speech continue using their existing timings. Facial animation
patches are not amplitude-driven lip sync.

`response-expression.js` provides the conversation adapter. Muse currently
provides complete assistant text but no expression hint. The adapter examines
up to 512 characters of the first nonempty assistant message per turn. Clear
celebration or gratitude cues select `happy`; sympathy or apology cues select
`sad`; other text stays `neutral`. Common Japanese negations are excluded.
This is a local wording heuristic, not an emotion classifier: quotations,
irony, mixed topics, and more complex negations can be misread. It does not
rewrite the answer or add an API request. Turn end, errors, and session end
restore `neutral`.

Full faces and the happy/sad animation patches use ColorCell resources. Neutral
animation retains its existing texture format. ColorCell recompresses each
patch separately, so edge appearance, device heap peaks, and transition latency
still require on-device visual testing.

## Device validation

The connected StopWatch uses an OTA application slot at `0x20000` of size
`0x4f0000`; the build's larger factory partition does not apply to that device.
Always check the final binary against the actual slot before an app-only flash.
The packed integration binary is 4,604,624 bytes, leaving 572,720 bytes.

The offline device diagnostic exercised neutral, happy, sad, and neutral again,
with all nine directions and both animation patches, then completed three
synthetic PCM conversation turns without an API request or microphone capture.
Internal free RAM changed from 238,175 to 238,131 bytes; its low-water mark was
205,824 bytes. PSRAM free remained 7,983,044 bytes across the expression sweeps.
These numbers characterize this short diagnostic, not long-running heap usage
or live provider traffic. Physical inspection of compressed patch boundaries
and perceived transition smoothness remains necessary.