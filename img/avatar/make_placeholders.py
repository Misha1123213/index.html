import json
import os
from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.abspath(__file__))
SIZE = 512


def new_canvas():
    return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))


def center_box(cx, cy, w, h):
    return (cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)


def save(cat, idx, img):
    d = os.path.join(BASE, cat)
    os.makedirs(d, exist_ok=True)
    img.save(os.path.join(d, f'{idx}.png'))


config = {}

# --- Face shapes (3 skin tones) ---
for i, color in enumerate(['#f6d7b8', '#e8c39e', '#8d5524'], 1):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    d.ellipse(center_box(256, 270, 280, 300), fill=color)
    save('face', i, img)
config['face'] = ['1', '2', '3']

# --- Ears (matching skin tones) ---
for i, color in enumerate(['#f6d7b8', '#e8c39e', '#8d5524'], 1):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    d.ellipse((60, 240, 110, 310), fill=color)
    d.ellipse((402, 240, 452, 310), fill=color)
    save('ears', i, img)
config['ears'] = ['1', '2', '3']

# --- Eyes (3 styles) ---
def eyes_dots(d):
    d.ellipse(center_box(210, 250, 24, 32), fill='#222')
    d.ellipse(center_box(302, 250, 24, 32), fill='#222')


def eyes_open(d):
    d.ellipse(center_box(210, 250, 28, 36), fill='#fff')
    d.ellipse(center_box(302, 250, 28, 36), fill='#fff')
    d.ellipse(center_box(210, 250, 14, 20), fill='#222')
    d.ellipse(center_box(302, 250, 14, 20), fill='#222')


def eyes_line(d):
    d.line((198, 260, 222, 260), fill='#222', width=4)
    d.line((290, 260, 314, 260), fill='#222', width=4)


for i, draw in enumerate([eyes_dots, eyes_open, eyes_line], 1):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    draw(d)
    save('eyes', i, img)
config['eyes'] = ['1', '2', '3']

# --- Brows (3 styles) ---
def brows_straight(d):
    d.line((190, 230, 230, 230), fill='#4a3b2a', width=5)
    d.line((282, 230, 322, 230), fill='#4a3b2a', width=5)


def brows_arched(d):
    d.arc(center_box(210, 230, 40, 20), 0, 180, fill='#4a3b2a', width=5)
    d.arc(center_box(302, 230, 40, 20), 0, 180, fill='#4a3b2a', width=5)


def brows_angry(d):
    d.line((190, 230, 230, 222), fill='#4a3b2a', width=5)
    d.line((282, 222, 322, 230), fill='#4a3b2a', width=5)


for i, draw in enumerate([brows_straight, brows_arched, brows_angry], 1):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    draw(d)
    save('brows', i, img)
config['brows'] = ['1', '2', '3']

# --- Nose (3 styles) ---
def nose_round(d):
    d.ellipse(center_box(256, 300, 24, 28), fill='#d8b58b')


def nose_triangle(d):
    d.polygon([(256, 285), (270, 315), (242, 315)], fill='#d8b58b')


def nose_line(d):
    d.line((256, 285, 256, 320), fill='#d8b58b', width=6)


for i, draw in enumerate([nose_round, nose_triangle, nose_line], 1):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    draw(d)
    save('nose', i, img)
config['nose'] = ['1', '2', '3']

# --- Mouth (3 styles) ---
def mouth_smile(d):
    d.arc(center_box(256, 315, 60, 40), 0, 180, fill='#a33', width=5)


def mouth_o(d):
    d.ellipse(center_box(256, 325, 14, 14), fill='#a33')


def mouth_flat(d):
    d.line((226, 330, 286, 330), fill='#a33', width=5)


for i, draw in enumerate([mouth_smile, mouth_o, mouth_flat], 1):
    img = new_canvas()
    d = ImageDraw.Draw(img)
    draw(d)
    save('mouth', i, img)
config['mouth'] = ['1', '2', '3']

# --- Hair (3 styles) ---
img = new_canvas()
d = ImageDraw.Draw(img)
d.arc(center_box(256, 270, 320, 300), 180, 360, fill='#4a3b2a', width=28)
save('hair', 1, img)

img = new_canvas()
d = ImageDraw.Draw(img)
d.pieslice(center_box(256, 270, 320, 300), 180, 360, fill='#4a3b2a')
for y in range(120, 180, 12):
    d.line((120 + (y - 120) // 2, y, 130 + (y - 120) // 2, y - 8), fill='#4a3b2a', width=3)
    d.line((392 - (y - 120) // 2, y, 382 - (y - 120) // 2, y - 8), fill='#4a3b2a', width=3)
save('hair', 2, img)

img = new_canvas()
d = ImageDraw.Draw(img)
d.arc(center_box(256, 270, 300, 260), 200, 340, fill='#d4a017', width=24)
save('hair', 3, img)
config['hair'] = ['1', '2', '3']

# --- Accessories: glasses + empty ---
img = new_canvas()
d = ImageDraw.Draw(img)
d.rounded_rectangle(center_box(256, 260, 90, 40), radius=10, outline='#333', width=6)
d.line((206, 260, 306, 260), fill='#333', width=6)
save('accessory', 1, img)

img = new_canvas()
save('accessory', 2, img)
config['accessory'] = ['1', '2']

# --- Features: blush + empty ---
img = new_canvas()
d = ImageDraw.Draw(img)
d.ellipse(center_box(180, 290, 28, 16), fill=(255, 120, 120, 120))
d.ellipse(center_box(332, 290, 28, 16), fill=(255, 120, 120, 120))
save('feature', 1, img)

img = new_canvas()
save('feature', 2, img)
config['feature'] = ['1', '2']

# --- Write config ---
with open(os.path.join(BASE, 'config.json'), 'w', encoding='utf-8') as f:
    json.dump(config, f, ensure_ascii=False, indent=2)

print('Placeholder avatar assets generated:', config)
