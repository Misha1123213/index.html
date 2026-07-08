import json
import os
import sys
import numpy as np
from PIL import Image

try:
    from scipy import ndimage
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

# Default layout is based on the provided sprite sheet.
# Coordinates are normalized [0..1] over the source image.
# The sheet is roughly divided into three vertical columns:
#   left: face shapes / features / ears / accessories
#   middle: hairstyles
#   right: eyes / brows / noses / mouths
# Adjust this if your sprite sheet is cropped differently.
DEFAULT_LAYOUT = {
    "canvas_size": 512,
    "skip_text_height": 0.06,
    "categories": {
        "face":      {"left": 0.00, "top": 0.06, "right": 0.33, "bottom": 0.23, "rows": 3, "cols": 3},
        "feature":   {"left": 0.00, "top": 0.23, "right": 0.33, "bottom": 0.36, "rows": 2, "cols": 4},
        "ears":      {"left": 0.00, "top": 0.36, "right": 0.33, "bottom": 0.45, "rows": 1, "cols": 4},
        "accessory": {"left": 0.00, "top": 0.45, "right": 0.33, "bottom": 0.62, "rows": 3, "cols": 3},
        "hair":      {"left": 0.33, "top": 0.06, "right": 0.66, "bottom": 0.62, "rows": 5, "cols": 3},
        "eyes":      {"left": 0.66, "top": 0.06, "right": 1.00, "bottom": 0.28, "rows": 3, "cols": 3},
        "brows":     {"left": 0.66, "top": 0.28, "right": 1.00, "bottom": 0.40, "rows": 2, "cols": 3},
        "nose":      {"left": 0.66, "top": 0.40, "right": 1.00, "bottom": 0.52, "rows": 2, "cols": 3},
        "mouth":     {"left": 0.66, "top": 0.52, "right": 1.00, "bottom": 0.65, "rows": 2, "cols": 3}
    }
}


def label_manual(mask):
    """Fallback connected-component labelling without scipy."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=int)
    current = 0
    for y in range(h):
        for x in range(w):
            if mask[y, x] and labels[y, x] == 0:
                current += 1
                stack = [(y, x)]
                labels[y, x] = current
                while stack:
                    cy, cx = stack.pop()
                    for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and labels[ny, nx] == 0:
                            labels[ny, nx] = current
                            stack.append((ny, nx))
    return labels, current


def extract_components(region_mask, region_img, canvas):
    """Extract dark connected components from a region and center them on canvas."""
    labels, num = (ndimage.label(region_mask) if HAS_SCIPY else label_manual(region_mask))
    sprites = []
    for i in range(1, num + 1):
        ys, xs = np.where(labels == i)
        if len(xs) == 0:
            continue
        # skip tiny noise / text strokes
        if len(xs) < 20:
            continue
        x1, y1 = int(xs.min()), int(ys.min())
        x2, y2 = int(xs.max()) + 1, int(ys.max()) + 1
        pad = 4
        x1 = max(0, x1 - pad)
        y1 = max(0, y1 - pad)
        x2 = min(region_img.width, x2 + pad)
        y2 = min(region_img.height, y2 + pad)
        sprite = region_img.crop((x1, y1, x2, y2))
        out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
        sx, sy = sprite.size
        out.paste(sprite, ((canvas - sx) // 2, (canvas - sy) // 2), sprite)
        sprites.append(out)
    return sprites


def grid_extract(region_mask, region_img, rows, cols, canvas):
    """Alternative: split region into a regular grid and take each cell's content."""
    h, w = region_mask.shape
    cell_h = h / rows
    cell_w = w / cols
    sprites = []
    for r in range(rows):
        for c in range(cols):
            x1 = int(c * cell_w)
            y1 = int(r * cell_h)
            x2 = int((c + 1) * cell_w) if c < cols - 1 else w
            y2 = int((r + 1) * cell_h) if r < rows - 1 else h
            cell_mask = region_mask[y1:y2, x1:x2]
            ys, xs = np.where(cell_mask)
            if len(xs) == 0:
                sprites.append(None)
                continue
            cx1, cy1 = int(xs.min()), int(ys.min())
            cx2, cy2 = int(xs.max()) + 1, int(ys.max()) + 1
            pad = 2
            cx1 = max(0, cx1 - pad)
            cy1 = max(0, cy1 - pad)
            cx2 = min(cell_mask.shape[1], cx2 + pad)
            cy2 = min(cell_mask.shape[0], cy2 + pad)
            sprite = region_img.crop((x1 + cx1, y1 + cy1, x1 + cx2, y1 + cy2))
            out = Image.new('RGBA', (canvas, canvas), (0, 0, 0, 0))
            sx, sy = sprite.size
            out.paste(sprite, ((canvas - sx) // 2, (canvas - sy) // 2), sprite)
            sprites.append(out)
    return [s for s in sprites if s is not None]


def main():
    base = os.path.dirname(os.path.abspath(__file__))
    img_path = os.path.join(base, 'spritesheet.png')
    if not os.path.exists(img_path):
        print(f"Please place the sprite sheet image at: {img_path}")
        sys.exit(1)

    img = Image.open(img_path).convert('RGBA')
    w, h = img.size
    arr = np.array(img)
    gray = arr[:, :, 0] * 0.299 + arr[:, :, 1] * 0.587 + arr[:, :, 2] * 0.114
    alpha = arr[:, :, 3]
    # dark pixels with some alpha: the black line art
    mask = (gray < 120) & (alpha > 128)

    layout_path = os.path.join(base, 'layout.json')
    if os.path.exists(layout_path):
        with open(layout_path, encoding='utf-8') as f:
            layout = json.load(f)
    else:
        layout = DEFAULT_LAYOUT
        with open(layout_path, 'w', encoding='utf-8') as f:
            json.dump(layout, f, ensure_ascii=False, indent=2)
        print(f"Created default layout.json. Adjust it if extraction looks wrong, then rerun.")

    canvas = int(layout.get('canvas_size', 512))
    config = {}

    for cat, spec in layout['categories'].items():
        cat_dir = os.path.join(base, cat)
        os.makedirs(cat_dir, exist_ok=True)
        for old in os.listdir(cat_dir):
            if old.endswith('.png'):
                os.remove(os.path.join(cat_dir, old))

        x1 = int(spec['left'] * w)
        y1 = int(spec['top'] * h)
        x2 = int(spec['right'] * w)
        y2 = int(spec['bottom'] * h)
        region_mask = mask[y1:y2, x1:x2]
        region_img = img.crop((x1, y1, x2, y2))

        rows = spec.get('rows', 0)
        cols = spec.get('cols', 0)
        if rows > 0 and cols > 0:
            sprites = grid_extract(region_mask, region_img, rows, cols, canvas)
        else:
            sprites = extract_components(region_mask, region_img, canvas)

        ids = []
        for idx, sprite in enumerate(sprites, start=1):
            sprite.save(os.path.join(cat_dir, f'{idx}.png'))
            ids.append(str(idx))
        config[cat] = ids
        print(f"{cat}: {len(ids)} sprites")

    config_path = os.path.join(base, 'config.json')
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print(f"\nDone. Generated {config_path}")


if __name__ == '__main__':
    main()
