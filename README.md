# MET Академия — Café Menu

Static single-page café menu site (`index.html` + JSON data files for dishes, drinks, desserts). Originally deployed on Netlify (`netlify.toml`); on Replit it runs via a small static file server.

## Running on Replit

The "Start application" workflow runs `python3 server.py`, which serves the project's static files on port 5000 with caching disabled for easier development.

## Data files

- `dishes.json`, `drinks.json`, `desserts.json`, `drink_pf.json`, `kitchen_pf.json` — menu content consumed by `index.html`.
- `img/` — images.
