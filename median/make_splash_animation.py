#!/usr/bin/env python3
"""
Build the self-contained +one Lottie splash using the canonical
``source-logo.png`` artwork embedded as base64.

Design:
  1. warm paper background (#fdf8f8) fills the whole canvas
  2. the +one logo fades in + scales up gently (ease-out)

Keyframes are pre-sampled with a cubic ease-out and stored as dense linear
keyframes, so every Lottie player interpolates the exact same motion AND the
preview GIF (composited with the same samples) matches the real JSON.

Outputs:
  median/splash-animated.json        the deliverable Lottie
  median/preview-splash.gif          animated preview
  median/preview-splash-frame.png    final frame still
"""
import json
import base64
import os
import math

HERE = os.path.dirname(os.path.abspath(__file__))
LOGO = os.path.join(HERE, 'source-logo.png')

W, H = 375, 667
FPS = 30
DUR = 45                      # frames -> 1.5 s
END = 45

# brand colors (0..1)
PAPER = [0.992156862745098, 0.9725490196078431, 0.9725490196078431]   # #fdf8f8
HIGHLIGHTER = [1.0, 0.8862745098039215, 0.30196078431372547]          # #FFE24D

# ---- logo placement (square artwork, ~232px wide on a 375px canvas) ----
IMG_W, IMG_H = 1254, 1254
SCALE = 18.5
LOGO_CX, LOGO_CY = 187.5, 320.0
UNDERLINE_W = 142.0
UNDERLINE_H = 11.0
UNDERLINE_Y = 357.0

# ---- animation timing (frames) ----
LOGO_FADE_T = 12          # logo fully in
LOGO_SCALE_T = 14         # logo settles
UNDERLINE_T0 = 14         # underline starts drawing
UNDERLINE_T1 = 32         # underline done


def ease_out_cubic(p):
    p = max(0.0, min(1.0, p))
    return 1 - (1 - p) ** 3


def lin_keys(frames, value_fn, ndigits=2, wrap_scalar=False):
    """Dense linear keyframes sampling value_fn(t) for t in frames.
    Lottie keyframe values are always arrays, even for scalars."""
    out = []
    for t in frames:
        v = value_fn(t)
        if isinstance(v, (list, tuple)):
            v = [round(x, ndigits) for x in v]
        else:
            v = round(v, ndigits)
            if wrap_scalar:
                v = [v]
        out.append({"t": t, "s": v})
    return out


