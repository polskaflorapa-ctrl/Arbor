"""Build Expo icon assets from the approved Polska Flora logo artwork.

The script never redraws the mark. It only crops transparent margins, scales the
approved PNG proportionally and places it on brand-colour canvases.
"""

from pathlib import Path

from PIL import Image


MOBILE_ROOT = Path(__file__).resolve().parents[1]
BRAND_ROOT = MOBILE_ROOT / "assets" / "brand"
OUT_DIR = BRAND_ROOT / "app-icons"
APPROVED_VERTICAL = (
    BRAND_ROOT
    / "logos"
    / "without-descriptor"
    / "png"
    / "vertical-dark.png"
)

DARK_BROWN = (59, 42, 24, 255)
PRIMARY_GREEN = (160, 175, 20, 255)


def contain(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    copy = image.copy()
    copy.thumbnail(size, Image.Resampling.LANCZOS)
    return copy


def centered(canvas: Image.Image, image: Image.Image) -> None:
    x = (canvas.width - image.width) // 2
    y = (canvas.height - image.height) // 2
    canvas.alpha_composite(image, (x, y))


def active_row_ranges(alpha: Image.Image) -> list[tuple[int, int]]:
    active = [
        alpha.crop((0, row, alpha.width, row + 1)).getbbox() is not None
        for row in range(alpha.height)
    ]
    ranges: list[tuple[int, int]] = []
    start: int | None = None
    for index, enabled in enumerate([*active, False]):
        if enabled and start is None:
            start = index
        elif not enabled and start is not None:
            ranges.append((start, index))
            start = None
    return ranges


def approved_symbol(image: Image.Image) -> Image.Image:
    """Crop the symbol above the wordmark from the approved vertical lock-up."""

    alpha = image.getchannel("A")
    ranges = active_row_ranges(alpha)
    if not ranges:
        raise RuntimeError("Approved logo has no visible pixels")

    # The vertical lock-up is symbol first, followed by one or two wordmark rows.
    # Keep the first contiguous artwork block and then crop transparent columns.
    symbol_end = ranges[0][1]
    symbol = image.crop((0, ranges[0][0], image.width, symbol_end))
    bbox = symbol.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("Approved logo symbol is empty")
    return symbol.crop(bbox)


def solid_mark(symbol: Image.Image, size: tuple[int, int]) -> Image.Image:
    scaled = contain(symbol, size)
    alpha = scaled.getchannel("A")
    mark = Image.new("RGBA", scaled.size, (255, 255, 255, 0))
    mark.paste((255, 255, 255, 255), (0, 0, scaled.width, scaled.height), alpha)
    return mark


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    vertical = Image.open(APPROVED_VERTICAL).convert("RGBA")
    symbol = approved_symbol(vertical)

    app_icon = Image.new("RGBA", (1024, 1024), DARK_BROWN)
    centered(app_icon, contain(vertical, (660, 790)))
    app_icon.convert("RGB").save(OUT_DIR / "app-icon.png", optimize=True)

    adaptive_background = Image.new("RGBA", (512, 512), DARK_BROWN)
    adaptive_background.save(OUT_DIR / "adaptive-background.png", optimize=True)

    adaptive_foreground = Image.new("RGBA", (512, 512), (255, 255, 255, 0))
    centered(adaptive_foreground, contain(symbol, (286, 320)))
    adaptive_foreground.save(OUT_DIR / "adaptive-foreground.png", optimize=True)

    monochrome = Image.new("RGBA", (432, 432), (255, 255, 255, 0))
    centered(monochrome, solid_mark(symbol, (238, 270)))
    monochrome.save(OUT_DIR / "adaptive-monochrome.png", optimize=True)

    notification = Image.new("RGBA", (96, 96), (255, 255, 255, 0))
    centered(notification, solid_mark(symbol, (54, 62)))
    notification.save(OUT_DIR / "notification-icon.png", optimize=True)

    favicon = Image.new("RGBA", (64, 64), DARK_BROWN)
    centered(favicon, contain(symbol, (38, 44)))
    favicon.save(OUT_DIR / "favicon.png", optimize=True)


if __name__ == "__main__":
    main()
