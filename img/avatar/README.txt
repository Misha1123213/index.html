Avatar assets
=============

PNG character-creator sprites for the MET Academy avatar system.

Layout
------
- All sprites share a 1024x1024 transparent canvas.
- Each sprite is drawn at the same scale and centered, so the app can stack
  layers with `position: absolute; width: 100%; height: 100%; object-fit: contain`.
- Layer order is defined in `manifest.json`:
  face -> ears -> eyes -> brows -> nose -> mouth -> hair -> accessory -> feature

Files
-----
- `manifest.json` — shared canvas size, anchors, skin-tone filter template,
  and the list of available items per layer.
- `config.json` — fallback flat list of ids per layer.
- `face/` — 5 neutral-grey face bases (`skin_neutral_*`).
- `eyes/` — 5 eye layers.
- `nose/` — 3 nose layers.
- `mouth/` — 5 mouth layers.
- `hair/` — 5 hairstyle layers.

Skin tone
---------
Face sprites are intentionally neutral grey. The app applies a CSS filter
from `manifest.json`/`skinTone.filterTemplate` to tint the face into the
selected skin tone. The default tone is warm sepia-brown.

Adding new parts
----------------
1. Draw the new sprite on the same 1024x1024 canvas with the same centering.
2. Place it in the appropriate folder.
3. Add the item `{id, name, file}` to `manifest.json` under the right layer.
4. (Optional) add the id to `config.json`.
