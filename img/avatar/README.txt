Avatar asset pipeline
=====================

All avatar layers (face, ears, eyes, brows, nose, mouth, hair, accessory,
feature) are generated programmatically by `generate_avatar_assets.py`
using PIL — clean, bold "character creator" line art in a consistent
style, always drawn directly onto the shared 512x512 canvas.

Run from img/avatar/:

    python3 generate_avatar_assets.py

This regenerates every PNG in every category folder and rewrites
config.json with the resulting id lists. There is no external sprite
sheet to source from anymore — edit the shape/style definitions inside
the script (FACE_SHAPES, EAR_SPECS, hair style branches in make_hair,
etc.) and rerun.

Canvas coordinate system (512x512, all categories share it so the app's
layer stack — position:absolute, 100% width/height — lines up correctly):
  - face midline: x = 256
  - eyes centered at (212, 250) and (300, 250)
  - brows at y ~ 224, nose ~ 260-300, mouth ~ 322
  - ears at x ~ 146 / 366, y ~ 258
  - hair anchored from y ~ 92 (crown) down, wide enough to read behind
    the ears regardless of face shape

Layer order in the app (bottom to top):
face → ears → eyes → brows → nose → mouth → hair → accessory → feature
