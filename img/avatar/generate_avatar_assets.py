"""
Avatar asset generator - minimal, thin-line portrait style (matches the
reference sheet: slim faces, thin uniform outline, no blush/no bold cartoon
shading, solid black hair shapes with a few fine strand lines).

Every category (face, ears, eyes, brows, nose, mouth, hair, accessory,
feature) is drawn directly onto a shared 512x512 canvas so the app's simple
layer-stacking (position: absolute, 100% width/height, object-fit: contain)
lines everything up correctly no matter which options are combined.

Run from img/avatar/:

    python3 generate_avatar_assets.py
"""
import json
import os

from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
S = 4                        # supersampling factor for smooth anti-aliased lines
CANVAS = 512
BIG = CANVAS * S

INK = (35, 30, 28, 255)      # thin outline color, used everywhere (no color-per-part)
SKIN = (247, 214, 178, 255)  # flat, single skin tone - no shading blobs
HAIR = (26, 22, 22, 255)     # near-black solid hair fill
LINE_W = 4                   # base outline stroke width, kept thin & uniform throughout


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


def outline_polygon(draw, pts, fill, outline_w=LINE_W, outline=INK, closed=True):
    dense = [P(x, y) for x, y in catmull_rom(pts, closed=closed)]
    if closed:
        draw.polygon(dense, fill=fill)
        draw.line(dense + [dense[0]], fill=outline, width=W(outline_w), joint='curve')
    else:
        draw.line(dense, fill=outline, width=W(outline_w), joint='curve')
    return dense


