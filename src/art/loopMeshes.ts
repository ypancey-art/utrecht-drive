// Loops and Hot Wheels tracks: an orange toy-car track with yellow side walls, on grey posts.
// Where a track drives through a building there is a dark tunnel with lights inside, and a
// dark opening in the wall where it goes in and comes out.
import * as THREE from 'three';
import type { Building, Loop, Track } from '../game/mapData';
import { loopSections, stripGeometry, trackSections, trackPosts, LOOP_W, type Section } from '../game/loops';

let mats: Record<'track' | 'wall' | 'post' | 'tunnel' | 'light' | 'hole', THREE.Material> | null = null;
function materials() {
  return (mats ??= {
    track: new THREE.MeshLambertMaterial({ color: 0xff6a00, side: THREE.DoubleSide }),
    wall: new THREE.MeshLambertMaterial({ color: 0xffd21f, side: THREE.DoubleSide }),
    post: new THREE.MeshLambertMaterial({ color: 0x9aa3ab }),
    tunnel: new THREE.MeshLambertMaterial({ color: 0x2b2f36, side: THREE.DoubleSide }),
    light: new THREE.MeshBasicMaterial({ color: 0xfff1b0 }),
    hole: new THREE.MeshBasicMaterial({ color: 0x15171b, side: THREE.DoubleSide }),
  });
}

function mesh(P: number[], I: number[], mat: THREE.Material, shadows = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = shadows;
  return m;
}

/** Road, walls and a thicker underside for one strip of sections. */
function strip(group: THREE.Group, secs: Section[]) {
  const m = materials();
  const { pos, road, walls } = stripGeometry(secs);
  const under: number[] = [];
  const hw = LOOP_W / 2 + 0.05;
  for (const { p, side, up } of secs)
    for (const a of [-hw, hw]) under.push(p[0] + side[0] * a - up[0] * 0.25, p[1] + side[1] * a - up[1] * 0.25, p[2] + side[2] * a - up[2] * 0.25);
  const uIdx: number[] = [];
  for (let i = 0; i < secs.length - 1; i++) {
    const a = i * 2, b = a + 2;
    uIdx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  group.add(mesh(pos, road, m.track), mesh(pos, walls, m.wall), mesh(under, uIdx, m.track));
}

function posts(group: THREE.Group, list: { x: number; z: number; h: number }[]) {
  const m = materials();
  for (const p of list) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, p.h, 8), m.post);
    post.position.set(p.x, p.h / 2, p.z);
    post.castShadow = true;
    group.add(post);
  }
}

/** Loops standing on the ground (with their own posts and a beam over the top). */
export function buildLoops(loops: Loop[]): THREE.Group {
  const group = new THREE.Group();
  for (const l of loops) {
    strip(group, loopSections(l));
    const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
    const top = (l.y ?? 0) + l.r * 2;
    const list = [];
    for (const v of [-LOOP_W / 2 - 0.9, l.d + LOOP_W / 2 + 0.9]) for (const u of [-0.6, 0.6]) list.push({ x: l.x + c * u - s * v, z: l.z + s * u + c * v, h: top });
    posts(group, list);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, l.d + LOOP_W + 1.8), materials().post);
    beam.position.set(l.x - s * (l.d / 2), top + 0.45, l.z + c * (l.d / 2));
    beam.rotation.y = -l.yaw;
    beam.castShadow = true;
    group.add(beam);
  }
  return group;
}

const inside = (pts: [number, number][], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    if (pts[i][1] > z !== pts[j][1] > z && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) c = !c;
  return c;
};

