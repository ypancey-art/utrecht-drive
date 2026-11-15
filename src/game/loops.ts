// Hot Wheels style loops. The track is a corkscrew on a horizontal cylinder: it climbs, goes
// upside down over the top and comes back down beside where it started. On a cylinder, a car
// driving straight follows exactly such a constant-pitch helix, so nobody needs to steer.
// The same geometry is used for the physics (trimesh) and the mesh.
import type { Loop } from './mapData';

export const LOOP_W = 6; // track width (m)
export const LOOP_WALL = 1.2; // side wall height (m)
const IN = 14, OUT = 16; // straight lead-in and run-out (m)
const STEPS = 72;

/** Angle between the loop axis normal and the straight entry/exit. */
export const loopSlant = (l: Loop) => Math.atan2(l.d / (2 * Math.PI), l.r);

/** Entry point and heading of a loop: where cars should come from (start of the lead-in). */
export function loopEntry(l: Loop) {
  const a = l.yaw + loopSlant(l);
  return { x: l.x - Math.cos(a) * IN, z: l.z - Math.sin(a) * IN, dirX: Math.cos(a), dirZ: Math.sin(a) };
}

/**
 * Sections along the track: centre point, sideways unit vector (to the right) and inward
 * normal (the way "up" for the car), all in world space. y = 0 is the ground.
 */
export function loopSections(l: Loop) {
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
  // Local frame: u = forward (yaw), v = right, y = up.
  const W = (u: number, y: number, v: number): [number, number, number] => [l.x + c * u - s * v, y, l.z + s * u + c * v];
  const Wd = (u: number, y: number, v: number): [number, number, number] => [c * u - s * v, y, s * u + c * v];
  const k = l.d / (2 * Math.PI);
  const tl = Math.hypot(l.r, k);
  const T0: [number, number, number] = [l.r / tl, 0, k / tl]; // tangent at the bottom (u, y, v)
  const out: { p: [number, number, number]; side: [number, number, number]; up: [number, number, number] }[] = [];
  const flatSide: [number, number, number] = [-T0[2], 0, T0[0]]; // right of the tangent, level
  const lift = 0.03;
  for (let i = 0; i <= 4; i++) {
    const t = -IN + (IN * i) / 4;
    out.push({ p: W(T0[0] * t, lift, T0[2] * t), side: Wd(...flatSide), up: [0, 1, 0] });
  }
  for (let i = 1; i < STEPS; i++) {
    const th = (i / STEPS) * Math.PI * 2;
    const n: [number, number, number] = [-Math.sin(th), Math.cos(th), 0]; // inward (u, y, v)
    const tan: [number, number, number] = [l.r * Math.cos(th), l.r * Math.sin(th), k];
    // side = tangent x normal (normalised), pointing to +v like flatSide
    let sx = tan[1] * n[2] - tan[2] * n[1], sy = tan[2] * n[0] - tan[0] * n[2], sz = tan[0] * n[1] - tan[1] * n[0];
    const sl = Math.hypot(sx, sy, sz);
    (sx /= sl), (sy /= sl), (sz /= sl);
    if (sz < 0) (sx = -sx), (sy = -sy), (sz = -sz);
    out.push({ p: W(l.r * Math.sin(th), l.r * (1 - Math.cos(th)) + lift, k * th), side: Wd(sx, sy, sz), up: Wd(n[0], n[1], n[2]) });
  }
  for (let i = 0; i <= 4; i++) {
    const t = (OUT * i) / 4;
    out.push({ p: W(T0[0] * t, lift, l.d + T0[2] * t), side: Wd(...flatSide), up: [0, 1, 0] });
  }
  return out;
}

/** Triangles of the track surface and both side walls: flat position list + indices. */
export function loopGeometry(l: Loop) {
  const secs = loopSections(l);
  const pos: number[] = [];
  const idx: number[] = [];
  const hw = LOOP_W / 2;
  // Per section 4 points: left wall top, left edge, right edge, right wall top.
  for (const { p, side, up } of secs) {
    const e = (a: number, h: number) => pos.push(p[0] + side[0] * a + up[0] * h, p[1] + side[1] * a + up[1] * h, p[2] + side[2] * a + up[2] * h);
    e(-hw, LOOP_WALL);
    e(-hw, 0);
    e(hw, 0);
    e(hw, LOOP_WALL);
  }
  const road: number[] = [], walls: number[] = [];
  for (let i = 0; i < secs.length - 1; i++) {
    const a = i * 4, b = a + 4;
    for (let j = 0; j < 3; j++) (j === 1 ? road : walls).push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
  }
  return { pos, idx: [...road, ...walls], road, walls, sections: secs.length };
}

/** Rough footprint (for keeping loops apart from other things). */
export function loopFootprint(l: Loop): [number, number][] {
  return loopSections(l).map(({ p }) => [p[0], p[2]]);
}
