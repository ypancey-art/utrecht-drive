// Real façade colours from Mapillary street photos (CC BY-SA 4.0).
// Run after fetch-3d: npm run fetch-facades   (needs a Mapillary client token in ~/.mapillary_token
// or $MAPILLARY_TOKEN; the token is only used here, never in the game).
//  -> adds `facade: [wallColour, accentColour, accentShare]` to buildings in overvecht.json
// For each building we look for photos that face one of its walls, project points on that wall into
// the photo (camera position, heading and focal length come from Mapillary), sample the pixels,
// drop sky / trees / windows, and cluster what is left. Downloads are cached in scripts/cache/mly/.
// Debug: DEBUG=<building index,...> writes marked-up photos to scripts/cache/mly-debug/.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const TOKEN = (process.env.MAPILLARY_TOKEN || (existsSync(`${homedir()}/.mapillary_token`) ? readFileSync(`${homedir()}/.mapillary_token`, 'utf8') : '')).trim();
if (!TOKEN) throw new Error('No Mapillary token: put it in ~/.mapillary_token or $MAPILLARY_TOKEN');

const DATA = 'public/data/overvecht.json';
const CACHE = 'scripts/cache/mly';
mkdirSync(CACHE, { recursive: true });
const map = JSON.parse(readFileSync(DATA, 'utf8'));
for (const b of map.buildings) delete b.facade; // safe to run again
const { lat: LAT0, lon: LON0 } = map.center;
const M_PER_LAT = 111320, M_PER_LON = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const local = (lon, lat) => [(lon - LON0) * M_PER_LON, -(lat - LAT0) * M_PER_LAT];
const CAM_H = 2.0; // camera height above the street (car roof / handheld)
const MAX_D = 40, MIN_D = 4;

// ---------------------------------------------------------------- 1. list the photos
async function api(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { Authorization: `OAuth ${TOKEN}` } });
      const j = await r.json();
      if (j.error && /reduce the amount/.test(j.error.message)) return { tooBig: true };
      if (j.error) throw new Error(j.error.message);
      return j;
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
}
const FIELDS = 'id,computed_geometry,geometry,computed_compass_angle,compass_angle,is_pano,captured_at,camera_parameters,width,height';
async function listTile(w, s, e, n, out, depth = 0) {
  const j = await api(`https://graph.mapillary.com/images?fields=${FIELDS}&bbox=${w},${s},${e},${n}&limit=2000`);
  if (j.tooBig || (j.data.length >= 2000 && depth < 4)) {
    const mx = (w + e) / 2, my = (s + n) / 2;
    for (const [a, b, c, d] of [[w, s, mx, my], [mx, s, e, my], [w, my, mx, n], [mx, my, e, n]]) await listTile(a, b, c, d, out, depth + 1);
    return;
  }
  for (const im of j.data) out.set(im.id, im);
}
const LIST = 'scripts/cache/mly-list.json';
let photos;
if (existsSync(LIST)) photos = JSON.parse(readFileSync(LIST, 'utf8'));
else {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of map.buildings) for (const [x, z] of b.pts) (minX = Math.min(minX, x)), (maxX = Math.max(maxX, x)), (minZ = Math.min(minZ, z)), (maxZ = Math.max(maxZ, z));
  const W = LON0 + (minX - MAX_D) / M_PER_LON, E = LON0 + (maxX + MAX_D) / M_PER_LON;
  const N = LAT0 - (minZ - MAX_D) / M_PER_LAT, S = LAT0 - (maxZ + MAX_D) / M_PER_LAT;
  const out = new Map();
  const DX = 0.004, DY = 0.0025;
  const jobs = [];
  for (let x = W; x < E; x += DX) for (let y = S; y < N; y += DY) jobs.push([x, y, Math.min(E, x + DX), Math.min(N, y + DY)]);
  let done = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (jobs.length) {
      const [w, s, e, n] = jobs.pop();
      await listTile(+w.toFixed(6), +s.toFixed(6), +e.toFixed(6), +n.toFixed(6), out);
      process.stdout.write(`\rlisting photos: ${++done} tiles, ${out.size} photos`);
    }
  }));
  console.log();
  photos = [...out.values()].map((im) => {
    const [lon, lat] = (im.computed_geometry ?? im.geometry).coordinates;
    const [x, z] = local(lon, lat);
    return {
      id: im.id, x: +x.toFixed(2), z: +z.toFixed(2),
      heading: im.computed_compass_angle ?? im.compass_angle,
      pano: !!im.is_pano, t: im.captured_at,
      focal: im.camera_parameters?.[0] ?? 0, w: im.width, h: im.height,
    };
  });
  writeFileSync(LIST, JSON.stringify(photos));
}
// Usable: known heading; perspective photos need a focal length; skip very old ones.
photos = photos.filter((p) => p.heading != null && (p.pano || p.focal > 0.3) && p.t > Date.UTC(2014, 0));
console.log(`${photos.length} usable photos`);

