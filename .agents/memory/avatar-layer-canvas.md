---
name: Avatar layer canvas system
description: How img/avatar/* sprite layers must be positioned for the avatar editor's compositing to work
---

The avatar editor (index.html, `.avatar-layer` CSS + `renderAvatar`) stacks one PNG per
category (face, ears, eyes, brows, nose, mouth, hair, accessory, feature) as absolutely
positioned `<img>` elements at `width:100%; height:100%; object-fit:contain` inside a
circular `.avatar-stack` container.

This means every category's PNGs **must** already be full 512x512 transparent canvases
with the artwork positioned/scaled correctly relative to the other categories — there is
no per-layer offset/scale metadata in the app.

**Why:** the whole asset set is now generated procedurally by
`img/avatar/generate_avatar_assets.py` (PIL, clean bold line-art, no external sprite
sheet), which draws every category directly onto shared anchor coordinates (face midline
x=256, eyes at (212,250)/(300,250), brows y~224, nose ~260-300, mouth ~322, ears
x~146/366). Any raster sprite-sheet extraction pipeline previously used for this is gone.

**How to apply:** when adding/editing avatar styles, edit the shape/style definitions
inside `generate_avatar_assets.py` (FACE_SHAPES, EAR_SPECS, make_hair, etc.) and rerun it
— don't hand-place PNGs. Remember every draw call must scale its coordinates by the
module's `S` supersampling factor (`x * S`), and closed vs. open Catmull-Rom splines need
different endpoint handling — both were previously a source of stray-dot/misplacement
bugs (unscaled coordinates, open-curve wraparound overshoot).
