#!/usr/bin/env python3
"""Generate the +one icon and splash pack from ``source-logo.png``.

The canonical source is the user-supplied transparent 1254px artwork. This
script mirrors it into Expo/EAS assets, PWA icons, Android adaptive/themed
icons, and Median launch images so a future regeneration cannot restore the
legacy wordmark.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageChops

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
APP = ROOT / 'app'
SOURCE = HERE / 'source-logo.png'
PAPER = (253, 248, 248, 255)
BLACK = (0, 0, 0, 255)


def source():
    return Image.open(SOURCE).convert('RGBA')


def resized(size):
    return source().resize((size, size), Image.Resampling.LANCZOS)


def opaque(size, background=(0, 0, 0)):
    art = resized(size)
    out = Image.new('RGB', (size, size), background)
    out.paste(art, (0, 0), art)
    return out


def splash(width, height):
    canvas = Image.new('RGBA', (width, height), PAPER)
    side = round(min(width * 0.56, height * 0.34))
    art = source().resize((side, side), Image.Resampling.LANCZOS)
    canvas.alpha_composite(art, ((width - side) // 2, round(height * 0.48 - side / 2)))
    return canvas


def android_foreground():
    size, art_size = 512, 350
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    art = source().resize((art_size, art_size), Image.Resampling.LANCZOS)
    canvas.alpha_composite(art, ((size - art_size) // 2, (size - art_size) // 2))
    return canvas


def android_monochrome():
    size, art_size = 432, 296
    canvas = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    art = source().resize((art_size, art_size), Image.Resampling.LANCZOS)
    brightness = ImageOps.grayscale(art.convert('RGB'))
    alpha = ImageChops.multiply(art.getchannel('A'), brightness)
    mark = Image.new('RGBA', art.size, (255, 255, 255, 0))
    mark.putalpha(alpha)
    canvas.alpha_composite(mark, ((size - art_size) // 2, (size - art_size) // 2))
    return canvas


def save(image, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, 'PNG', optimize=True)
    print('wrote', path.relative_to(ROOT))


def main():
    # Median source pack.
    save(opaque(1024), HERE / 'icon-1024.png')
    for name, width, height in [
        ('splash-android-1080x1920.png', 1080, 1920),
        ('splash-ios-1170x2532.png', 1170, 2532),
        ('splash-ios-1242x2688.png', 1242, 2688),
        ('splash-ios-1290x2796.png', 1290, 2796),
        ('splash-ipad-2048x2732.png', 2048, 2732),
    ]:
        save(splash(width, height), HERE / name)

    # Expo / EAS native assets.
    save(opaque(1024), APP / 'assets/icon.png')
    save(resized(1024), APP / 'assets/splash-icon.png')
    save(resized(48), APP / 'assets/favicon.png')
    save(android_foreground(), APP / 'assets/android-icon-foreground.png')
    save(Image.new('RGBA', (512, 512), BLACK), APP / 'assets/android-icon-background.png')
    save(android_monochrome(), APP / 'assets/android-icon-monochrome.png')

    # Web PWA assets.
    for size, name in [
        (32, 'favicon-32.png'),
        (180, 'apple-touch-icon.png'),
        (192, 'icon-192.png'),
        (512, 'icon-512.png'),
    ]:
        save(opaque(size), APP / 'public' / name)

    # Preview still used by the Median handoff docs.
    save(splash(375, 667), HERE / 'preview-splash-frame.png')
    print('All +one brand assets generated.')


if __name__ == '__main__':
    main()
