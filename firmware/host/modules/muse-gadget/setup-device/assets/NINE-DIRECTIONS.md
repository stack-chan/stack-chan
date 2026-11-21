# Guruguru nine-direction avatar

The user-provided generated character sheet is the identity reference. The new
closed-mouth and talking sheets were created with the built-in image generator
on 2026-11-16. Every cell changes head orientation, not only eye direction.

Direction indices are row-major: up-left, up, up-right, left, front, right,
down-left, down, down-right (viewer coordinates).

The frame workflow follows [tomari-guruguru](https://github.com/rotejin/tomari-guruguru):
direction-indexed images and separate closed/open-mouth states. Its standard
5×5, six-expression browser format is reduced here to the requested 3×3 and
two-mouth-state embedded format. Its Python slicer is not used unchanged: the
generated grid is 3×3 and fullscreen cropping must preserve the same coordinates
between closed/open sheets, rather than recentering their separate alpha bounds.

Each neutral frame is prerendered to 466×466 RGB on #101820 and compiled to the
SDK's ColorCell compressed image format at quality 40. Quality 100 exceeds the
format's 64 KiB per-frame limit; quality 40 uses 36–39 KiB per frame. This fits the existing
OTA partition without changing the partition table. The device performs no
scaling. Hair fills the display and the circular screen may clip the corners.
Each talking frame contributes only a 38×30 mouth patch at the coordinates in
`kasane-frames.js`. Patch edges blend into the original neutral skin to avoid a
visible rectangular seam. At 4 fps, mouth animation redraws that region only. Direction
changes redraw a whole frame. No volume callback drives the animation.

Connected captions occupy the lower display strip, below the mouth rectangle
in every direction. The regression test checks that relationship and keeps the
caption corners inside the circular display's safe area. A dark backing keeps
text readable over the hoodie without covering the eyes. Connected captions are
limited to two measured lines, with `...` for omitted text, inside a clipping
container. There is no scrolling timer competing with audio playback.

The source sheets, deterministic PowerShell preparation script and review montage
are preserved in the worktree's `avatar-source` directory. Existing avatar assets
are retained so the previous appearance can be restored.

Blinking uses nine closed-eye patches from an alignment-preserving edit of the
neutral sheet. Each patch bounds both eyes; only its
rectangle is invalidated. Non-speaking states wait 3–5 seconds, close the eyes
for 120 ms, then reopen. Speech opens the eyes immediately and suspends blinking,
leaving only the existing 4 fps mouth timer. One Piu timer serves both modes and
stops when the view is hidden or closed. Only two feathered lens-area masks are opaque;
surrounding hair and cheeks stay transparent. This avoids seams against the
ColorCell-compressed background.
