// Hot Wheels style loops and tracks.
//
// A loop is a corkscrew on a horizontal cylinder: it climbs, goes upside down over the top and
// comes back down beside where it started. On a cylinder, a car driving straight follows exactly
// such a constant-pitch helix, so nobody needs to steer.
//
// A track is a long elevated road made of path pieces (3D polylines) and loops. Everything is
// turned into "sections" (centre point, sideways vector, up vector) and then into one strip of
// triangles: the road surface plus a low wall on each side. The same geometry is used for the
// physics (trimesh) and the mesh.
import type { Loop, Track } from './mapData';

export const LOOP_W = 6; // track width (m)
export const LOOP_WALL = 1.2; // side wall height (m)
const IN = 14, OUT = 16; // straight lead-in and run-out of a loop (m)
const STEPS = 72;
const LIFT = 0.03; // ground-level tracks sit just above the ground

export type V3 = [number, number, number];
export interface Section { p: V3; side: V3; up: V3 }

/** Angle between the loop axis normal and the straight entry/exit. */
export const loopSlant = (l: Loop) => Math.atan2(l.d / (2 * Math.PI), l.r);

/** Entry point and heading of a loop: where cars should come from (start of the lead-in). */
export function loopEntry(l: Loop) {
  const a = l.yaw + loopSlant(l);
  return { x: l.x - Math.cos(a) * IN, z: l.z - Math.sin(a) * IN, y: l.y ?? 0, dirX: Math.cos(a), dirZ: Math.sin(a) };
}

/** End of a loop's run-out: where the car leaves it, and its heading. */
export function loopExit(l: Loop) {
  const a = l.yaw + loopSlant(l);
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
  const k = l.d / (2 * Math.PI), tl = Math.hypot(l.r, k);
  const u = (l.r / tl) * OUT, v = l.d + (k / tl) * OUT;
  return { x: l.x + c * u - s * v, z: l.z + s * u + c * v, y: l.y ?? 0, dirX: Math.cos(a), dirZ: Math.sin(a) };
}

/** Where a loop is placed so that its lead-in starts at (x, z, y) heading along angle `dir`. */
export function loopAt(x: number, z: number, y: number, dir: number, r: number, d: number): Loop {
  const slant = Math.atan2(d / (2 * Math.PI), r);
  return { x: x + Math.cos(dir) * IN, z: z + Math.sin(dir) * IN, y, yaw: dir - slant, r, d };
}

/** Sections of a loop, lead-in to run-out, in world space. */
export function loopSections(l: Loop): Section[] {
  const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
  const y0 = (l.y ?? 0) + LIFT;
  // Local frame: u = forward (yaw), v = right, y = up.
  const W = (u: number, y: number, v: number): V3 => [l.x + c * u - s * v, y0 + y, l.z + s * u + c * v];
  const Wd = (u: number, y: number, v: number): V3 => [c * u - s * v, y, s * u + c * v];
  const k = l.d / (2 * Math.PI);
  const tl = Math.hypot(l.r, k);
  const T0: V3 = [l.r / tl, 0, k / tl]; // tangent at the bottom (u, y, v)
  const out: Section[] = [];
  const flatSide: V3 = [-T0[2], 0, T0[0]]; // right of the tangent, level
  for (let i = 0; i <= 4; i++) {
    const t = -IN + (IN * i) / 4;
    out.push({ p: W(T0[0] * t, 0, T0[2] * t), side: Wd(...flatSide), up: [0, 1, 0] });
  }
  for (let i = 1; i < STEPS; i++) {
    const th = (i / STEPS) * Math.PI * 2;
    const n: V3 = [-Math.sin(th), Math.cos(th), 0]; // inward (u, y, v)
    const tan: V3 = [l.r * Math.cos(th), l.r * Math.sin(th), k];
    // side = tangent x normal (normalised), pointing to +v like flatSide
    let sx = tan[1] * n[2] - tan[2] * n[1], sy = tan[2] * n[0] - tan[0] * n[2], sz = tan[0] * n[1] - tan[1] * n[0];
    const sl = Math.hypot(sx, sy, sz);
    (sx /= sl), (sy /= sl), (sz /= sl);
    if (sz < 0) (sx = -sx), (sy = -sy), (sz = -sz);
    out.push({ p: W(l.r * Math.sin(th), l.r * (1 - Math.cos(th)), k * th), side: Wd(sx, sy, sz), up: Wd(n[0], n[1], n[2]) });
  }
  for (let i = 0; i <= 4; i++) {
    const t = (OUT * i) / 4;
    out.push({ p: W(T0[0] * t, 0, l.d + T0[2] * t), side: Wd(...flatSide), up: [0, 1, 0] });
  }
  return out;
}

