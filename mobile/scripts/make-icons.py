"""Draw the SplitMate launcher icons and Play Store graphics from the logo geometry.

Run from mobile/:  ../server/.venv/Scripts/python scripts/make-icons.py
Outputs Android mipmaps (legacy + round + adaptive foreground) and
fastlane/metadata/android/en-US/images/{icon.png, featureGraphic.png}.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
STORE = ROOT / "fastlane" / "metadata" / "android" / "en-US" / "images"
FONT = ROOT / "android" / "app" / "src" / "main" / "assets" / "fonts" / "Manrope-ExtraBold.ttf"

SAGE = (220, 227, 209)
SAGE_DEEP = (205, 214, 192)
GOLD_A, GOLD_B = (205, 168, 110), (154, 114, 64)
FOREST = (31, 59, 45)
CREAM = (246, 247, 236)
LIME = (217, 233, 154)
SS = 4  # supersampling for smooth edges


def gradient(size, a, b):
    """Diagonal gradient from a (top-left) to b (bottom-right), built with Pillow ops (fast)."""
    w, h = size
    v = Image.linear_gradient("L").resize((w, h))
    hgrad = Image.linear_gradient("L").rotate(90).resize((w, h)).transpose(Image.FLIP_LEFT_RIGHT)
    mask = ImageChops.add(v, hgrad, scale=2.0)
    return Image.composite(Image.new("RGB", size, b), Image.new("RGB", size, a), mask)


def mark(size: int, framed: bool = False) -> Image.Image:
    """Same geometry as LogoMark in src/design/components/Wordmark.tsx (64-unit grid)."""
    s = size * SS
    u = s / 64
    m = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(m)
    w = round(6.5 * u)

    def line(x1, y1, x2, y2, width=w):
        d.line([x1 * u, y1 * u, x2 * u, y2 * u], fill=255, width=width)
        for x, y in ((x1, y1), (x2, y2)):
            r = width / 2
            d.ellipse([x * u - r, y * u - r, x * u + r, y * u + r], fill=255)

    def arc(cx, cy, r, start, end):
        d.arc([(cx - r) * u - w / 2, (cy - r) * u - w / 2, (cx + r) * u + w / 2, (cy + r) * u + w / 2], start, end, fill=255, width=w)

    # S
    line(27, 14, 18, 14)
    arc(18, 22, 8, 90, 270)
    line(18, 30, 20, 30)
    arc(20, 40, 10, 270, 450)
    line(20, 50, 10, 50)
    # C
    line(55, 14, 44, 14)
    arc(44, 22, 8, 180, 270)
    line(36, 22, 36, 42)
    arc(44, 42, 8, 90, 180)
    line(44, 50, 55, 50)
    # divider and arrow
    d.line([32 * u, 7 * u, 32 * u, 57 * u], fill=255, width=max(1, round(1.6 * u)))
    line(7, 32, 47, 32, round(4.2 * u))
    d.polygon([(45 * u, 24.5 * u), (57 * u, 32 * u), (45 * u, 39.5 * u)], fill=255)
    if framed:
        d.rounded_rectangle([2 * u, 2 * u, 62 * u, 62 * u], radius=13 * u, outline=255, width=round(2.4 * u))
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(gradient((s, s), GOLD_A, GOLD_B), (0, 0), m)
    return out.resize((size, size), Image.LANCZOS)

def tile(size: int, round_: bool = False, padding: float = 0.14, square: bool = False) -> Image.Image:
    s = size * SS
    bg = gradient((s, s), SAGE, SAGE_DEEP)
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    if square:
        md.rectangle([0, 0, s - 1, s - 1], fill=255)  # Play Store masks the icon itself
    elif round_:
        md.ellipse([0, 0, s - 1, s - 1], fill=255)
    else:
        md.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=255)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(bg, (0, 0), mask)
    m = mark(int(s * (1 - 2 * padding)), framed=True)
    out.alpha_composite(m, (int(s * padding), int(s * padding)))
    return out.resize((size, size), Image.LANCZOS)

def main() -> None:
    sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for density, px in sizes.items():
        d = RES / f"mipmap-{density}"
        d.mkdir(parents=True, exist_ok=True)
        tile(px).save(d / "ic_launcher.png")
        tile(px, round_=True).save(d / "ic_launcher_round.png")
        # Adaptive icon foreground: 108dp canvas, logo inside the 66dp safe zone.
        fg_px = int(px * 108 / 48)
        fg = Image.new("RGBA", (fg_px, fg_px), (0, 0, 0, 0))
        m = mark(int(fg_px * 0.56), framed=True)
        fg.alpha_composite(m, ((fg_px - m.width) // 2, (fg_px - m.height) // 2))
        fg.save(d / "ic_launcher_foreground.png")

    anydpi = RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/splitmate_sage"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        "</adaptive-icon>\n"
    )
    (anydpi / "ic_launcher.xml").write_text(xml, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(xml, encoding="utf-8")

    STORE.mkdir(parents=True, exist_ok=True)
    tile(512, padding=0.16, square=True).convert("RGB").save(STORE / "icon.png")

    w, h = 1024, 500
    fgraphic = Image.new("RGBA", (w, h), CREAM + (255,))
    gd = ImageDraw.Draw(fgraphic)
    gd.ellipse([700, -120, 1120, 300], fill=LIME + (255,))
    fgraphic.alpha_composite(tile(240, padding=0.12), (90, 130))
    serif = ROOT / "android" / "app" / "src" / "main" / "assets" / "fonts" / "InstrumentSerif-Regular.ttf"
    serif_i = ROOT / "android" / "app" / "src" / "main" / "assets" / "fonts" / "InstrumentSerif-Italic.ttf"
    big = ImageFont.truetype(str(serif), 120)
    big_i = ImageFont.truetype(str(serif_i), 120)
    small = ImageFont.truetype(str(FONT), 30)
    d = ImageDraw.Draw(fgraphic)
    d.text((380, 140), "Split", font=big, fill=FOREST)
    d.text((380 + d.textlength("Split", font=big), 140), "Mate", font=big_i, fill=FOREST)
    d.text((386, 300), "Split only what you shared.", font=small, fill=(93, 107, 99))
    fgraphic.convert("RGB").save(STORE / "featureGraphic.png")
    print("icons written")


if __name__ == "__main__":
    main()
