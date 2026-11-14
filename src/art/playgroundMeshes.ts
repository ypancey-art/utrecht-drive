import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Item } from '../game/playgrounds';
import type { Pt } from '../game/mapData';

const RED = 0xe5483c, YELLOW = 0xf5c518, BLUE = 0x2f7fd8, GREEN = 0x43a75b, WOOD = 0x9b6b43, STEEL = 0x8e979f, SAND = 0xe8d39a, WATER = 0x6cc3f0;

/** Collects coloured primitives and merges them into one mesh (one draw call). */
class Kit {
  parts: THREE.BufferGeometry[] = [];
  add(geo: THREE.BufferGeometry, color: number, m: THREE.Matrix4) {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m);
    g.deleteAttribute('uv');
    const c = new THREE.Color(color);
    const cols = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < cols.length; i += 3) cols.set([c.r, c.g, c.b], i);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.parts.push(g);
  }
  mesh() {
    const m = new THREE.Mesh(mergeGeometries(this.parts), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const post = (h: number, r = 0.06) => new THREE.CylinderGeometry(r, r, h, 6);

function item(kit: Kit, it: Item) {
  const base = T(it.x, 0, it.z, 0, it.rot);
  const put = (geo: THREE.BufferGeometry, color: number, m: THREE.Matrix4) => kit.add(geo, color, base.clone().multiply(m));
  switch (it.kind) {
    case 'slide':
      for (const [x, z] of [[-1.2, -0.4], [-1.2, 0.4], [-0.4, -0.4], [-0.4, 0.4]]) put(post(1.6), STEEL, T(x, 0.8, z));
      put(box(0.9, 0.1, 0.9), YELLOW, T(-0.8, 1.5, 0));
      put(box(0.9, 0.6, 0.9).translate(0, 0.3, 0), RED, T(-0.8, 1.55, 0).multiply(new THREE.Matrix4().makeScale(1, 0.15, 1)));
      put(box(2.6, 0.06, 0.6), BLUE, T(0.65, 0.8, 0, 0, 0, -0.55)); // slide
      for (const s of [-1, 1]) put(box(2.6, 0.2, 0.05), BLUE, T(0.65, 0.88, s * 0.3, 0, 0, -0.55));
      for (const s of [-1, 1]) put(post(1.7, 0.04), STEEL, T(-1.55, 0.8, s * 0.25, 0, 0, 0.25)); // ladder
      for (let k = 0; k < 5; k++) put(post(0.5, 0.03), STEEL, T(-1.75 + k * 0.09, 0.2 + k * 0.3, 0, Math.PI / 2));
      break;
    case 'swings':
      put(post(3.6, 0.07), STEEL, T(0, 2.4, 0, Math.PI / 2, 0, 0).premultiply(T(0, 0, 0, 0, Math.PI / 2, 0)));
      put(box(3.6, 0.12, 0.12), RED, T(0, 2.4, 0));
      for (const x of [-1.7, 1.7]) for (const s of [-1, 1]) put(post(2.6), RED, T(x, 1.2, s * 0.55, s * 0.42));
      for (const x of [-0.6, 0.6]) {
        for (const s of [-1, 1]) put(post(1.9, 0.015), STEEL, T(x + s * 0.2, 1.45, 0));
        put(box(0.5, 0.06, 0.25), BLUE, T(x, 0.5, 0));
      }
      break;
    case 'climber':
      for (const [x, z] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) put(post(2.4, 0.08), WOOD, T(x, 1.2, z));
      put(box(2.1, 0.1, 2.1), WOOD, T(0, 1.2, 0));
      put(new THREE.ConeGeometry(1.6, 1.0, 4), GREEN, T(0, 2.9, 0, 0, Math.PI / 4));
      for (const s of [-1, 1]) put(box(2.0, 0.5, 0.05), YELLOW, T(0, 1.55, s));
      put(box(0.05, 1.1, 1.8), BLUE, T(1.02, 0.6, 0)); // climbing wall
      for (let k = 0; k < 6; k++) put(new THREE.SphereGeometry(0.06, 5, 4), RED, T(1.06, 0.25 + k * 0.17, -0.6 + (k % 3) * 0.6));
      break;
    case 'sandbox':
      put(box(3.0, 0.06, 3.0), SAND, T(0, 0.12, 0));
      for (const s of [-1, 1]) {
        put(box(3.2, 0.25, 0.15), WOOD, T(0, 0.12, s * 1.55));
        put(box(0.15, 0.25, 3.2), WOOD, T(s * 1.55, 0.12, 0));
      }
      break;
    case 'seesaw':
      put(box(0.3, 0.45, 0.3), STEEL, T(0, 0.22, 0));
      put(box(3.4, 0.08, 0.3), YELLOW, T(0, 0.48, 0, 0, 0, 0.15));
      for (const s of [-1, 1]) put(post(0.35, 0.03), RED, T(s * 1.4, 0.5 + s * 0.2, 0, Math.PI / 2));
      break;
    case 'spring':
      put(new THREE.CylinderGeometry(0.12, 0.12, 0.45, 8), STEEL, T(0, 0.22, 0));
      put(box(0.7, 0.3, 0.3), [RED, GREEN, BLUE, YELLOW][Math.floor(it.x * 7 + it.z) & 3], T(0, 0.6, 0));
      put(new THREE.SphereGeometry(0.2, 8, 6), YELLOW, T(0.38, 0.85, 0));
      break;
    case 'fountain':
      put(new THREE.CylinderGeometry(0.9, 1.0, 0.15, 12), STEEL, T(0, 0.07, 0));
      for (let k = 0; k < 3; k++) put(new THREE.ConeGeometry(0.12, 1.2, 6), WATER, T(Math.cos(k * 2.1) * 0.45, 0.7, Math.sin(k * 2.1) * 0.45, Math.PI));
      break;
  }
}

/** Soft play surface, low fences around each playground, and all equipment. */
export function buildPlaygrounds(items: Item[], areas: { pts: Pt[] }[]): THREE.Group {
  const g = new THREE.Group();
  // Play surface (rubber tiles), drawn among the flat ground layers.
  const shapes = areas.map(({ pts }) => {
    const sg = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z))));
    sg.rotateX(-Math.PI / 2);
    return sg.deleteAttribute('uv').toNonIndexed();
  });
  if (shapes.length) {
    const surf = new THREE.Mesh(mergeGeometries(shapes), new THREE.MeshLambertMaterial({ color: 0xc26a4a, side: THREE.DoubleSide, depthWrite: false }));
    surf.renderOrder = -18.5;
    surf.receiveShadow = true;
    g.add(surf);
  }
  const kit = new Kit();
  for (const it of items) item(kit, it);
  // Fences.
  for (const { pts } of areas) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.3) continue;
      const m = T((ax + bx) / 2, 0.45, (az + bz) / 2, 0, Math.atan2(-(bz - az), bx - ax));
      kit.add(box(len, 0.06, 0.05), GREEN, m.clone().multiply(T(0, 0.4, 0)));
      kit.add(box(len, 0.06, 0.05), GREEN, m.clone().multiply(T(0, -0.1, 0)));
      for (let d = 0; d <= len; d += 2) kit.add(post(0.9, 0.04), GREEN, m.clone().multiply(T(-len / 2 + d, 0, 0)));
    }
  }
  if (kit.parts.length) g.add(kit.mesh());
  return g;
}
