"""Writes the George's Nappies launcher icons and splash images into the Android project.

Usage: python make_assets.py <android/app/src/main/res folder>
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

INK = (17, 17, 19, 255)
DARK = (8, 8, 9, 255)


def logo(size: int, bg: tuple | None, radius: float = 0.0, scale: float = 1.0) -> Image.Image:
    """The speech-bubble logo on a square canvas; `scale` shrinks it towards the centre."""
    S = 1024
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius), fill=bg)
    offset = S * (1 - scale) / 2
    p = lambda x, y: (x * scale + offset, y * scale + offset)
    d.rounded_rectangle([*p(200, 250), *p(824, 700)], radius=170 * scale, fill="white")
    d.polygon([p(330, 640), p(300, 830), p(470, 690)], fill="white")
    for cx in (412, 612):
        d.ellipse([*p(cx - 42, 433), *p(cx + 42, 517)], fill=INK)
    return im.resize((size, size), Image.LANCZOS)


def main(res: Path) -> None:
    for name, base in (("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)):
        folder = res / f"mipmap-{name}"
        logo(base, INK, 0.22).save(folder / "ic_launcher.png")
        logo(base, INK, 0.5).save(folder / "ic_launcher_round.png")
        logo(base * 108 // 48, None, scale=0.6).save(folder / "ic_launcher_foreground.png")
    (res / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#111113</color>\n</resources>\n',
        encoding="utf-8",
    )
    for splash in res.glob("drawable*/splash.png"):
        w, h = Image.open(splash).size
        canvas = Image.new("RGBA", (w, h), DARK)
        mark = logo(min(w, h) // 4, INK, 0.3)
        canvas.alpha_composite(mark, ((w - mark.width) // 2, (h - mark.height) // 2))
        canvas.convert("RGB").save(splash)
    print("assets written")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
