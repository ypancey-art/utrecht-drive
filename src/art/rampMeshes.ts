// Jump ramps (positions come from scripts/place-ramps.ts): a wedge with yellow/black stripes.
// The start is curved (it begins flat and bends up to the ramp's slope) so a car rolls onto it
// instead of bumping into a sharp edge. The lip (height and angle) is where the data says.
import * as THREE from 'three';
import type { Ramp } from '../game/mapData';

const TOE = 5; // length (m) of the curved start

/**
 * Side profile of a ramp: (u, y) points from the foot to the lip, u along the ramp (lip at +len/2).
 * A parabola tangent to the ground over the first TOE metres, then straight up to (len/2, h).
 * The foot is TOE/2 in front of where a plain wedge of the same slope would start.
 */
export function rampProfile(r: Ramp): [number, number][] {
  const L = r.len / 2, k = r.h / r.len;
  const T = Math.min(TOE, r.len);
  const u0 = -L - T / 2;
  const out: [number, number][] = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = (T * i) / n;
    out.push([u0 + t, (k * t * t) / (2 * T)]);
  }
  out.push([L, r.h]);
  return out;
}

/** Convex pieces of a ramp (each a slab from the profile down to the ground), for the collider. */
export function rampHulls(r: Ramp): number[][][] {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  const P = (u: number, y: number, v: number) => [r.x + c * u - s * v, y, r.z + s * u + c * v];
  const W = r.w / 2, prof = rampProfile(r);
  const hulls: number[][][] = [];
  for (let i = 0; i < prof.length - 1; i++) {
    const [ua, ya] = prof[i], [ub, yb] = prof[i + 1];
    const pts = [P(ua, 0, -W), P(ua, 0, W), P(ub, 0, -W), P(ub, 0, W), P(ub, yb, -W), P(ub, yb, W)];
    if (ya > 0.001) pts.push(P(ua, ya, -W), P(ua, ya, W));
    hulls.push(pts);
  }
  return hulls;
}

function stripes() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f5c518';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1d1f22';
  for (let i = -64; i < 64; i += 32) {
    g.beginPath();
    g.moveTo(i, 64); g.lineTo(i + 16, 64); g.lineTo(i + 80, 0); g.lineTo(i + 64, 0);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildRamps(ramps: Ramp[]): THREE.Group {
  const group = new THREE.Group();
  if (!ramps.length) return group;
  const top = new THREE.MeshLambertMaterial({ map: stripes(), side: THREE.DoubleSide });
  const side = new THREE.MeshLambertMaterial({ color: 0x8e979f, side: THREE.DoubleSide });
  for (const r of ramps) {
    const c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
    const P = (u: number, y: number, v: number) => [r.x + c * u - sn * v, y, r.z + sn * u + c * v];
    const W = r.w / 2, prof = rampProfile(r);
    const tp: number[] = [], uv: number[] = [], ti: number[] = [];
    const sp: number[] = [], si: number[] = [];
    const quad = (q: number[][]) => {
      const base = sp.length / 3;
      for (const v of q) sp.push(...v);
      si.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    let dist = 0;
    prof.forEach(([u, y], i) => {
      if (i) dist += Math.hypot(u - prof[i - 1][0], y - prof[i - 1][1]);
      tp.push(...P(u, y, -W), ...P(u, y, W));
      uv.push(0, dist / 4, 1, dist / 4);
      if (!i) return;
      const a = (i - 1) * 2, b = i * 2;
      ti.push(a, b + 1, a + 1, a, b, b + 1);
      const [pu, py] = prof[i - 1];
      for (const v of [-W, W]) quad([P(pu, 0, v), P(u, 0, v), P(u, y, v), P(pu, py, v)]);
    });
    const [uL, hL] = prof[prof.length - 1];
    quad([P(uL, 0, -W), P(uL, 0, W), P(uL, hL, W), P(uL, hL, -W)]);
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    g1.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g1.setIndex(ti);
    g1.computeVertexNormals();
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    g2.setIndex(si);
    g2.computeVertexNormals();
    const m1 = new THREE.Mesh(g1, top), m2 = new THREE.Mesh(g2, side);
    m1.castShadow = m1.receiveShadow = m2.castShadow = true;
    group.add(m1, m2);
  }
  return group;
}