/** Sections along a 3D polyline. Sideways stays level, unless `bank` gives a roll angle per point
 *  (radians, positive = tilted into a right-hand bend: the left edge higher). */
export function pathSections(pts: V3[], bank?: number[]): Section[] {
  const out: Section[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    (tx /= tl), (ty /= tl), (tz /= tl);
    const sl = Math.hypot(tx, tz) || 1;
    const side: V3 = [-tz / sl, 0, tx / sl];
    // up = side x tangent
    const up: V3 = [side[1] * tz - side[2] * ty, side[2] * tx - side[0] * tz, side[0] * ty - side[1] * tx];
    const p = pts[i];
    const roll = bank?.[i] ?? 0;
    if (roll) {
      const c = Math.cos(roll), s = Math.sin(roll);
      const bs: V3 = [side[0] * c - up[0] * s, side[1] * c - up[1] * s, side[2] * c - up[2] * s];
      const bu: V3 = [up[0] * c + side[0] * s, up[1] * c + side[1] * s, up[2] * c + side[2] * s];
      out.push({ p: [p[0], p[1] + LIFT, p[2]], side: bs, up: bu });
      continue;
    }
    out.push({ p: [p[0], p[1] + LIFT, p[2]], side, up });
  }
  return out;
}

/** All sections of a track, in driving order. */
export function trackSections(t: Track): Section[][] {
  return t.parts.map((part) => (part.kind === 'loop' ? loopSections(part.loop) : pathSections(part.pts, part.bank)));
}

/** Triangles of a strip of sections: road surface and both side walls (separate index lists). */
export function stripGeometry(secs: Section[]) {
  const pos: number[] = [];
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
  return { pos, road, walls };
}

/** Triangles of a loop's track surface and side walls. */
export function loopGeometry(l: Loop) {
  const g = stripGeometry(loopSections(l));
  return { ...g, idx: [...g.road, ...g.walls] };
}

/** Support posts of a track: every ~12 m where it is up in the air, where `ok` allows one
 *  (not on roads, not inside a building), plus four beside each loop. */
export function trackPosts(t: Track, ok: (x: number, z: number) => boolean) {
  const posts: { x: number; z: number; h: number }[] = [];
  for (const part of t.parts) {
    if (part.kind === 'loop') {
      const l = part.loop, c = Math.cos(l.yaw), s = Math.sin(l.yaw), top = (l.y ?? 0) + l.r * 2;
      for (const v of [-LOOP_W / 2 - 0.9, l.d + LOOP_W / 2 + 0.9]) for (const u of [-0.6, 0.6]) posts.push({ x: l.x + c * u - s * v, z: l.z + s * u + c * v, h: top });
      // Under the lead-in and run-out.
      for (const { p } of [loopSections(l)[2], loopSections(l).at(-3)!]) if (p[1] > 1.8 && ok(p[0], p[2])) posts.push({ x: p[0], z: p[2], h: p[1] - 0.25 });
      continue;
    }
    let walked = 6;
    for (let i = 1; i < part.pts.length; i++) {
      const [ax, ay, az] = part.pts[i - 1], [bx, , bz] = part.pts[i];
      walked += Math.hypot(bx - ax, bz - az);
      if (walked < 12 || ay < 1.8) continue;
      if (!ok(ax, az)) continue;
      posts.push({ x: ax, z: az, h: ay - 0.25 });
      walked = 0;
    }
  }
  return posts;
}