// ---------------------------------------------------------------- 2. geometry helpers
const CELL = 25;
const grid = (items, keyOf) => {
  const g = new Map();
  items.forEach((it, i) => { for (const k of keyOf(it)) (g.get(k) ?? g.set(k, []).get(k)).push(i); });
  return g;
};
const ck = (cx, cz) => `${cx},${cz}`;
const bboxes = map.buildings.map((b) => {
  let a = Infinity, c = -Infinity, d = Infinity, e = -Infinity;
  for (const [x, z] of b.pts) (a = Math.min(a, x)), (c = Math.max(c, x)), (d = Math.min(d, z)), (e = Math.max(e, z));
  return [a, d, c, e];
});
const bgrid = grid(map.buildings, (b) => {
  const i = map.buildings.indexOf(b);
  const [x0, z0, x1, z1] = bboxes[i];
  const ks = [];
  for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) ks.push(ck(cx, cz));
  return ks;
});
const pgrid = grid(photos, (p) => [ck(Math.floor(p.x / CELL), Math.floor(p.z / CELL))]);
const inside = (x, z, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const inAnyBuilding = (x, z) => {
  for (const i of bgrid.get(ck(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
    const [x0, z0, x1, z1] = bboxes[i];
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1 && inside(x, z, map.buildings[i].pts)) return true;
  }
  return false;
};
// Line of sight at street level from the camera to a point just in front of the wall.
const clear = (cx, cz, tx, tz) => {
  const d = Math.hypot(tx - cx, tz - cz);
  for (let s = 0.5; s < d - 0.6; s += 1.2) if (inAnyBuilding(cx + ((tx - cx) * s) / d, cz + ((tz - cz) * s) / d)) return false;
  return true;
};
const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return a / 2;
};
// Where a world point lands in a photo of size (W, H); null if behind or outside.
function project(p, x, y, z, W, H) {
  const hr = (p.heading * Math.PI) / 180;
  const fx = Math.sin(hr), fz = -Math.cos(hr); // forward (x east, z south)
  const rx = -fz, rz = fx; // right
  const dx = x - p.x, dz = z - p.z, dy = y - CAM_H;
  const along = dx * fx + dz * fz, side = dx * rx + dz * rz;
  if (p.pano) {
    const a = Math.atan2(side, along), e = Math.atan2(dy, Math.hypot(dx, dz));
    return [W * (0.5 + a / (2 * Math.PI)), H * (0.5 - e / Math.PI)];
  }
  if (along < 1) return null;
  const f = p.focal * Math.max(W, H);
  // OpenSfM camera models: perspective (radial k1, k2) or fisheye (equidistant + k1, k2).
  const xn = side / along, yn = dy / along, r = Math.hypot(xn, yn);
  const [k1, k2] = p.k ?? [0, 0];
  let scale;
  if (p.fisheye) {
    const th = Math.atan(r);
    scale = r > 1e-6 ? (th * (1 + k1 * th * th + k2 * th ** 4)) / r : 1;
  } else scale = 1 + k1 * r * r + k2 * r ** 4;
  const u = W / 2 + f * scale * xn, v = H / 2 - f * scale * yn;
  return u >= 1 && u < W - 1 && v >= 1 && v < H - 1 ? [u, v] : null;
}

// ---------------------------------------------------------------- 3. pick photos per building
const now = Date.now();
const plans = []; // [buildingIndex, [{photo, edge}...]]
map.buildings.forEach((b, bi) => {
  const pts = b.pts;
  const ccw = signedArea(pts) > 0; // in x-east/z-south coordinates
  const [x0, z0, x1, z1] = bboxes[bi];
  const cands = [];
  const near = new Set();
  for (let cx = Math.floor((x0 - MAX_D) / CELL); cx <= Math.floor((x1 + MAX_D) / CELL); cx++)
    for (let cz = Math.floor((z0 - MAX_D) / CELL); cz <= Math.floor((z1 + MAX_D) / CELL); cz++)
      for (const i of pgrid.get(ck(cx, cz)) ?? []) near.add(i);
  for (let e = 0; e < pts.length - 1; e++) {
    const [ax, az] = pts[e], [bx, bz] = pts[e + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 4) continue;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    // Outward normal: right of the edge for a counter-clockwise ring in this frame.
    const nx = ccw ? uz : -uz, nz = ccw ? -ux : ux;
    const mx = (ax + bx) / 2 + nx * 0.4, mz = (az + bz) / 2 + nz * 0.4;
    if (inAnyBuilding(mx + nx * 0.6, mz + nz * 0.6)) continue; // party wall
    for (const pi of near) {
      const p = photos[pi];
      const dx = p.x - mx, dz = p.z - mz, d = Math.hypot(dx, dz);
      if (d < MIN_D || d > MAX_D) continue;
      const facing = (dx * nx + dz * nz) / d; // 1 = straight in front of the wall
      if (facing < 0.35) continue;
      if (!project(p, mx, 4, mz, p.pano ? 2 : p.w, p.pano ? 1 : p.h)) continue;
      const age = (now - p.t) / (365 * 864e5);
      const score = facing * Math.min(1, len / 10) * (1 / (1 + d / 15)) * (p.pano ? 0.6 : 1) * (age < 4 ? 1 : age < 8 ? 0.8 : 0.6);
      cands.push({ pi, e, score });
    }
  }
  cands.sort((a, c) => c.score - a.score);
  const pick = [];
  for (const c of cands) {
    if (pick.length >= 4) break;
    if (pick.some((q) => q.pi === c.pi)) continue;
    const p = photos[c.pi];
    const [ax, az] = pts[c.e], [bx, bz] = pts[c.e + 1];
    if (!clear(p.x, p.z, (ax + bx) / 2 + (bz - az) * 0, (az + bz) / 2) && !clear(p.x, p.z, ax + (bx - ax) * 0.3, az + (bz - az) * 0.3)) continue;
    pick.push(c);
  }
  if (pick.length) plans.push([bi, pick]);
});
const needed = new Set(plans.flatMap(([, ps]) => ps.map((c) => photos[c.pi].id)));
console.log(`${plans.length} of ${map.buildings.length} buildings have photos; ${needed.size} photos to fetch`);

// ---------------------------------------------------------------- 4. download + decode thumbnails
const byId = new Map(photos.map((p) => [p.id, p]));
const missing = [...needed].filter((id) => !existsSync(`${CACHE}/${id}.bmp`));
let got = 0;
const batches = [];
for (let i = 0; i < missing.length; i += 50) batches.push(missing.slice(i, i + 50));
await Promise.all(Array.from({ length: 6 }, async () => {
  while (batches.length) {
    const ids = batches.pop();
    const j = await api(`https://graph.mapillary.com/?ids=${ids.join(',')}&fields=thumb_256_url,thumb_1024_url`);
    for (const id of ids) {
      const url = byId.get(id).pano ? j[id]?.thumb_1024_url : j[id]?.thumb_256_url;
      if (!url) continue;
      try {
        const r = await fetch(url);
        if (r.ok) writeFileSync(`${CACHE}/${id}.jpg`, Buffer.from(await r.arrayBuffer()));
      } catch { /* skip this one */ }
      got++;
    }
    process.stdout.write(`\rdownloading: ${got}/${missing.length}`);
  }
}));
if (missing.length) console.log();
// Decode all new JPEGs to BMP in batches with macOS sips.
const jpgs = readdirSync(CACHE).filter((f) => f.endsWith('.jpg') && !existsSync(`${CACHE}/${f.replace('.jpg', '.bmp')}`));
for (let i = 0; i < jpgs.length; i += 200) {
  try {
    execFileSync('sips', ['-s', 'format', 'bmp', ...jpgs.slice(i, i + 200).map((f) => `${CACHE}/${f}`), '--out', CACHE], { stdio: 'ignore' });
  } catch { /* individual broken files are skipped below */ }
  process.stdout.write(`\rdecoding: ${Math.min(i + 200, jpgs.length)}/${jpgs.length}`);
}
if (jpgs.length) console.log();

// Camera model per photo (fisheye or not, lens distortion).
const META = 'scripts/cache/mly-meta.json';
const meta = existsSync(META) ? JSON.parse(readFileSync(META, 'utf8')) : {};
const noMeta = [...needed].filter((id) => !meta[id]);
for (let i = 0; i < noMeta.length; i += 50) {
  const ids = noMeta.slice(i, i + 50);
  const j = await api(`https://graph.mapillary.com/?ids=${ids.join(',')}&fields=camera_type,camera_parameters`);
  for (const id of ids) meta[id] = { type: j[id]?.camera_type ?? 'perspective', k: (j[id]?.camera_parameters ?? []).slice(1, 3) };
  process.stdout.write(`\rcamera models: ${Math.min(i + 50, noMeta.length)}/${noMeta.length}`);
}
if (noMeta.length) console.log();
writeFileSync(META, JSON.stringify(meta));
for (const id of needed) {
  const p = byId.get(id), m = meta[id];
  if (!m) continue;
  p.fisheye = m.type === 'fisheye';
  p.k = m.k.length === 2 ? m.k : [0, 0];
}

function readBmp(file) {
  const b = readFileSync(file);
  const off = b.readUInt32LE(10), w = b.readInt32LE(18), h = b.readInt32LE(22), bpp = b.readUInt16LE(28) / 8;
  const rowLen = Math.ceil((w * bpp) / 4) * 4;
  const H = Math.abs(h);
  const o = (x, y) => off + (h > 0 ? H - 1 - y : y) * rowLen + x * bpp;
  return { w, h: H, buf: b, at: (x, y) => { const i = o(x, y); return [b[i + 2], b[i + 1], b[i]]; }, set: (x, y, c) => { const i = o(x, y); [b[i + 2], b[i + 1], b[i]] = c; } };
}

// ---------------------------------------------------------------- 5. sample + cluster
const isWall = ([r, g, b]) => {
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  if (lum < 28) return false; // window glass, deep shadow
  if (g > r + 4 && g > b + 2) return false; // trees, hedges, grass
  if (b > r + 12 && b > g && lum > 120) return false; // sky
  if (lum > 245) return false; // blown-out sky
  return true;
};
function kmeans(samples, k = 3) {
  if (samples.length < k) return [];
  // Farthest-point init.
  const cs = [samples[Math.floor(samples.length / 2)].slice()];
  while (cs.length < k) {
    let best = null, bd = -1;
    for (const s of samples) {
      const d = Math.min(...cs.map((c) => (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 + (c[2] - s[2]) ** 2));
      if (d > bd) (bd = d), (best = s);
    }
    cs.push(best.slice());
  }
  let counts = [];
  for (let it = 0; it < 12; it++) {
    const sum = cs.map(() => [0, 0, 0]);
    counts = cs.map(() => 0);
    for (const s of samples) {
      let bi = 0, bd = Infinity;
      cs.forEach((c, i) => { const d = (c[0] - s[0]) ** 2 + (c[1] - s[1]) ** 2 + (c[2] - s[2]) ** 2; if (d < bd) (bd = d), (bi = i); });
      sum[bi][0] += s[0]; sum[bi][1] += s[1]; sum[bi][2] += s[2]; counts[bi]++;
    }
    cs.forEach((c, i) => { if (counts[i]) for (let j = 0; j < 3; j++) c[j] = sum[i][j] / counts[i]; });
  }
  return cs.map((c, i) => ({ c, n: counts[i] })).filter((x) => x.n).sort((a, b) => b.n - a.n);
}
const hex = (c) => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);
const DEBUG = new Set((process.env.DEBUG ?? '').split(',').filter(Boolean).map(Number));
if (DEBUG.size) mkdirSync('scripts/cache/mly-debug', { recursive: true });

let coloured = 0;
for (const [bi, pick] of plans) {
  const b = map.buildings[bi];
  const top = Math.min(b.eave ?? b.h * 0.85, 14);
  if (top < 1.6) continue;
  const samples = [];
  for (const { pi, e } of pick) {
    const p = photos[pi];
    const file = `${CACHE}/${p.id}.bmp`;
    if (!existsSync(file)) continue;
    let img;
    try { img = readBmp(file); } catch { continue; }
    const [ax, az] = b.pts[e], [bx, bz] = b.pts[e + 1];
    const mine = [], marks = [];
    for (let t = 0.12; t <= 0.88; t += 0.08)
      for (let y = 1.2; y <= top; y += Math.max(0.5, (top - 1.2) / 10)) {
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const uv = project(p, x, y, z, img.w, img.h);
        if (!uv) continue;
        // Skip points whose ray hits another building first (rough check at street level).
        const [u, v] = uv.map(Math.floor);
        for (const [du, dv] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
          if (u + du < 0 || v + dv < 0 || u + du >= img.w || v + dv >= img.h) continue;
          const c = img.at(u + du, v + dv);
          if (isWall(c)) mine.push(c);
        }
        if (DEBUG.has(bi)) marks.push([u, v]);
      }
    if (DEBUG.has(bi)) {
      for (const [u, v] of marks) img.set(u, v, [255, 0, 255]);
      writeFileSync(`scripts/cache/mly-debug/b${bi}-${p.id}.bmp`, img.buf);
      execFileSync('sips', ['-s', 'format', 'png', `scripts/cache/mly-debug/b${bi}-${p.id}.bmp`, '--out', `scripts/cache/mly-debug/b${bi}-${p.id}.png`], { stdio: 'ignore' });
    }
    // Each photo counts equally, however many pixels it gave.
    const step = Math.max(1, Math.floor(mine.length / 120));
    for (let i = 0; i < mine.length; i += step) samples.push(mine[i]);
  }
  if (samples.length < 30) continue;
  const cl = kmeans(samples, 3);
  if (!cl.length) continue;
  // Dark clusters are windows or shade: the wall is the biggest cluster that is not dark.
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const lit = cl.filter((x) => lum(x.c) >= 60 && x.n >= samples.length * 0.18);
  const wall = lit[0] ?? cl[0], accent = cl.find((x) => x !== wall) ?? wall;
  b.facade = [hex(wall.c), hex(accent.c), +(accent.n / samples.length).toFixed(2)];
  if (DEBUG.has(bi)) console.log(`building ${bi}: year ${b.year} h ${b.h}`, cl.map((x) => `#${hex(x.c).toString(16).padStart(6, '0')} x${x.n}`).join('  '));
  coloured++;
}
console.log(`${coloured} buildings got a façade colour from photos`);
writeFileSync(DATA, JSON.stringify(map));
