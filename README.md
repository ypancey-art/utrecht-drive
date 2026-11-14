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

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under the Open Database License. `npm run fetch-map` rebuilds `public/data/overvecht.json`; add `-- --refresh` to download fresh data.
