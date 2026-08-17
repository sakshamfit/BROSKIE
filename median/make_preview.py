#!/usr/bin/env python3
"""
Render an animated preview GIF + a final-frame still of the splash.

The glaxnimate lottie library's SVG exporter ignores IMAGE layer
transforms, so the logo is composited manually here using the exact same
sampled keyframes that are baked into splash-animated.json — the preview
therefore matches what real Lottie players (lottie-web, lottie-android,
Median) render.
"""
import os
import json
import subprocess
import tempfile

from PIL import Image
from lottie.parsers.tgs import parse_tgs
from lottie.exporters.svg import to_svg

import make_splash_animation as G   # reuse constants + easing + keyframe fn

HERE = os.path.dirname(os.path.abspath(__file__))
SCALE_DOWN = 0.8                     # preview at 300x534


def load_skeleton_anim():
    """The full animation WITHOUT image layers (the lib's SVG exporter
    ignores image transforms, so we composite the logo ourselves)."""
    with open(os.path.join(HERE, 'splash-animated.json')) as f:
        d = json.load(f)
    d = dict(d)
    d['layers'] = [L for L in d['layers'] if L.get('ty') != 2]
    fd, path = tempfile.mkstemp(suffix='.json')
    os.close(fd)
    with open(path, 'w') as f:
        json.dump(d, f)
    anim = parse_tgs(path)
    os.unlink(path)
    return anim


def logo_state(t):
    """(opacity 0..1, scale percent 0..1 relative to final) at frame t."""
    p = max(0.0, min(1.0, t / G.LOGO_FADE_T))
    op = G.ease_out_cubic(p)
    sp = max(0.0, min(1.0, t / G.LOGO_SCALE_T))
    sc = 88 + 12 * G.ease_out_cubic(sp)
    return op, sc / 100.0


def render_skeleton(anim, frame):
    """Render bg + underline (shape layers only) to a PIL RGBA image."""
    fd, path = tempfile.mkstemp(suffix='.svg')
    os.close(fd)
    out = to_svg(anim, frame)
    # glaxnimate's to_svg may return an ElementTree or a str
    if isinstance(out, str):
        with open(path, 'w') as f:
            f.write(out)
    else:
        out.write(path)
    out.write(path)
    png = tempfile.mktemp(suffix='.png')
    subprocess.run(['cairosvg', path, '-o', png,
                    '--output-width', str(G.W), '--output-height', str(G.H)],
                   check=True)
    img = Image.open(png).convert('RGBA')
    os.unlink(path); os.unlink(png)
    return img


def compose(anim, frame, logo_src):
    img = render_skeleton(anim, frame)
    op, sc_rel = logo_state(frame)
    final_scale = G.SCALE / 100.0
    sc = final_scale * sc_rel
    w = max(1, round(logo_src.width * sc))
    h = max(1, round(logo_src.height * sc))
    logo = logo_src.resize((w, h), Image.LANCZOS)
    if op < 1:
        alpha = logo.split()[3].point(lambda a: round(a * op))
        logo.putalpha(alpha)
    img.alpha_composite(logo, (round(G.LOGO_CX - w / 2), round(G.LOGO_CY - h / 2)))
    return img


def main():
    anim = load_skeleton_anim()
    logo = Image.open('/home/user/uploads/ChatGPT_Image_Aug_17__2026__11_24_51_AM-removebg-preview.png').convert('RGBA')

    frames = list(range(0, 46, 3))          # 16 frames, ~100ms each
    imgs = []
    for fr in frames:
        im = compose(anim, fr, logo)
        im = im.resize((round(G.W * SCALE_DOWN), round(G.H * SCALE_DOWN)), Image.LANCZOS)
        imgs.append(im.convert('P', palette=Image.ADAPTIVE, colors=256))
        print('composited frame', fr)

    gif = os.path.join(HERE, 'preview-splash.gif')
    imgs[0].save(gif, save_all=True, append_images=imgs[1:],
                 duration=100, loop=0, optimize=True)
    print('wrote', gif)

    # final-frame still at full res
    final = compose(anim, 44, logo)
    still = os.path.join(HERE, 'preview-splash-frame.png')
    final.save(still)
    print('wrote', still)


if __name__ == '__main__':
    main()
