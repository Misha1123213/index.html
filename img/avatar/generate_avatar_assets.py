"""
Full redesign of the avatar asset set: clean, bold, cartoon "character
creator" style line art (like the reference sheet), all pre-positioned on
a shared 512x512 canvas so the app's simple layer-stacking (position:
absolute, 100% width/height, object-fit: contain) lines everything up
correctly no matter which options are combined.

Replaces every category from scratch: face, ears, eyes, brows, nose,
mouth, hair, accessory, feature. Run from img/avatar/:

    python3 generate_avatar_assets.py
"""
import json
import math
import os
import shutil

from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
S = 4                       # supersampling factor for smooth anti-aliased lines
CANVAS = 512
BIG = CANVAS * S

CX = 256 * S                # shared face midline, matches eyes/nose/mouth anchor

INK = (30, 26, 24, 255)     # outline color
SKIN = (247, 208, 166, 255)
SKIN_SHADE = (233, 187, 143, 255)
HAIR = (35, 28, 30, 255)
HAIR2 = (58, 42, 40, 255)   # subtle strand highlight
BROW_C = (60, 42, 30, 255)


def P(x, y):
    return (x * S, y * S)


def W(w):
    return max(1, round(w * S))


def catmull_rom(points, samples_per_seg=18, closed=True):
    """Smooth spline through key points -> dense point list.

    For closed curves the point list wraps around. For open curves the
    end tangents are clamped (not wrapped) to avoid overshoot artifacts
    that shoot a stray curve tail back toward the first point.
    """
    pts = list(points)
    n = len(pts)
    out = []
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        if closed:
            p0 = pts[(i - 1) % n]
            p1 = pts[i % n]
            p2 = pts[(i + 1) % n]
            p3 = pts[(i + 2) % n]
        else:
            p0 = pts[max(i - 1, 0)]
            p1 = pts[i]
            p2 = pts[min(i + 1, n - 1)]
            p3 = pts[min(i + 2, n - 1)]
        for s in range(samples_per_seg):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                       (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                       (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                       (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                       (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    return out


def new_canvas():
    return Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))


def save(img, path):
    small = img.resize((CANVAS, CANVAS), Image.LANCZOS)
    small.save(path)


def outline_polygon(draw, pts, fill, outline_w):
    dense = [P(x, y) for x, y in catmull_rom(pts)]
    draw.polygon(dense, fill=fill)
    draw.line(dense + [dense[0]], fill=INK, width=W(outline_w), joint='curve')


def smooth_line(draw, pts, color, width, closed=False, samples_per_seg=18):
    dense = [P(x, y) for x, y in catmull_rom(pts, samples_per_seg, closed=closed)]
    if closed:
        dense = dense + [dense[0]]
    draw.line(dense, fill=color, width=W(width), joint='curve')
    r = W(width) / 2
    for (x, y) in (dense[0], dense[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


# ----------------------------------------------------------------------
# FACE (head silhouette). Box: roughly x 138..374, y 148..404 (cx=256).
# Eyes sit at y~250, brows ~228, nose ~285, mouth ~322 - all inside.
# ----------------------------------------------------------------------
FACE_SHAPES = {
    '1': dict(name='oval',    top=(256, 150), pts=[(198, 168), (158, 235), (150, 300), (168, 365), (256, 404), (344, 365), (362, 300), (354, 235), (314, 168)]),
    '2': dict(name='round',   top=(256, 158), pts=[(190, 172), (146, 240), (144, 300), (168, 360), (256, 400), (344, 360), (368, 300), (366, 240), (322, 172)]),
    '3': dict(name='square',  top=(256, 150), pts=[(196, 166), (152, 232), (146, 300), (156, 356), (198, 392), (256, 400), (314, 392), (356, 356), (366, 300), (360, 232), (316, 166)]),
    '4': dict(name='heart',   top=(256, 148), pts=[(184, 170), (140, 230), (150, 288), (188, 340), (256, 404), (324, 340), (362, 288), (372, 230), (328, 170)]),
    '5': dict(name='long',    top=(256, 146), pts=[(202, 164), (162, 222), (152, 290), (162, 356), (206, 404), (256, 412), (306, 404), (350, 356), (360, 290), (350, 222), (310, 164)]),
}


def make_face(idx, spec):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    pts = [spec['top']] + spec['pts']
    outline_polygon(d, pts, SKIN, 7)
    # soft cheek shading
    for (sx, sy) in ((198, 300), (314, 300)):
        r = 26 * S
        d.ellipse((sx * S - r, sy * S - r, sx * S + r, sy * S + r), fill=(*SKIN_SHADE[:3], 60))
    save(img, f'face/{idx}.png')


# ----------------------------------------------------------------------
# EARS - simple attached shapes at the jawline, sitting just outside the
# narrowest common face width so they read correctly under most face shapes.
# ----------------------------------------------------------------------
EAR_SPECS = {
    '1': dict(rx=16, ry=24, y=258),
    '2': dict(rx=20, ry=28, y=262),
    '3': dict(rx=14, ry=20, y=254),
}


def make_ears(idx, spec):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    rx, ry, y = spec['rx'] * S, spec['ry'] * S, spec['y'] * S
    for cx in (146 * S, 366 * S):
        d.ellipse((cx - rx, y - ry, cx + rx, y + ry), fill=SKIN, outline=INK, width=W(6))
        d.line((cx - rx * 0.3, y - ry * 0.3, cx + rx * 0.2, y + ry * 0.1), fill=INK, width=W(4))
    save(img, f'ears/{idx}.png')


# ----------------------------------------------------------------------
# EYES centered at (212, 250) and (300, 250)
# ----------------------------------------------------------------------
EYE_CENTERS = [(212, 250), (300, 250)]


def make_eyes(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    for cx, cy in EYE_CENTERS:
        cx, cy = cx * S, cy * S
        if style == 'round':
            rx, ry = 15 * S, 17 * S
            d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(255, 255, 255, 255), outline=INK, width=W(5))
            pr = 7 * S
            d.ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=INK)
            hl = 2.5 * S
            d.ellipse((cx - pr * 0.3 - hl, cy - pr * 0.5 - hl, cx - pr * 0.3 + hl, cy - pr * 0.5 + hl), fill=(255, 255, 255, 255))
        elif style == 'almond':
            pts = [(-16, 0), (-6, -9), (6, -9), (16, 0), (6, 8), (-6, 8)]
            dense = [(cx + x * S, cy + y * S) for x, y in catmull_rom(pts, closed=True)]
            d.polygon(dense, fill=(255, 255, 255, 255))
            d.line(dense + [dense[0]], fill=INK, width=W(5), joint='curve')
            pr = 6.5 * S
            d.ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=INK)
        elif style == 'happy':
            rx, ry = 15 * S, 10 * S
            d.arc((cx - rx, cy - ry, cx + rx, cy + ry), start=200, end=340, fill=INK, width=W(6))
        elif style == 'wide':
            rx, ry = 18 * S, 20 * S
            d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(255, 255, 255, 255), outline=INK, width=W(5))
            pr = 8.5 * S
            d.ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=INK)
            for lx in (-1, 0, 1):
                x0 = cx + lx * 6 * S
                d.line((x0, cy - ry - 1 * S, x0 + 3 * S, cy - ry - 8 * S), fill=INK, width=W(3))
    save(img, f'eyes/{idx}.png')


