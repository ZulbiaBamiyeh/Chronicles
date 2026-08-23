#!/usr/bin/env python3
"""Generates the app icon and splash from scratch — no external art needed.

A ghost silhouette over the same navy the shader background settles into, so
the launcher icon, the splash, and the first frame of the game all agree. Run
this, then `npx @capacitor/assets generate` to cut every density Android wants.

    python3 tools/make-icons.py
"""

from math import cos, sin, radians
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "resources"
OUT.mkdir(exist_ok=True)

SS = 4  # supersample factor; everything is drawn big and downscaled for edges

NAVY_DEEP = (7, 10, 22)
NAVY = (13, 18, 38)
VIOLET = (58, 26, 84)
BLUE = (20, 52, 108)
GOLD = (255, 207, 63)
GHOST_PALE = (232, 246, 255)
GHOST_CYAN = (139, 233, 255)


def backdrop(size, glow=True):
    """Navy, with the two colour pools the shader background drifts between."""
    img = Image.new("RGB", (size, size), NAVY_DEEP)
    d = ImageDraw.Draw(img, "RGBA")
    if glow:
        for cx, cy, r, colour, alpha in (
            (0.28, 0.22, 0.62, VIOLET, 150),
            (0.78, 0.76, 0.60, BLUE, 140),
        ):
            steps = 70
            for i in range(steps, 0, -1):
                t = i / steps
                rad = r * size * t
                d.ellipse(
                    [cx * size - rad, cy * size - rad, cx * size + rad, cy * size + rad],
                    fill=(*colour, int(alpha * (1 - t) ** 2)),
                )
    # Vignette, so the icon reads as a rounded object rather than a flat tile.
    steps = 60
    for i in range(steps):
        t = i / steps
        rad = size * (0.78 + 0.5 * t)
        d.ellipse(
            [size / 2 - rad, size / 2 - rad, size / 2 + rad, size / 2 + rad],
            outline=(0, 0, 0, 14), width=int(size * 0.02) + 1,
        )
    return img


def ghost_polygon(cx, top_y, r, height, scallops=4):
    pts = []
    for a in range(180, 361):
        pts.append((cx + r * cos(radians(a)), top_y + r * sin(radians(a))))
    bottom = top_y + height
    pts.append((cx + r, bottom))
    w = 2 * r / scallops
    for i in range(scallops):
        xm = cx + r - (i + 0.5) * w
        for a in range(0, 181):
            pts.append((xm + (w / 2) * cos(radians(a)), bottom + (w / 2) * sin(radians(a))))
    pts.append((cx - r, bottom))
    return pts


def draw_ghost(size, scale=0.62, with_glow=True):
    """The ghost on transparency, sized as a fraction of the canvas."""
    s = size * SS
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    r = s * scale * 0.42
    top_y = s * 0.46
    height = r * 0.72
    pts = ghost_polygon(s / 2, top_y, r, height)

    d.polygon(pts, fill=(*GHOST_PALE, 255))
    d.line(pts + [pts[0]], fill=(*GOLD, 255), width=int(s * 0.011), joint="curve")

    # Eyes and mouth — small and high, so they survive a 48px launcher icon.
    eye_r = r * 0.17
    for dx in (-0.36, 0.36):
        ex, ey = s / 2 + r * dx, top_y - r * 0.16
        d.ellipse([ex - eye_r, ey - eye_r * 1.2, ex + eye_r, ey + eye_r * 1.2], fill=(*NAVY_DEEP, 255))
    mouth_r = r * 0.16
    d.ellipse(
        [s / 2 - mouth_r, top_y + r * 0.26 - mouth_r, s / 2 + mouth_r, top_y + r * 0.26 + mouth_r * 1.5],
        fill=(*NAVY_DEEP, 255),
    )

    if with_glow:
        glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gd.polygon(pts, fill=(*GHOST_CYAN, 190))
        glow = glow.filter(ImageFilter.GaussianBlur(s * 0.045))
        out = Image.alpha_composite(glow, layer)
    else:
        out = layer

    return out.resize((size, size), Image.LANCZOS)


def path_dots(size, y=0.855):
    """Four gold pips under the ghost — the four path slots, in miniature."""
    s = size * SS
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    r = s * 0.028
    gap = s * 0.105
    for i in range(4):
        cx = s / 2 + (i - 1.5) * gap
        cy = y * s
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(*GOLD, 255))
    return layer.resize((size, size), Image.LANCZOS)


def save(img, name):
    path = OUT / name
    img.save(path)
    print(f"  {path.relative_to(ROOT)}  {img.size[0]}×{img.size[1]}")


print("Generating Ghostwalk art:")

# Full-bleed legacy icon.
icon = backdrop(1024).convert("RGBA")
icon.alpha_composite(draw_ghost(1024, scale=0.66))
icon.alpha_composite(path_dots(1024))
save(icon.convert("RGB"), "icon.png")

# Adaptive icon: Android crops hard, so the foreground sits inside the safe
# circle at roughly two-thirds scale and the background is plain colour.
save(backdrop(1024).convert("RGB"), "icon-background.png")
fg = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
fg.alpha_composite(draw_ghost(1024, scale=0.50))
save(fg, "icon-foreground.png")

# Splash — same ghost, much more room around it.
splash = Image.new("RGB", (2732, 2732), NAVY_DEEP)
splash.paste(backdrop(2732), (0, 0))
splash = splash.convert("RGBA")
splash.alpha_composite(draw_ghost(2732, scale=0.26))
save(splash.convert("RGB"), "splash.png")

print("Now run:  npx @capacitor/assets generate --android")
