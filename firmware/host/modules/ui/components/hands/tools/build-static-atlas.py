#!/usr/bin/env python3
"""Normalize an image-generated hand sheet into two themeable mask atlases."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


STATE_COUNT = 5
DIRECTION_COUNT = 8
CELL_SIZE = 88
TARGET_EXTENT = 76
MIRRORED_DIRECTION = (0, 7, 6, 5, 4, 3, 2, 1)
# The first four rows came from one generation and side-open from another. Keep
# their source-scale normalization independent even though they now live in one
# five-row authoring sheet.
SOURCE_SCALE_GROUPS = ((0, 4), (4, 5))


def find_components(
    alpha: Image.Image, row_count: int, threshold: int = 32
) -> list[tuple[int, int, int, int]]:
    width, height = alpha.size
    foreground = bytearray(alpha.point(lambda value: 255 if value >= threshold else 0).tobytes())
    visited = bytearray(width * height)
    components: list[tuple[int, tuple[int, int, int, int]]] = []

    for start in range(width * height):
        if not foreground[start] or visited[start]:
            continue

        queue: deque[int] = deque([start])
        visited[start] = 1
        minimum_x = maximum_x = start % width
        minimum_y = maximum_y = start // width
        area = 0

        while queue:
            current = queue.popleft()
            y, x = divmod(current, width)
            area += 1
            minimum_x = min(minimum_x, x)
            maximum_x = max(maximum_x, x)
            minimum_y = min(minimum_y, y)
            maximum_y = max(maximum_y, y)

            for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if next_x < 0 or next_x >= width or next_y < 0 or next_y >= height:
                    continue
                neighbor = next_y * width + next_x
                if foreground[neighbor] and not visited[neighbor]:
                    visited[neighbor] = 1
                    queue.append(neighbor)

        if area >= 1000:
            components.append((area, (minimum_x, minimum_y, maximum_x + 1, maximum_y + 1)))

    expected_count = row_count * DIRECTION_COUNT
    if len(components) != expected_count:
        raise ValueError(f"expected {expected_count} hand components, found {len(components)}")

    # Rows are far enough apart that grouping the sorted centers into sets of eight is stable.
    components.sort(key=lambda component: (component[1][1] + component[1][3]) / 2)
    ordered: list[tuple[int, int, int, int]] = []
    for row in range(row_count):
        row_components = components[row * DIRECTION_COUNT : (row + 1) * DIRECTION_COUNT]
        row_components.sort(key=lambda component: (component[1][0] + component[1][2]) / 2)
        ordered.extend(bounds for _, bounds in row_components)
    return ordered


def create_masks(source: Image.Image, bounds: tuple[int, int, int, int]) -> tuple[Image.Image, Image.Image]:
    sprite = source.crop(bounds)
    red, green, blue, alpha = sprite.split()

    # The generated art uses a dark outline and an almost-white interior. The minimum RGB
    # channel separates those colors while retaining a soft transition at the inner edge.
    whiteness = ImageChops.darker(ImageChops.darker(red, green), blue)
    whiteness = whiteness.point(lambda value: max(0, min(255, round((value - 48) * 255 / 200))))
    inner = ImageChops.multiply(alpha, whiteness)
    return alpha, inner


def normalize(mask: Image.Image, scale: float) -> Image.Image:
    width = max(1, round(mask.width * scale))
    height = max(1, round(mask.height * scale))
    resized = mask.resize((width, height), Image.Resampling.LANCZOS)
    cell = Image.new("L", (CELL_SIZE, CELL_SIZE), 0)
    cell.paste(resized, ((CELL_SIZE - width) // 2, (CELL_SIZE - height) // 2))
    return cell


def put_alpha(atlas: Image.Image, sprite: Image.Image, column: int, row: int) -> None:
    atlas.paste(sprite, (column * CELL_SIZE, row * CELL_SIZE))


def save_alpha_texture(alpha: Image.Image, path: Path) -> None:
    texture = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    texture.putalpha(alpha)
    texture.save(path, optimize=True)


def save_preview(outer: Image.Image, inner: Image.Image, path: Path) -> None:
    preview = Image.new("RGBA", outer.size, (231, 235, 241, 255))
    primary = Image.new("RGBA", outer.size, (17, 24, 39, 0))
    primary.putalpha(outer)
    secondary = Image.new("RGBA", inner.size, (255, 255, 255, 0))
    secondary.putalpha(inner)
    preview.alpha_composite(primary)
    preview.alpha_composite(secondary)

    draw = ImageDraw.Draw(preview)
    for coordinate in range(0, preview.width + 1, CELL_SIZE):
        draw.line((coordinate, 0, coordinate, preview.height), fill=(175, 181, 192, 128), width=1)
    for coordinate in range(0, preview.height + 1, CELL_SIZE):
        draw.line((0, coordinate, preview.width, coordinate), fill=(175, 181, 192, 128), width=1)
    preview.convert("RGB").save(path, optimize=True)


def extract_state_rows(source_path: Path) -> tuple[list[list[Image.Image]], list[list[Image.Image]]]:
    source = Image.open(source_path).convert("RGBA")
    bounds = find_components(source.getchannel("A"), STATE_COUNT)
    scales = [0.0] * STATE_COUNT
    for first_state, state_limit in SOURCE_SCALE_GROUPS:
        group_bounds = bounds[
            first_state * DIRECTION_COUNT : state_limit * DIRECTION_COUNT
        ]
        maximum_extent = max(
            max(right - left, bottom - top) for left, top, right, bottom in group_bounds
        )
        for state in range(first_state, state_limit):
            scales[state] = TARGET_EXTENT / maximum_extent

    outer_rows: list[list[Image.Image]] = [[] for _ in range(STATE_COUNT)]
    inner_rows: list[list[Image.Image]] = [[] for _ in range(STATE_COUNT)]
    for index, sprite_bounds in enumerate(bounds):
        outer, inner = create_masks(source, sprite_bounds)
        row = index // DIRECTION_COUNT
        outer_rows[row].append(normalize(outer, scales[row]))
        inner_rows[row].append(normalize(inner, scales[row]))
    return outer_rows, inner_rows


def build(source_path: Path, output_directory: Path) -> None:
    right_outer, right_inner = extract_state_rows(source_path)

    atlas_width = CELL_SIZE * DIRECTION_COUNT
    atlas_height = CELL_SIZE * STATE_COUNT * 2
    outer_atlas = Image.new("L", (atlas_width, atlas_height), 0)
    inner_atlas = Image.new("L", (atlas_width, atlas_height), 0)

    for state in range(STATE_COUNT):
        for direction in range(DIRECTION_COUNT):
            put_alpha(outer_atlas, right_outer[state][direction], direction, state)
            put_alpha(inner_atlas, right_inner[state][direction], direction, state)

            source_direction = MIRRORED_DIRECTION[direction]
            left_outer = right_outer[state][source_direction].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            left_inner = right_inner[state][source_direction].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            put_alpha(outer_atlas, left_outer, direction, STATE_COUNT + state)
            put_alpha(inner_atlas, left_inner, direction, STATE_COUNT + state)

    # Keep the secondary layer strictly inside the primary silhouette after resampling.
    inner_atlas = ImageChops.darker(inner_atlas, outer_atlas)
    output_directory.mkdir(parents=True, exist_ok=True)
    save_alpha_texture(outer_atlas, output_directory / "hands-outer-mask.png")
    save_alpha_texture(inner_atlas, output_directory / "hands-inner-mask.png")
    save_preview(outer_atlas, inner_atlas, output_directory / "hands-preview.png")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="RGBA sheet containing five rows and eight columns")
    parser.add_argument("output_directory", type=Path)
    arguments = parser.parse_args()
    build(arguments.source, arguments.output_directory)


if __name__ == "__main__":
    main()
