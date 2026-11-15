# Utrecht Drive

A browser driving game for kids set in a 3D version of Utrecht Overvecht. Players drive around, do missions, and solve math problems to unlock things. Works on phones (touch) and PCs (keyboard).

Built with Three.js, Rapier physics, TypeScript and Vite. See `PLAN.md` for the game design and `PROGRESS.md` for status.

**Play:** https://ypancey-art.github.io/utrecht-drive/

## Run

```sh
npm install
npm run dev
```

Then open http://localhost:5173. Every push to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`).

## Map data

- Streets, water, railway, parks: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), Open Database License (ODbL).
- Buildings (footprints, measured heights, roof type, year built): [3D BAG](https://3dbag.nl) by 3DGI, CC BY 4.0.
- Façade colours: measured from street photos on [Mapillary](https://www.mapillary.com) (CC BY-SA 4.0). Run `npm run fetch-facades` after `fetch-3d` with a Mapillary client token in `~/.mapillary_token` (never committed).
- Car models: "Generic passenger car pack" by [Comrade1280](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5), CC BY 4.0 (see `public/models/cars/CREDITS.txt`).
- Roof colours: aerial photo by [Beeldmateriaal Nederland via PDOK](https://www.pdok.nl), CC BY 4.0.
- Trees (species and planting year): [Bomenkaart, Gemeente Utrecht](https://data.overheid.nl/dataset/utrecht-bomen), CC BY-SA 4.0.

The combined file `public/data/overvecht.json` is shared under the same terms (ODbL / CC BY-SA). `npm run fetch-map` then `npm run fetch-3d` rebuild it from cached downloads in `scripts/cache/`; add `-- --refresh` to download fresh data.
