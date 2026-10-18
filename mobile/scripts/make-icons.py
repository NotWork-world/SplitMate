"""Draw the SplitMate launcher icons and Play Store graphics from the logo geometry.

Run from mobile/:  ../server/.venv/Scripts/python scripts/make-icons.py
Outputs Android mipmaps (legacy + round + adaptive foreground) and
fastlane/metadata/android/en-US/images/{icon.png, featureGraphic.png}.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
STORE = ROOT / "fastlane" / "metadata" / "android" / "en-US" / "images"
FONT = ROOT / "android" / "app" / "src" / "main" / "assets" / "fonts" / "Manrope-ExtraBold.ttf"

MIDNIGHT = (11, 15, 31)
INDIGO = (20, 26, 51)
VIOLET_A, VIOLET_B = (148, 121, 255), (79, 70, 229)
CORAL_A, CORAL_B = (255, 148, 111), (255, 94, 138)
SS = 4  # supersampling for smooth edges


def gradient(size, a, b):
    w, h = size
    g = Image.new("RGB", size)
    px = g.load()
    for y in range(h):
        for x in range(w):
            t = (x + y) / (w + h - 2)
            px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))
    return g


def mark(size: int) -> Image.Image:
    """The plate split in two: violet half (left), coral half (right), white dot."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    u = s / 64  # logo viewBox is 64x64

    def half(box, start, end, colors):
        m = Image.new("L", (s, s), 0)
        ImageDraw.Draw(m).pieslice(box, start, end, fill=255)
        img.paste(gradient((s, s), *colors), (0, 0), m)

    half([4 * u, 6 * u, 56 * u, 58 * u], 90, 270, (VIOLET_A, VIOLET_B))  # left half of r=26 at (30,32)
    half([14 * u, 10 * u, 58 * u, 54 * u], 270, 90, (CORAL_A, CORAL_B))  # right half of r=22 at (36,32)
    d = ImageDraw.Draw(img)
    d.ellipse([16 * u, 26 * u, 28 * u, 38 * u], fill=(255, 255, 255, 235))
    return img.resize((size, size), Image.LANCZOS)


def tile(size: int, round_: bool = False, padding: float = 0.17, square: bool = False) -> Image.Image:
    s = size * SS
    bg = gradient((s, s), INDIGO, MIDNIGHT)
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
    m = mark(int(s * (1 - 2 * padding)))
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
        m = mark(int(fg_px * 0.5))
        fg.alpha_composite(m, ((fg_px - m.width) // 2, (fg_px - m.height) // 2))
        fg.save(d / "ic_launcher_foreground.png")

    anydpi = RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/splitmate_midnight"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '    <monochrome android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        "</adaptive-icon>\n"
    )
    (anydpi / "ic_launcher.xml").write_text(xml, encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(xml, encoding="utf-8")

    STORE.mkdir(parents=True, exist_ok=True)
    tile(512, padding=0.16, square=True).convert("RGB").save(STORE / "icon.png")

    w, h = 1024, 500
    fgraphic = gradient((w, h), INDIGO, MIDNIGHT).convert("RGBA")
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for r in range(260, 0, -4):
        a = int(70 * (1 - r / 260))
        gd.ellipse([820 - r, 120 - r, 820 + r, 120 + r], fill=(124, 92, 255, a))
    fgraphic.alpha_composite(glow)
    fgraphic.alpha_composite(mark(220), (90, 140))
    d = ImageDraw.Draw(fgraphic)
    big = ImageFont.truetype(str(FONT), 92)
    small = ImageFont.truetype(str(FONT), 34)
    d.text((350, 160), "Split", font=big, fill=(244, 242, 255))
    split_w = d.textlength("Split", font=big)
    d.text((350 + split_w, 160), "Mate", font=big, fill=CORAL_A)
    d.text((354, 290), "Split only what you shared.", font=small, fill=(196, 181, 253))
    fgraphic.convert("RGB").save(STORE / "featureGraphic.png")
    print("icons written")


if __name__ == "__main__":
    main()
