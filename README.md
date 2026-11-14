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
- Car models: [Car Kit by Kenney](https://kenney.nl/assets/car-kit), CC0.
- Trees (species and planting year): [Bomenkaart, Gemeente Utrecht](https://data.overheid.nl/dataset/utrecht-bomen), CC BY-SA 4.0.

The combined file `public/data/overvecht.json` is shared under the same terms (ODbL / CC BY-SA). `npm run fetch-map` rebuilds it from cached downloads in `scripts/cache/`; add `-- --refresh` to download fresh data.
