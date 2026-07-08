Avatar asset pipeline
=====================

1. Place the sprite sheet image here as `spritesheet.png`.
2. Run:

       python extract_sprites.py

3. The script creates:
   - `config.json`  — list of available asset IDs per category
   - `face/1.png`, `hair/1.png`, ... — individual PNG layers on a 512x512 transparent canvas

If the generated pieces are misaligned or cropped wrong, edit `layout.json`
(which is created automatically) and rerun the script. The layout uses
normalized coordinates (0..1) over the sprite sheet:

   left, top, right, bottom  — bounding box of the category region
   rows, cols                — grid inside that region (set to 0 to use auto-connected-components)

Dependencies: Python 3, Pillow, NumPy. SciPy is optional but makes extraction faster.

Layer order in the app (bottom to top):
face → ears → eyes → brows → nose → mouth → hair → accessory → feature