/** A whole track: pieces, posts, tunnels and wall openings. `postOk` says where posts may stand. */
export function buildTrack(t: Track, buildings: Building[], postOk: (x: number, z: number) => boolean): THREE.Group {
  const group = new THREE.Group();
  const m = materials();
  const thr = t.through.map((x) => buildings[x.b]);
  const inBuilding = (x: number, z: number) => thr.some((b) => inside(b.pts, x, z));
  const roofs = (t.over ?? []).map((i) => buildings[i]);
  for (const secs of trackSections(t)) strip(group, secs);
  posts(group, trackPosts(t, (x, z) => postOk(x, z) && !inBuilding(x, z) && !roofs.some((b) => inside(b.pts, x, z))));
  // Beams over the loops.
  for (const part of t.parts)
    if (part.kind === 'loop') {
      const l = part.loop, c = Math.cos(l.yaw), s = Math.sin(l.yaw), top = (l.y ?? 0) + l.r * 2;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, l.d + LOOP_W + 1.8), m.post);
      beam.position.set(l.x - s * (l.d / 2), top + 0.45, l.z + c * (l.d / 2));
      beam.rotation.y = -l.yaw;
      group.add(beam);
    }

  // Tunnels: side walls and a ceiling around the track wherever it is inside a building.
  const tv: number[] = [], ti: number[] = [];
  const hw = LOOP_W / 2 + 0.4, ceil = 4.2;
  for (const part of t.parts) {
    if (part.kind !== 'path') continue;
    const pts = part.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (!inBuilding(a[0], a[2]) && !inBuilding(b[0], b[2])) continue;
      const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
      const sx = -dz / l, sz = dx / l;
      const corner = (p: number[], s: number, y: number) => [p[0] + sx * s, p[1] + y, p[2] + sz * s];
      const quad = (q: number[][]) => {
        const base = tv.length / 3;
        for (const v of q) tv.push(...v);
        ti.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      quad([corner(a, -hw, -0.3), corner(b, -hw, -0.3), corner(b, -hw, ceil), corner(a, -hw, ceil)]);
      quad([corner(a, hw, -0.3), corner(b, hw, -0.3), corner(b, hw, ceil), corner(a, hw, ceil)]);
      quad([corner(a, -hw, ceil), corner(b, -hw, ceil), corner(b, hw, ceil), corner(a, hw, ceil)]);
      if (i % 2 === 0) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, LOOP_W * 0.6), m.light);
        lamp.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + ceil - 0.06, (a[2] + b[2]) / 2);
        lamp.rotation.y = Math.atan2(-dz, dx);
        group.add(lamp);
      }
    }
  }
  if (ti.length) group.add(mesh(tv, ti, m.tunnel, false));

  // Dark openings on the outside of the walls where the track goes in and out.
  for (const b of thr) {
    let area = 0;
    for (let i = 0; i < b.pts.length - 1; i++) area += b.pts[i][0] * b.pts[i + 1][1] - b.pts[i + 1][0] * b.pts[i][1];
    const sign = area > 0 ? 1 : -1;
    for (let i = 0; i < b.pts.length - 1; i++) {
      const [ax, az] = b.pts[i], [bx, bz] = b.pts[i + 1];
      const ex = bx - ax, ez = bz - az, el = Math.hypot(ex, ez);
      if (el < 0.01) continue;
      for (const part of t.parts) {
        if (part.kind !== 'path') continue;
        for (let k = 0; k < part.pts.length - 1; k++) {
          const [px, py, pz] = part.pts[k], [qx, qy, qz] = part.pts[k + 1];
          const rx = qx - px, rz = qz - pz, den = ex * rz - ez * rx;
          if (Math.abs(den) < 1e-9) continue;
          const tt = ((px - ax) * rz - (pz - az) * rx) / den, u = ((px - ax) * ez - (pz - az) * ex) / den;
          if (tt < 0 || tt > 1 || u < 0 || u > 1) continue;
          const y = py + (qy - py) * u;
          const sin = Math.abs(den) / (el * Math.hypot(rx, rz));
          const half = (LOOP_W / 2 + 1.2) / Math.max(0.3, sin);
          const nx = (sign * ez) / el, nz = (sign * -ex) / el; // outward
          const cx = ax + ex * tt + nx * 0.12, cz = az + ez * tt + nz * 0.12;
          const ux = ex / el, uz = ez / el;
          const P = [
            cx - ux * half, y - 0.6, cz - uz * half,
            cx + ux * half, y - 0.6, cz + uz * half,
            cx + ux * half, y + 4.2, cz + uz * half,
            cx - ux * half, y + 4.2, cz - uz * half,
          ];
          group.add(mesh(P, [0, 1, 2, 0, 2, 3], m.hole, false));
        }
      }
    }
  }
  return group;
}