# ----------------------------------------------------------------------
# BROWS above the eyes, y ~ 224
# ----------------------------------------------------------------------
BROW_CENTERS = [(212, 224), (300, 224)]


def make_brows(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    for cx, cy in BROW_CENTERS:
        side = -1 if cx < 256 else 1
        cx, cy = cx * S, cy * S
        if style == 'straight':
            pts = [(-16, 1), (0, -2), (16, 1)]
        elif style == 'arched':
            pts = [(-16, 4), (-2, -8), (4, -6), (16, 3)]
        else:  # thick
            pts = [(-17, 3), (0, -5), (17, 3)]
        dense = [(cx + x * S * side, cy + y * S) for x, y in
                  catmull_rom(pts, samples_per_seg=14, closed=False)]
        width = 8 if style == 'thick' else 6
        d.line(dense, fill=BROW_C, width=W(width), joint='curve')
    save(img, f'brows/{idx}.png')


# ----------------------------------------------------------------------
# NOSE, centered at x=256, y ~ 260-300
# ----------------------------------------------------------------------
def make_nose(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    cx = 256 * S
    if style == 'dot':
        r = 4 * S
        d.ellipse((cx - r, 288 * S - r, cx + r, 288 * S + r), fill=INK)
    elif style == 'button':
        pts = [(cx, 262 * S), (cx - 3 * S, 288 * S), (cx + 9 * S, 292 * S)]
        d.line(pts, fill=INK, width=W(5), joint='curve')
        r = 3.5 * S
        d.ellipse((cx + 9 * S - r, 292 * S - r, cx + 9 * S + r, 292 * S + r), fill=INK)
    else:  # long
        pts = [(cx, 258 * S), (cx - 2 * S, 300 * S), (cx + 11 * S, 305 * S)]
        d.line(pts, fill=INK, width=W(5), joint='curve')
    save(img, f'nose/{idx}.png')


# ----------------------------------------------------------------------
# MOUTH, centered at x=256, y ~ 322
# ----------------------------------------------------------------------
def make_mouth(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    cx, cy = 256 * S, 322 * S
    if style == 'smile':
        pts = [(-22, -2), (0, 12), (22, -2)]
        smooth_line(d, [(cx / S + x, cy / S + y) for x, y in pts], INK, 6)
    elif style == 'small':
        pts = [(-12, -1), (0, 7), (12, -1)]
        smooth_line(d, [(cx / S + x, cy / S + y) for x, y in pts], INK, 5)
    elif style == 'open':
        rx, ry = 16 * S, 12 * S
        d.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=(196, 74, 74, 255), outline=INK, width=W(5))
        d.rectangle((cx - rx + 3 * S, cy - ry + 2 * S, cx + rx - 3 * S, cy - ry + 6 * S), fill=(255, 255, 255, 255))
    else:  # neutral
        d.line((cx - 16 * S, cy, cx + 16 * S, cy), fill=INK, width=W(6))
    save(img, f'mouth/{idx}.png')


# ----------------------------------------------------------------------
# HAIR - a top "cap" silhouette plus optional fringe / side extensions,
# covering the head from ~y=110 (crown) down through the sides. Anchored
# on the same cx=256 midline as everything else, wide enough (x ~120..392)
# to read behind the ears regardless of which face shape is selected.
# ----------------------------------------------------------------------
def spikes(cx, top_y, half_w, n, jag, base_y):
    pts = [(cx - half_w, base_y)]
    for i in range(n + 1):
        x = cx - half_w + (2 * half_w) * i / n
        y = top_y if i % 2 == 0 else top_y + jag
        pts.append((x, y))
    pts.append((cx + half_w, base_y))
    return pts


def hair_cap(d, cx, half_w, top_y, base_y, jag=0, n=7, fill=HAIR):
    top_pts = spikes(cx, top_y, half_w, n, jag, base_y) if jag else \
        [(cx - half_w, base_y), (cx - half_w * 0.6, top_y), (cx, top_y - 6), (cx + half_w * 0.6, top_y), (cx + half_w, base_y)]
    pts = top_pts + [(cx + half_w, base_y + 40), (cx, base_y + 18), (cx - half_w, base_y + 40)]
    dense = [P(x, y) for x, y in catmull_rom(pts, samples_per_seg=16, closed=True)]
    d.polygon(dense, fill=fill)
    d.line(dense + [dense[0]], fill=INK, width=W(6), joint='curve')


def side_lock(d, cx_side, top_y, bottom_y, width, curve=18, fill=HAIR):
    sign = 1 if cx_side > 256 else -1
    pts = [
        (cx_side - sign * width * 0.4, top_y),
        (cx_side + sign * curve, (top_y + bottom_y) / 2),
        (cx_side - sign * width * 0.2, bottom_y),
    ]
    dense = [P(x, y) for x, y in catmull_rom(pts, samples_per_seg=16, closed=False)]
    d.line(dense, fill=fill, width=W(width), joint='curve')
    r = W(width) / 2
    for x, y in (dense[0], dense[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=fill)
    dense_out = dense
    d.line(dense_out, fill=INK, width=W(width + 5), joint='curve')
    d.line(dense, fill=fill, width=W(width), joint='curve')


def bang_fringe(d, cx, y0, y1, half_w, n=6):
    pts = [(cx - half_w, y0)]
    for i in range(n + 1):
        x = cx - half_w + (2 * half_w) * i / n
        y = y1 if i % 2 == 0 else y0 + (y1 - y0) * 0.4
        pts.append((x, y))
    pts.append((cx + half_w, y0))
    dense = [P(x, y) for x, y in catmull_rom(pts, samples_per_seg=14, closed=True)]
    d.polygon(dense, fill=HAIR)
    d.line(dense + [dense[0]], fill=INK, width=W(5), joint='curve')


def bun(d, cx, cy, r):
    cx, cy, r = cx * S, cy * S, r * S
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=HAIR, outline=INK, width=W(6))


def braid(d, cx, top_y, bottom_y, width):
    n_seg = 6
    seg_h = (bottom_y - top_y) / n_seg
    for i in range(n_seg):
        y0 = top_y + i * seg_h
        y1 = y0 + seg_h
        r = width / 2 * (1 - i * 0.05)
        cx_i = cx + (8 if i % 2 == 0 else -8)
        d.ellipse(((cx_i - r) * S, y0 * S, (cx_i + r) * S, y1 * S), fill=HAIR, outline=INK, width=W(4))


HAIR_STYLES = [
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
]


def make_hair(idx):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    cx = 256

    if idx == '1':  # short spiky male
        hair_cap(d, cx, 118, 96, 172, jag=22, n=9)
    elif idx == '2':  # neat side-part male
        hair_cap(d, cx, 112, 108, 168, jag=6, n=5)
        d.line((P(226, 100)[0], P(226, 100)[1], P(300, 178)[0], P(300, 178)[1]), fill=INK, width=W(3))
    elif idx == '3':  # buzz cut
        hair_cap(d, cx, 108, 118, 160, jag=0)
    elif idx == '4':  # curly male
        for ox in range(-100, 101, 26):
            for oy in (100, 122):
                if abs(ox) > 92 and oy == 122:
                    continue
                r = 18
                d.ellipse(((cx + ox - r) * S, (oy - r) * S, (cx + ox + r) * S, (oy + r) * S), fill=HAIR, outline=INK, width=W(5))
        d.rectangle(((cx - 96) * S, 108 * S, (cx + 96) * S, 175 * S), fill=HAIR)
        d.line(((cx - 96) * S, 175 * S, (cx + 96) * S, 175 * S), fill=INK, width=W(3))
    elif idx == '5':  # mohawk / textured quiff
        hair_cap(d, cx, 100, 90, 170, jag=30, n=5)
    elif idx == '6':  # short with beard-adjacent sideburns (kept simple - just style variety)
        hair_cap(d, cx, 116, 104, 166, jag=10, n=6)
        side_lock(d, 150, 168, 220, 14)
        side_lock(d, 362, 168, 220, 14)
    elif idx == '7':  # bob with fringe (female short)
        hair_cap(d, cx, 132, 100, 176, jag=0)
        bang_fringe(d, cx, 176, 206, 118, n=6)
        side_lock(d, 140, 176, 300, 30)
        side_lock(d, 372, 176, 300, 30)
    elif idx == '8':  # twin tails with ribbons
        hair_cap(d, cx, 126, 102, 174, jag=0)
        bang_fringe(d, cx, 174, 200, 110, n=6)
        side_lock(d, 132, 190, 340, 26)
        side_lock(d, 380, 190, 340, 26)
        bun(d, 132, 192, 15)
        bun(d, 380, 192, 15)
    elif idx == '9':  # long straight with center part
        hair_cap(d, cx, 128, 104, 176, jag=0)
        bang_fringe(d, cx, 176, 196, 60, n=4)
        side_lock(d, 138, 176, 380, 34)
        side_lock(d, 374, 176, 380, 34)
    elif idx == '10':  # double space buns
        hair_cap(d, cx, 126, 104, 176, jag=0)
        bang_fringe(d, cx, 176, 200, 110, n=6)
        side_lock(d, 140, 176, 260, 24)
        side_lock(d, 372, 176, 260, 24)
        bun(d, 178, 108, 26)
        bun(d, 334, 108, 26)
    elif idx == '11':  # braided pigtails
        hair_cap(d, cx, 126, 104, 176, jag=0)
        bang_fringe(d, cx, 176, 200, 100, n=6)
        braid(d, 140, 190, 340, 26)
        braid(d, 372, 190, 340, 26)
    elif idx == '12':  # long wavy with high ponytail crown
        hair_cap(d, cx, 128, 100, 178, jag=0)
        bang_fringe(d, cx, 178, 202, 70, n=4)
        side_lock(d, 138, 178, 400, 40)
        side_lock(d, 374, 178, 400, 40)
        bun(d, 256, 92, 24)

    save(img, f'hair/{idx}.png')


# ----------------------------------------------------------------------
# ACCESSORY (glasses) and FEATURE (freckles / mole)
# ----------------------------------------------------------------------
def make_accessory(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    if style == 'round':
        for cx, cy in EYE_CENTERS:
            r = 22 * S
            d.ellipse((cx * S - r, cy * S - r, cx * S + r, cy * S + r), outline=INK, width=W(6))
        d.line((P(EYE_CENTERS[0][0] + 22, 250)[0], P(EYE_CENTERS[0][0] + 22, 250)[1],
                P(EYE_CENTERS[1][0] - 22, 250)[0], P(EYE_CENTERS[1][0] - 22, 250)[1]), fill=INK, width=W(4))
    else:  # square
        for cx, cy in EYE_CENTERS:
            hw, hh = 22 * S, 17 * S
            d.rounded_rectangle((cx * S - hw, cy * S - hh, cx * S + hw, cy * S + hh), radius=W(6), outline=INK, width=W(6))
        d.line((P(EYE_CENTERS[0][0] + 22, 250)[0], P(EYE_CENTERS[0][0] + 22, 250)[1],
                P(EYE_CENTERS[1][0] - 22, 250)[0], P(EYE_CENTERS[1][0] - 22, 250)[1]), fill=INK, width=W(4))
    save(img, f'accessory/{idx}.png')


def make_feature(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    if style == 'freckles':
        for ox, oy in ((-38, 268), (-26, 274), (-46, 278), (30, 270), (42, 276), (22, 280)):
            r = 2.4 * S
            cx, cy = (256 + ox) * S, oy * S
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(176, 110, 90, 220))
    else:  # mole
        r = 3 * S
        cx, cy = 278 * S, 300 * S
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(70, 45, 40, 255))
    save(img, f'feature/{idx}.png')


def main():
    for d in ['face', 'ears', 'eyes', 'brows', 'nose', 'mouth', 'hair', 'accessory', 'feature']:
        path = os.path.join(BASE, d)
        os.makedirs(path, exist_ok=True)
        for f in os.listdir(path):
            if f.endswith('.png'):
                os.remove(os.path.join(path, f))

    for idx, spec in FACE_SHAPES.items():
        make_face(idx, spec)
    for idx, spec in EAR_SPECS.items():
        make_ears(idx, spec)
    for idx, style in enumerate(['round', 'almond', 'happy', 'wide'], start=1):
        make_eyes(str(idx), style)
    for idx, style in enumerate(['straight', 'arched', 'thick'], start=1):
        make_brows(str(idx), style)
    for idx, style in enumerate(['dot', 'button', 'long'], start=1):
        make_nose(str(idx), style)
    for idx, style in enumerate(['smile', 'small', 'open', 'neutral'], start=1):
        make_mouth(str(idx), style)
    for idx in HAIR_STYLES:
        make_hair(idx)
    for idx, style in enumerate(['round', 'square'], start=1):
        make_accessory(str(idx), style)
    for idx, style in enumerate(['freckles', 'mole'], start=1):
        make_feature(str(idx), style)

    config = {
        'face': sorted(FACE_SHAPES.keys(), key=int),
        'ears': sorted(EAR_SPECS.keys(), key=int),
        'eyes': ['1', '2', '3', '4'],
        'brows': ['1', '2', '3'],
        'nose': ['1', '2', '3'],
        'mouth': ['1', '2', '3', '4'],
        'hair': HAIR_STYLES,
        'accessory': ['1', '2'],
        'feature': ['1', '2'],
    }
    with open(os.path.join(BASE, 'config.json'), 'w', encoding='utf-8') as fp:
        json.dump(config, fp, ensure_ascii=False, indent=2)
    print('Done.')


if __name__ == '__main__':
    main()
