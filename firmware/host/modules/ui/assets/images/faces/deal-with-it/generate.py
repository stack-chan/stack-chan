"""Self-drawn meme-inspired pixel art. Requires Pillow: python generate.py."""
from pathlib import Path
from PIL import Image

# Logical 48x12 grid: stepped black frame and two parallel white reflections.
image = Image.new("RGBA", (48, 12), (0, 0, 0, 0))
spans = [(0, 48), (0, 48), (2, 22, 26, 46), (2, 22, 26, 46),
         (3, 22, 26, 45), (4, 21, 27, 44), (4, 21, 27, 44),
         (5, 20, 28, 43), (5, 20, 28, 43), (6, 19, 29, 42),
         (7, 18, 30, 41), (8, 17, 31, 40)]
for y, row in enumerate(spans):
    for start, end in zip(row[::2], row[1::2]):
        for x in range(start, end):
            image.putpixel((x, y), (0, 0, 0, 255))
for offset in (0, 24):
    for y in range(3, 7):
        for x in (y + 4, y + 5, y + 8, y + 9):
            image.putpixel((x + offset, y), (255, 255, 255, 255))
image.resize((144, 36), Image.Resampling.NEAREST).save(
    Path(__file__).with_name("deal-with-it-eyes.png"))