def build():
    with open(LOGO, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode()

    # ------------------------------------------------------------------
    # keyframes (shared by JSON and preview)
    # ------------------------------------------------------------------
    op_keys = lin_keys(range(0, LOGO_FADE_T + 1),
                       lambda t: round(100 * ease_out_cubic(t / LOGO_FADE_T), 1),
                       wrap_scalar=True)
    sc_keys = lin_keys(range(0, LOGO_SCALE_T + 1),
                       lambda t: [round(88 + 12 * ease_out_cubic(t / LOGO_SCALE_T), 2)] * 2 + [100])
    ul_keys = lin_keys(range(UNDERLINE_T0, UNDERLINE_T1 + 1),
                       lambda t: [round(UNDERLINE_W * ease_out_cubic((t - UNDERLINE_T0) / (UNDERLINE_T1 - UNDERLINE_T0)), 2),
                                  UNDERLINE_H])

    def shape_layer(ind, name, shapes, pos, opacity=100, anchor=(0, 0, 0), scale=(100, 100, 100)):
        return {
            "ddd": 0, "ind": ind, "ty": 4, "nm": name, "sr": 1,
            "ks": {
                "o": {"a": 0, "k": opacity, "ix": 11},
                "r": {"a": 0, "k": 0, "ix": 10},
                "p": {"a": 0, "k": [pos[0], pos[1], 0], "ix": 2, "l": 2},
                "a": {"a": 0, "k": [anchor[0], anchor[1], anchor[2]], "ix": 1, "l": 2},
                "s": {"a": 0, "k": [scale[0], scale[1], scale[2]], "ix": 6, "l": 2}
            },
            "ao": 0,
            "shapes": shapes,
            "ip": 0, "op": END, "st": 0, "bm": 0
        }

    def rect_group(rect_size, rect_pos, fill, name, tr_pos=(0, 0), tr_scale=(100, 100),
                   tr_rotate=0, animated_size=None):
        """Shape group: rectangle path + fill + transform."""
        rect = {
            "ty": "rc", "d": 1,
            "s": ({"a": 1, "k": animated_size} if animated_size is not None
                  else {"a": 0, "k": [rect_size[0], rect_size[1]]}),
            "p": {"a": 0, "k": [rect_pos[0], rect_pos[1]]},
            "r": {"a": 0, "k": 0},
            "nm": "Rect Path 1"
        }
        fill_node = {
            "ty": "fl", "c": {"a": 0, "k": fill}, "o": {"a": 0, "k": 100},
            "r": 1, "bm": 0, "nm": "Fill 1"
        }
        tr = {
            "ty": "tr",
            "p": {"a": 0, "k": [tr_pos[0], tr_pos[1]]},
            "a": {"a": 0, "k": [0, 0]},
            "s": {"a": 0, "k": [tr_scale[0], tr_scale[1]]},
            "r": {"a": 0, "k": tr_rotate},
            "o": {"a": 0, "k": 100}, "sk": {"a": 0, "k": 0}, "sa": {"a": 0, "k": 0},
            "nm": "Transform"
        }
        return {"ty": "gr", "it": [rect, fill_node, tr], "nm": name,
                "np": 3, "cix": 2, "bm": 0, "ix": 1}

    # ------------------------------------------------------------------
    # 1) background — full-canvas paper rect.
    #    Layer transform maps comp = (layer - anchor) * scale + position;
    #    anchor (0,0) + position (W/2, H/2) with a rect centred on the layer
    #    origin spans exactly (0,0)-(375,667).
    # ------------------------------------------------------------------
    bg = shape_layer(
        5, "bg_paper",
        [rect_group((W, H), (0, 0), PAPER, "Paper BG", tr_pos=(0, 0))],
        pos=(W / 2, H / 2),
        anchor=(0, 0, 0),
    )

    # ------------------------------------------------------------------
    # 2) highlighter underline — draws on left→right from center
    # ------------------------------------------------------------------
    underline = shape_layer(
        4, "hl_underline",
        [rect_group((UNDERLINE_W, UNDERLINE_H), (0, 0), HIGHLIGHTER,
                    "Underline", animated_size=ul_keys)],
        pos=(W / 2, UNDERLINE_Y),
    )

    # ------------------------------------------------------------------
    # 3) logo — image layer, fades in + scales up
    # ------------------------------------------------------------------
    logo = {
        "ddd": 0, "ind": 3, "ty": 2, "nm": "logo (user)", "refId": "image_0",
        "sr": 1,
        "ks": {
            "o": {"a": 1, "k": op_keys, "ix": 11},
            "r": {"a": 0, "k": 0, "ix": 10},
            "p": {"a": 0, "k": [LOGO_CX, LOGO_CY, 0], "ix": 2, "l": 2},
            "a": {"a": 0, "k": [IMG_W / 2, IMG_H / 2, 0], "ix": 1, "l": 2},
            "s": {"a": 1, "k": sc_keys, "ix": 6, "l": 2}
        },
        "ao": 0,
        "ip": 0, "op": END, "st": 0, "bm": 0
    }

    lottie = {
        "v": "5.9.1",
        "fr": FPS,
        "ip": 0,
        "op": END,
        "w": W,
        "h": H,
        "nm": "plus_one_splash",
        "ddd": 0,
        "assets": [{"id": "image_0", "w": IMG_W, "h": IMG_H, "u": "",
                    "p": f"data:image/png;base64,{b64}"}],
        # Lottie layers array is TOP-TO-BOTTOM: first = topmost. The supplied
        # artwork already includes its own brush underline, so no extra mark.
        "layers": [logo, bg],
        "markers": []
    }

    out = os.path.join(HERE, 'splash-animated.json')
    with open(out, 'w') as f:
        json.dump(lottie, f)
    print('wrote', out, os.path.getsize(out), 'bytes')
    return lottie, op_keys, sc_keys, ul_keys


if __name__ == '__main__':
    build()
