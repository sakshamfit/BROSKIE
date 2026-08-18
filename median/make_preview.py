#!/usr/bin/env python3
"""Render a GIF and final still matching the +one Lottie splash motion."""
from pathlib import Path
from PIL import Image
import make_splash_animation as G

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'source-logo.png'
SCALE_DOWN = 0.8


def logo_state(frame):
    fade_p = max(0.0, min(1.0, frame / G.LOGO_FADE_T))
    scale_p = max(0.0, min(1.0, frame / G.LOGO_SCALE_T))
    return G.ease_out_cubic(fade_p), (88 + 12 * G.ease_out_cubic(scale_p)) / 100


def compose(frame, logo_source):
    paper = tuple(round(channel * 255) for channel in G.PAPER) + (255,)
    canvas = Image.new('RGBA', (G.W, G.H), paper)
    opacity, relative_scale = logo_state(frame)
    scale = G.SCALE / 100 * relative_scale
    width = max(1, round(logo_source.width * scale))
    height = max(1, round(logo_source.height * scale))
    logo = logo_source.resize((width, height), Image.Resampling.LANCZOS)
    if opacity < 1:
        logo.putalpha(logo.getchannel('A').point(lambda alpha: round(alpha * opacity)))
    canvas.alpha_composite(logo, (round(G.LOGO_CX - width / 2), round(G.LOGO_CY - height / 2)))
    return canvas


def main():
    logo = Image.open(SOURCE).convert('RGBA')
    frames = []
    for frame in range(0, G.END + 1, 3):
        image = compose(frame, logo)
        image = image.resize((round(G.W * SCALE_DOWN), round(G.H * SCALE_DOWN)), Image.Resampling.LANCZOS)
        frames.append(image.convert('P', palette=Image.Palette.ADAPTIVE, colors=256))

    frames[0].save(HERE / 'preview-splash.gif', save_all=True, append_images=frames[1:], duration=100, loop=0, optimize=True)
    compose(G.END - 1, logo).save(HERE / 'preview-splash-frame.png', optimize=True)
    print('wrote preview-splash.gif and preview-splash-frame.png')


if __name__ == '__main__':
    main()