def thin_stroke(draw, pts, width=LINE_W, color=INK, closed=False, samples_per_seg=16):
    dense = [P(x, y) for x, y in catmull_rom(pts, samples_per_seg, closed=closed)]
    if closed:
        dense = dense + [dense[0]]
    draw.line(dense, fill=color, width=W(width), joint='curve')
    r = W(width) / 2
    for (x, y) in (dense[0], dense[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


# ----------------------------------------------------------------------
# FACE - slim, understated oval silhouettes. Box roughly x 168..344,
# y 150..400 (cx=256). Eyes sit at y~248, brows ~226, nose ~250-292,
# mouth ~320 - all inside.
# ----------------------------------------------------------------------
FACE_SHAPES = {
    '1': dict(top=(256, 156), pts=[(206, 172), (172, 232), (166, 292), (182, 348), (256, 398), (330, 348), (346, 292), (340, 232), (306, 172)]),   # oval
    '2': dict(top=(256, 164), pts=[(198, 178), (168, 236), (166, 292), (184, 340), (256, 388), (328, 340), (346, 292), (344, 236), (314, 178)]),   # round
    '3': dict(top=(256, 156), pts=[(204, 172), (172, 228), (168, 288), (176, 336), (206, 372), (256, 384), (306, 372), (336, 336), (344, 288), (340, 228), (308, 172)]),  # square
    '4': dict(top=(256, 152), pts=[(196, 176), (166, 226), (172, 278), (198, 322), (256, 396), (314, 322), (340, 278), (346, 226), (316, 176)]),   # heart
    '5': dict(top=(256, 150), pts=[(208, 168), (176, 218), (168, 282), (176, 340), (210, 396), (256, 406), (302, 396), (336, 340), (344, 282), (336, 218), (304, 168)]),  # long
}


def make_face(idx, spec):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    pts = [spec['top']] + spec['pts']
    outline_polygon(d, pts, SKIN, LINE_W)
    save(img, f'face/{idx}.png')


# ----------------------------------------------------------------------
# EARS - small, simple, thin-outlined, sitting at the jawline.
# ----------------------------------------------------------------------
EAR_SPECS = {
    '1': dict(rx=11, ry=17, y=252),
    '2': dict(rx=13, ry=19, y=256),
    '3': dict(rx=9, ry=14, y=248),
}


def make_ears(idx, spec):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    rx, ry, y = spec['rx'] * S, spec['ry'] * S, spec['y'] * S
    for cx in (172 * S, 340 * S):
        d.ellipse((cx - rx, y - ry, cx + rx, y + ry), fill=SKIN, outline=INK, width=W(LINE_W))
        d.line((cx - rx * 0.2, y - ry * 0.2, cx + rx * 0.15, y + ry * 0.15), fill=INK, width=W(3))
    save(img, f'ears/{idx}.png')


# ----------------------------------------------------------------------
# EYES centered at (218, 246) and (294, 246) - small and understated,
# matching the reference's thin-line, low-detail eyes.
# ----------------------------------------------------------------------
EYE_CENTERS = [(218, 246), (294, 246)]


def make_eyes(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    for cx, cy in EYE_CENTERS:
        cx, cy = cx * S, cy * S
        if style == 'curve':
            # soft downward-closed lash line, like most reference faces
            rx, ry = 11 * S, 5 * S
            d.arc((cx - rx, cy - ry, cx + rx, cy + ry), start=10, end=170, fill=INK, width=W(4))
        elif style == 'dot':
            # tiny open eye: thin lid line + small pupil dot, no white sclera
            rx = 10 * S
            d.line((cx - rx, cy, cx + rx, cy), fill=INK, width=W(3))
            pr = 3.2 * S
            d.ellipse((cx - pr, cy - 2 * S, cx + pr, cy - 2 * S + pr * 2), fill=INK)
        elif style == 'almond':
            pts = [(-11, 0), (-4, -5), (4, -5), (11, 0), (4, 4), (-4, 4)]
            dense = [(cx + x * S, cy + y * S) for x, y in catmull_rom(pts, closed=True)]
            d.line(dense + [dense[0]], fill=INK, width=W(4), joint='curve')
            pr = 3.4 * S
            d.ellipse((cx - pr, cy - pr, cx + pr, cy + pr), fill=INK)
        else:  # wide - slightly larger open eye, thin outline only
            rx, ry = 12 * S, 8 * S
            d.arc((cx - rx, cy - ry, cx + rx, cy + ry), start=180, end=360, fill=INK, width=W(4))
            pr = 3.6 * S
            d.ellipse((cx - pr, cy - 1 * S, cx + pr, cy - 1 * S + pr * 2), fill=INK)
    save(img, f'eyes/{idx}.png')


# ----------------------------------------------------------------------
# BROWS - thin single strokes just above the eyes.
# ----------------------------------------------------------------------
BROW_CENTERS = [(218, 228), (294, 228)]


def make_brows(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    for cx, cy in BROW_CENTERS:
        side = -1 if cx < 256 else 1
        cx, cy = cx * S, cy * S
        if style == 'straight':
            pts = [(-11, 1), (0, -1), (11, 1)]
            width = 4
        elif style == 'arched':
            pts = [(-11, 3), (-2, -4), (2, -4), (11, 2)]
            width = 4
        else:  # thick
            pts = [(-12, 2), (0, -3), (12, 2)]
            width = 6
        dense = [(cx + x * S * side, cy + y * S) for x, y in
                 catmull_rom(pts, samples_per_seg=14, closed=False)]
        d.line(dense, fill=INK, width=W(width), joint='curve')
    save(img, f'brows/{idx}.png')


# ----------------------------------------------------------------------
# NOSE - a small thin tick, centered at x=256.
# ----------------------------------------------------------------------
def make_nose(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    cx = 256 * S
    if style == 'dot':
        pts = [(cx, 250 * S), (cx, 278 * S)]
        d.line(pts, fill=INK, width=W(3))
    elif style == 'button':
        pts = [(cx - 1 * S, 250 * S), (cx - 2 * S, 276 * S), (cx + 6 * S, 280 * S)]
        d.line(pts, fill=INK, width=W(3), joint='curve')
    else:  # long
        pts = [(cx, 244 * S), (cx - 1 * S, 288 * S), (cx + 7 * S, 292 * S)]
        d.line(pts, fill=INK, width=W(3), joint='curve')
    save(img, f'nose/{idx}.png')


# ----------------------------------------------------------------------
# MOUTH - small, subtle, thin line. Centered at x=256, y ~ 320.
# ----------------------------------------------------------------------
def make_mouth(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    cx, cy = 256, 320
    if style == 'smile':
        thin_stroke(d, [(cx - 13, cy - 1), (cx, cy + 6), (cx + 13, cy - 1)], width=4)
    elif style == 'small':
        thin_stroke(d, [(cx - 7, cy), (cx, cy + 3), (cx + 7, cy)], width=3)
    elif style == 'open':
        rx, ry = 8 * S, 6 * S
        d.ellipse((cx * S - rx, cy * S - ry, cx * S + rx, cy * S + ry), fill=(255, 255, 255, 255), outline=INK, width=W(3))
    else:  # neutral
        d.line(((cx - 10) * S, cy * S, (cx + 10) * S, cy * S), fill=INK, width=W(4))
    save(img, f'mouth/{idx}.png')


# ----------------------------------------------------------------------
# HAIR - solid black silhouette shapes with a few fine strand lines,
# matching the reference's flat-black-shape-plus-thin-linework look.
# Anchored on cx=256, wide enough (x ~150..362) to read behind the ears.
# ----------------------------------------------------------------------
def hair_cap(d, cx, half_w, top_y, base_y, dip=10, fill=HAIR):
    """Rounded cap silhouette from crown down to the brow line."""
    pts = [
        (cx - half_w, base_y), (cx - half_w * 0.75, top_y + 4), (cx - half_w * 0.3, top_y),
        (cx, top_y - dip), (cx + half_w * 0.3, top_y), (cx + half_w * 0.75, top_y + 4),
        (cx + half_w, base_y),
        (cx + half_w * 0.6, base_y + 14), (cx, base_y + 4), (cx - half_w * 0.6, base_y + 14),
    ]
    dense = [P(x, y) for x, y in catmull_rom(pts, samples_per_seg=16, closed=True)]
    d.polygon(dense, fill=fill)
    d.line(dense + [dense[0]], fill=INK, width=W(LINE_W), joint='curve')


def strand_lines(d, cx, top_y, base_y, xs, curve=6):
    """A few thin parting/strand lines drawn over solid hair fill."""
    for x in xs:
        pts = [(cx + x, top_y), (cx + x + curve, (top_y + base_y) / 2), (cx + x, base_y)]
        dense = [P(px, py) for px, py in catmull_rom(pts, samples_per_seg=10, closed=False)]
        d.line(dense, fill=INK, width=W(2), joint='curve')


def side_lock(d, cx_side, top_y, bottom_y, width, curve=14, fill=HAIR):
    sign = 1 if cx_side > 256 else -1
    pts = [
        (cx_side - sign * width * 0.35, top_y),
        (cx_side + sign * curve, (top_y + bottom_y) / 2),
        (cx_side - sign * width * 0.15, bottom_y),
    ]
    dense = [P(x, y) for x, y in catmull_rom(pts, samples_per_seg=16, closed=False)]
    d.line(dense, fill=fill, width=W(width), joint='curve')
    r = W(width) / 2
    for x, y in (dense[0], dense[-1]):
        d.ellipse((x - r, y - r, x + r, y + r), fill=fill)
    d.line(dense, fill=INK, width=W(width + 3))
    d.line(dense, fill=fill, width=W(width - 3) if width > 6 else W(width))


def bang_fringe(d, cx, y0, y1, half_w, n=5, jag=0.3):
    pts = [(cx - half_w, y0)]
    for i in range(n + 1):
        x = cx - half_w + (2 * half_w) * i / n
        y = y1 if i % 2 == 0 else y0 + (y1 - y0) * jag
        pts.append((x, y))
    pts.append((cx + half_w, y0))
    dense = [P(x, y) for x, y in catmull_rom(pts, samples_per_seg=14, closed=True)]
    d.polygon(dense, fill=HAIR)
    d.line(dense + [dense[0]], fill=INK, width=W(3), joint='curve')


def bun(d, cx, cy, r):
    cx, cy, r = cx * S, cy * S, r * S
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=HAIR, outline=INK, width=W(LINE_W))


def braid(d, cx, top_y, bottom_y, width):
    n_seg = 6
    seg_h = (bottom_y - top_y) / n_seg
    for i in range(n_seg):
        y0 = top_y + i * seg_h
        y1 = y0 + seg_h
        r = width / 2 * (1 - i * 0.05)
        cx_i = cx + (6 if i % 2 == 0 else -6)
        d.ellipse(((cx_i - r) * S, y0 * S, (cx_i + r) * S, y1 * S), fill=HAIR, outline=INK, width=W(2.5))


def ribbon(d, cx, cy):
    cx, cy = cx * S, cy * S
    r = 7 * S
    for sx in (-1, 1):
        d.polygon([(cx, cy), (cx + sx * r, cy - r * 0.6), (cx + sx * r * 1.1, cy + r * 0.6)],
                   fill=(196, 74, 90, 255), outline=INK, width=W(2))
    rr = 2.6 * S
    d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=(196, 74, 90, 255), outline=INK, width=W(2))


HAIR_STYLES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12']


def make_hair(idx):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    cx = 256

    if idx == '1':  # short, side-swept (male)
        hair_cap(d, cx, 100, 132, 190, dip=6)
        strand_lines(d, cx, 138, 186, (-40, -14, 12, 40), curve=8)
    elif idx == '2':  # neat side part (male)
        hair_cap(d, cx, 96, 138, 188, dip=4)
        strand_lines(d, cx, 144, 186, (-30, -6, 18, 44), curve=5)
        d.line((P(cx - 2, 132)[0], P(cx - 2, 132)[1], P(cx + 30, 148)[0], P(cx + 30, 148)[1]), fill=INK, width=W(2.5))
    elif idx == '3':  # buzz cut (male)
        hair_cap(d, cx, 92, 140, 178, dip=2)
        strand_lines(d, cx, 144, 176, (-24, 0, 24), curve=3)
    elif idx == '4':  # textured crop with fringe (male)
        hair_cap(d, cx, 98, 128, 190, dip=8)
        bang_fringe(d, cx, 178, 196, 92, n=7, jag=0.45)
        strand_lines(d, cx, 136, 178, (-46, 46), curve=6)
    elif idx == '5':  # short + side fringe swept across (male)
        hair_cap(d, cx, 100, 130, 190, dip=4)
        strand_lines(d, cx, 138, 188, (-38, -12, 14, 40), curve=10)
        side_lock(d, 176, 178, 214, 10, curve=6)
    elif idx == '6':  # short with defined side part + longer sides (male)
        hair_cap(d, cx, 104, 128, 192, dip=6)
        strand_lines(d, cx, 136, 190, (-42, -18, 6, 32), curve=7)
        side_lock(d, 168, 186, 226, 12)
        side_lock(d, 344, 186, 226, 12)
    elif idx == '7':  # blunt bob with straight bangs (female)
        hair_cap(d, cx, 118, 128, 196, dip=2)
        bang_fringe(d, cx, 192, 216, 96, n=6, jag=0.3)
        side_lock(d, 156, 196, 320, 20)
        side_lock(d, 356, 196, 320, 20)
    elif idx == '8':  # bob, side-parted fringe (female)
        hair_cap(d, cx, 116, 126, 194, dip=2)
        bang_fringe(d, cx - 6, 190, 210, 88, n=5, jag=0.55)
        side_lock(d, 158, 194, 300, 18)
        side_lock(d, 354, 194, 300, 18)
    elif idx == '9':  # twin pigtails with ribbons (female)
        hair_cap(d, cx, 112, 130, 192, dip=2)
        bang_fringe(d, cx, 188, 208, 82, n=6, jag=0.35)
        side_lock(d, 168, 202, 320, 16)
        side_lock(d, 344, 202, 320, 16)
        ribbon(d, 168, 216)
        ribbon(d, 344, 216)
    elif idx == '10':  # messy bun with side fringe (female)
        hair_cap(d, cx, 114, 128, 194, dip=2)
        bang_fringe(d, cx - 4, 190, 212, 84, n=5, jag=0.5)
        side_lock(d, 160, 194, 280, 18)
        side_lock(d, 352, 194, 280, 18)
        bun(d, 256, 100, 22)
    elif idx == '11':  # two braids (female)
        hair_cap(d, cx, 112, 130, 192, dip=2)
        bang_fringe(d, cx, 188, 208, 80, n=6, jag=0.35)
        braid(d, 164, 210, 350, 20)
        braid(d, 348, 210, 350, 20)
    elif idx == '12':  # long straight, center part (female)
        hair_cap(d, cx, 116, 126, 194, dip=2)
        strand_lines(d, cx, 132, 192, (-2, 2), curve=1)
        side_lock(d, 158, 190, 380, 26)
        side_lock(d, 354, 190, 380, 26)

    save(img, f'hair/{idx}.png')


# ----------------------------------------------------------------------
# ACCESSORY (glasses) and FEATURE (freckles / mole) - thin lines, subtle.
# ----------------------------------------------------------------------
def make_accessory(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    if style == 'round':
        for cx, cy in EYE_CENTERS:
            r = 15 * S
            d.ellipse((cx * S - r, cy * S - r, cx * S + r, cy * S + r), outline=INK, width=W(3))
        d.line((P(EYE_CENTERS[0][0] + 15, 246)[0], P(EYE_CENTERS[0][0] + 15, 246)[1],
                P(EYE_CENTERS[1][0] - 15, 246)[0], P(EYE_CENTERS[1][0] - 15, 246)[1]), fill=INK, width=W(2.5))
    else:  # square
        for cx, cy in EYE_CENTERS:
            hw, hh = 15 * S, 11 * S
            d.rounded_rectangle((cx * S - hw, cy * S - hh, cx * S + hw, cy * S + hh), radius=W(3), outline=INK, width=W(3))
        d.line((P(EYE_CENTERS[0][0] + 15, 246)[0], P(EYE_CENTERS[0][0] + 15, 246)[1],
                P(EYE_CENTERS[1][0] - 15, 246)[0], P(EYE_CENTERS[1][0] - 15, 246)[1]), fill=INK, width=W(2.5))
    save(img, f'accessory/{idx}.png')


def make_feature(idx, style):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    if style == 'freckles':
        for ox, oy in ((-30, 262), (-22, 268), (-36, 270), (24, 264), (32, 270), (18, 272)):
            r = 1.6 * S
            cx, cy = (256 + ox) * S, oy * S
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(150, 100, 80, 200))
    else:  # mole
        r = 2.2 * S
        cx, cy = 272 * S, 292 * S
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(60, 40, 36, 255))
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
    for idx, style in enumerate(['curve', 'dot', 'almond', 'wide'], start=1):
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
