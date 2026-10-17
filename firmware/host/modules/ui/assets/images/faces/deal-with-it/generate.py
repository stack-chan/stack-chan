"""Original pixel design from the requested features; requires Pillow."""
from pathlib import Path
from PIL import Image, ImageFilter

# Independent 30x6 design. One logical pixel is a 6x6 screen rectangle.
# This generator takes no reference image input, sampled pixels or traced rows.
width, height, scale, border = 30, 6, 6, 2
image = Image.new("RGBA", (width, height))
for x in range(width):
    image.putpixel((x, 0), (0, 0, 0, 255))
# Shallow, stepped lenses joined only by the flat upper bar.
for y in range(1, height):
    inset = y - 1
    for start, end in ((inset, 14 - max(0, y - 2)),
                       (16 + max(0, y - 2), width - inset)):
        for x in range(start, end):
            image.putpixel((x, y), (0, 0, 0, 255))
# Each lens: parallel WHITE / BLACK / WHITE diagonals, each one cell wide.
for lens_offset in (0, 15):
    for y in range(1, 5):
        for stripe in (0, 2):
            image.putpixel((lens_offset + 3 + y + stripe, y), (255, 255, 255, 255))
image = image.resize((width * scale, height * scale), Image.Resampling.NEAREST)
padded = Image.new("RGBA", (image.width + 2 * border, image.height + 2 * border))
padded.paste(image, (border, border))
# The outer contour is separate from the internal reflection cells.
outline = padded.getchannel("A").filter(ImageFilter.MaxFilter(2 * border + 1))
result = Image.new("RGBA", padded.size, "white")
result.putalpha(outline)
result.alpha_composite(padded)
result.save(Path(__file__).with_name("deal-with-it-eyes.png"))
