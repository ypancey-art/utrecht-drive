// Jump ramps (positions come from scripts/place-ramps.ts): a wedge with yellow/black stripes.
import * as THREE from 'three';
import type { Ramp } from '../game/mapData';

/** Corner points of a ramp wedge in world space (also used for its collider). */
export function rampPoints(r: Ramp): number[][] {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  const P = (u: number, y: number, v: number) => [r.x + c * u - s * v, y, r.z + s * u + c * v];
  const L = r.len / 2, W = r.w / 2;
  // back-left, back-right, front-left, front-right (bottom), front-left, front-right (top)
  return [P(-L, 0, -W), P(-L, 0, W), P(L, 0, -W), P(L, 0, W), P(L, r.h, -W), P(L, r.h, W)];
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
  const side = new THREE.MeshLambertMaterial({ color: 0x8e979f });
  for (const r of ramps) {
    const [bl, br, fl, fr, tl, tr] = rampPoints(r);
    const slope = Math.hypot(r.len, r.h);
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.Float32BufferAttribute([...bl, ...tr, ...br, ...bl, ...tl, ...tr], 3));
    g1.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, slope / 4, 1, 0, 0, 0, 0, slope / 4, 1, slope / 4], 2));
    g1.computeVertexNormals();
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute([...bl, ...fl, ...tl, ...br, ...tr, ...fr, ...fl, ...fr, ...tr, ...fl, ...tr, ...tl], 3));
    g2.computeVertexNormals();
    const m1 = new THREE.Mesh(g1, top), m2 = new THREE.Mesh(g2, side);
    m2.material.side = THREE.DoubleSide;
    m1.castShadow = m1.receiveShadow = m2.castShadow = true;
    group.add(m1, m2);
  }
  return group;
}
