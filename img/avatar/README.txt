Avatar assets
=============

The PNGs in these category folders (face, ears, eyes, brows, nose, mouth,
hair, accessory, feature) are the real hand-drawn character-creator
sprites provided by the project owner. Each source sprite was composited
onto a shared 128x142 canvas at a fixed anchor per layer, so every PNG has
identical dimensions and the app's layer stack (position: absolute, 100%
width/height, object-fit: contain) lines them up regardless of which
options are combined.

config.json lists the available ids per layer and the app reads it at
runtime (loadAvatarConfig).

Layer order in the app (bottom to top):
face → ears → eyes → brows → nose → mouth → hair → accessory → feature

accessory and feature are optional (the editor shows a "Нет" / none tile).

WARNING: generate_avatar_assets.py is the OLD placeholder generator. It
draws programmatic line-art and, if run, will OVERWRITE these real sprites
and rewrite config.json. Do NOT run it unless you intend to discard the
real artwork. It is kept only for reference.
