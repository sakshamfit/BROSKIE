#!/usr/bin/env python3
"""
Generate the 友達 brand pack (app icon + splash screens) in the "Graphite &
Pulp" style: warm paper, India ink, one highlighter-yellow accent.

Outputs (see ./median/README.md for how to use them in Median App Studio):
  median/icon-1024.png                 app icon (also Android 12 splash icon)
  median/splash-android-1080x1920.png  Android splash (full-screen upload)
  median/splash-ios-1170x2532.png      iPhone 13/14/15
  median/splash-ios-1242x2688.png      iPhone 12-14 Pro Max
  median/splash-ios-1290x2796.png      iPhone 15 Pro Max
  median/splash-ipad-2048x2732.png     iPad (portrait)

And mirrors the same artwork into app/assets + app/public so the Expo /
PWA / EAS builds share one identity.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', 'app'))

PAPER = (253, 248, 248, 255)          # #fdf8f8 warm pulp
INK = (28, 27, 27, 255)               # #1c1b1b India ink
HIGHLIGHTER = (255, 226, 77, 255)     # #FFE24D felt-tip yellow

CJK_FONT = '/tmp/NotoSansCJKsc-Bold.otf'
MONO_FONT = os.path.join(
    APP, 'node_modules/@expo-google-fonts/jetbrains-mono/500Medium/JetBrainsMono_500Medium.ttf')

random.seed(7)  # deterministic "hand-drawn" wobble


def load(font_path, size):
    return ImageFont.truetype(font_path, size)


def text_width(draw, text, font):
    b = draw.textbbox((0, 0), text, font=font)
    return b[2] - b[0]


def hand_circle(canvas, center, radius, width, color):
    """A slightly irregular ink ring — ellipse rotated a touch, drawn twice
    with slightly different wobble so it reads as a quick pen stroke that
    doesn't quite close."""
    W, H = canvas.size
    cx, cy = center
    side = radius * 4
    layer = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    mid = side // 2
    for _ in range(2):
        wob = random.uniform(0.97, 1.03)
        lw = max(2, int(width * random.uniform(0.9, 1.1)))
        ld.ellipse(
            [mid - radius * wob, mid - radius * wob,
             mid + radius * wob, mid + radius * wob],
            outline=color, width=lw)
    layer = layer.rotate(random.uniform(-2.5, 2.5), center=(mid, mid),
                         resample=Image.BICUBIC)
    canvas.alpha_composite(layer, (cx - mid, cy - mid))


def highlighter_stroke(canvas, cx, cy, w, h, color, rotate=-2):
    """A rotated rounded-rectangle scribble — the one vivid accent."""
    layer = Image.new('RGBA', (int(w * 2), int(h * 2)), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rounded_rectangle(
        [w * 0.25, h * 0.25, w * 1.75, h * 1.75],
        radius=h * 0.9, fill=color)
    layer = layer.rotate(rotate, center=(w, h), resample=Image.BICUBIC)
    canvas.alpha_composite(layer, (cx - w, cy - h))


def draw_brand(canvas, font_scale=0.28, ring=True, tagline=False,
               underline=True, mono_size=None, bg=PAPER):
    """Compose the brand mark centered on `canvas` (PIL RGBA image)."""
    W, H = canvas.size
    draw = ImageDraw.Draw(canvas)
    if bg is not None:
        draw.rectangle([0, 0, W, H], fill=bg)

    font_size = int(min(W, H) * font_scale)
    word_font = load(CJK_FONT, font_size)
    b = draw.textbbox((0, 0), '友達', font=word_font)
    ww, wh = b[2] - b[0], b[3] - b[1]
    cx, cy = W // 2, int(H * 0.46)

    # ink ring
    if ring:
        # Always fit inside the canvas (never clipped), centered on cy.
        ring_radius = int(min(min(W, H) * 0.40, min(cy, H - cy) - W // 120))
        hand_circle(canvas, (cx, cy), ring_radius, max(3, W // 160), INK)

    # wordmark
    draw.text((int(cx - ww / 2 - b[0]), int(cy - wh / 2 - b[1])), '友達',
              font=word_font, fill=INK)

    # highlighter underline
    if underline:
        uw = int(ww * 0.6)
        uh = max(6, int(H * 0.014))
        highlighter_stroke(canvas, cx, int(cy + wh * 0.62), uw, uh, HIGHLIGHTER)

    # mono tagline
    if tagline:
        tag = 'INK & PAPER MESSENGER'
        msize = mono_size or int(min(W, H) * 0.032)
        mono = load(MONO_FONT, msize)
        spacing = int(msize * 0.18)
        widths = [text_width(draw, ch, mono) for ch in tag]
        total = sum(widths) + spacing * (len(tag) - 1)
        x = cx - total / 2
        y = int(cy + wh * 0.62 + H * 0.05)
        for ch, cw in zip(tag, widths):
            draw.text((x, y), ch, font=mono, fill=INK)
            x += cw + spacing
    return canvas


def make_icon(size=1024):
    img = Image.new('RGBA', (size, size), PAPER)
    return draw_brand(img, font_scale=0.30, ring=True, tagline=False)


def make_splash(w, h, tagline=True):
    img = Image.new('RGBA', (w, h), PAPER)
    return draw_brand(img, font_scale=0.30 if w < 1300 else 0.22,
                      ring=True, tagline=tagline)


def make_mark(size):
    """Just the 友達 wordmark (+ underline) on transparent — for the Expo
    splash image and Android adaptive-icon foreground."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    return draw_brand(img, font_scale=0.42, ring=False, tagline=False,
                      underline=True, bg=None)


def main():
    out = HERE
    os.makedirs(out, exist_ok=True)

    # ---- Median upload pack ----
    make_icon().save(os.path.join(out, 'icon-1024.png'))
    for name, w, h in [
        ('splash-android-1080x1920', 1080, 1920),
        ('splash-ios-1170x2532', 1170, 2532),
        ('splash-ios-1242x2688', 1242, 2688),
        ('splash-ios-1290x2796', 1290, 2796),
        ('splash-ipad-2048x2732', 2048, 2732),
    ]:
        make_splash(w, h).save(os.path.join(out, f'{name}.png'))

    # ---- app assets (Expo / EAS / PWA) ----
    make_icon().convert('RGB').save(os.path.join(APP, 'assets/icon.png'))
    make_mark(1024).save(os.path.join(APP, 'assets/splash-icon.png'))
    make_mark(512).save(os.path.join(APP, 'assets/android-icon-foreground.png'))
    make_icon().convert('RGB').resize((48, 48), Image.LANCZOS).save(
        os.path.join(APP, 'assets/favicon.png'))

    # ---- PWA icons in app/public ----
    icon = make_icon()
    for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'),
                       (180, 'apple-touch-icon.png'), (32, 'favicon-32.png')]:
        icon.convert('RGB').resize((size, size), Image.LANCZOS).save(
            os.path.join(APP, 'public', name))

    print('All brand assets generated.')


if __name__ == '__main__':
    main()
