# Kasane avatar assets

These two images are cropped from the user's selected, previously generated
3-by-3 sprite sheet. They use its top-row closed-mouth and small-open-mouth
neutral portraits. No eye or expression differences are synthesized.

The source is 1254 by 1254 RGBA. Crop rectangles are (60, 4, 392, 398)
and (478, 4, 810, 398), then resized to 140 by 166 with Lanczos filtering.
Alpha is composited onto the view's #101820 background to avoid a second
alpha bitmap. Two RGB565 bitmaps require approximately 92,960 bytes plus
resource headers. Verify the final firmware remains inside its app partition.

The existing avatar model remains authoritative for speaking state, level and
direction. Playback level chooses the open mouth; non-speaking states use the
closed mouth. Blinking and happy/sad expressions remain model state but are
not represented by these two neutral assets.
