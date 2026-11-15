import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Lamp, Tree } from '../game/scenery';
import { palette } from './palette';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const col = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(count, 1));
  mesh.count = count;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Low-poly trees in 4 shapes. Geometry is unit-sized; each instance is scaled to its real height and crown. */
export function buildTrees(trees: Tree[]): THREE.Group {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6).translate(0, 0.5, 0);
  // Crowns span the top part of a 1 m tall, 1 m wide box. Like the street trees on Street View,
  // crowns are clusters of lobes (not one ball), darker underneath and lighter on top.
  const lobed = (lobes: number[][], seed: number) => {
    const parts = lobes.map(([x, y, z, r], k) => {
      const g = new THREE.IcosahedronGeometry(r, 0).translate(x, y, z); // 20 faces per lobe keeps 3000+ trees cheap
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const n = Math.sin(p.getX(i) * 31.7 + p.getY(i) * 57.3 + p.getZ(i) * 19.1 + seed * 3.1 + k) * 0.5 + 0.5;
        const f = 0.88 + n * 0.24;
        p.setXYZ(i, x + (p.getX(i) - x) * f, y + (p.getY(i) - y) * f, z + (p.getZ(i) - z) * f);
      }
      return g;
    });
    const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    const p = g.getAttribute('position');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < p.count; i++) (lo = Math.min(lo, p.getY(i))), (hi = Math.max(hi, p.getY(i)));
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const v = 0.62 + 0.45 * ((p.getY(i) - lo) / (hi - lo));
      c.set([v, v, v], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  };
  const cone = (k: number) => {
    const g = mergeGeometries([
      new THREE.ConeGeometry(0.5, 0.55, 8).translate(0, 0.45, 0).toNonIndexed(),
      new THREE.ConeGeometry(0.38, 0.5, 8).translate(0, 0.72, 0).toNonIndexed(),
    ]);
    const p = g.getAttribute('position');
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) c.fill(0.7 + 0.35 * p.getY(i) + 0.02 * k, i * 3, i * 3 + 3);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.computeVertexNormals();
    return g;
  };
  const crowns = [
    lobed([[0, 0.66, 0, 0.3], [0.2, 0.6, 0.08, 0.24], [-0.18, 0.58, -0.12, 0.25], [0.04, 0.6, -0.22, 0.23], [-0.1, 0.8, 0.12, 0.22], [0.15, 0.8, -0.06, 0.21], [-0.22, 0.68, 0.17, 0.2]], 1), // round
    lobed([[0, 0.5, 0, 0.24], [0, 0.68, 0, 0.27], [0.07, 0.86, 0.04, 0.18], [-0.1, 0.6, 0.08, 0.19]], 2), // narrow
    cone(0), // conifer
    lobed([[0, 0.6, 0, 0.32], [0.26, 0.5, 0, 0.24], [-0.26, 0.5, 0.05, 0.24], [0, 0.48, 0.26, 0.24], [0, 0.5, -0.26, 0.23]], 3), // willow
  ];
  const trunkTop = [0.45, 0.3, 0.25, 0.45];

  const trunks = instanced(trunkGeo, new THREE.MeshLambertMaterial({ color: palette.trunk }), trees.length);
  const crownMeshes = crowns.map((g, k) =>
    instanced(g, new THREE.MeshLambertMaterial({ flatShading: true, vertexColors: true }), trees.filter((t) => t.kind === k).length),
  );
  const counters = [0, 0, 0, 0];
  trees.forEach((t, i) => {
    q.setFromAxisAngle(UP, (t.x * 13.1 + t.z * 7.7) % (Math.PI * 2));
    pos.set(t.x, 0, t.z);
    const r = Math.max(0.1, t.h / 75);
    scl.set(r, t.h * trunkTop[t.kind] + 0.5, r);
    trunks.setMatrixAt(i, m4.compose(pos, q, scl));
    scl.set(t.crown, t.h, t.crown);
    const mesh = crownMeshes[t.kind];
    const n = counters[t.kind]++;
    mesh.setMatrixAt(n, m4.compose(pos, q, scl));
    const greens = t.kind === 2 ? palette.pine : t.kind === 3 ? palette.willow : palette.leaves;
    mesh.setColorAt(n, col.setHex(greens[(i * 7) % greens.length]));
  });
  group.add(trunks, ...crownMeshes);
  return group;
}

/** Street lights: a pole with an arm over the road edge. */
export function buildLamps(lamps: Lamp[]): THREE.Group {
  const metal = new THREE.MeshLambertMaterial({ color: palette.lampPole });
  const pole = instanced(new THREE.CylinderGeometry(0.08, 0.12, 7, 6).translate(0, 3.5, 0), metal, lamps.length);
  const arm = instanced(new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0.7, 7, 0), metal, lamps.length);
  const head = instanced(
    new THREE.BoxGeometry(0.6, 0.18, 0.3).translate(1.35, 6.9, 0),
    new THREE.MeshBasicMaterial({ color: palette.lampLight }),
    lamps.length,
  );
  head.castShadow = false;
  lamps.forEach((l, i) => {
    // Local +x points at the road.
    q.setFromAxisAngle(UP, Math.atan2(-l.dirZ, l.dirX));
    m4.compose(pos.set(l.x, 0, l.z), q, scl.setScalar(1));
    pole.setMatrixAt(i, m4);
    arm.setMatrixAt(i, m4);
    head.setMatrixAt(i, m4);
  });
  const g = new THREE.Group();
  g.add(pole, arm, head);
  return g;
}

/** Hedges (trimmed, along garden edges) and shrub / flower beds, coloured like on Street View. */
export function buildGreenery(hedges: { pts: [number, number][]; h: number }[], shrubs: { pts: [number, number][]; flowers?: boolean }[]): THREE.Group {
  const group = new THREE.Group();
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const HEDGE = [0x355f2a, 0x3d6a2e, 0x2f5627, 0x44712f];
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, hex: number) => {
    const c = col.setHex(hex);
    const p = g.getAttribute('position');
    const a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const v = 0.75 + 0.3 * Math.min(1, p.getY(i) / 1.5); // darker at the bottom
      a.set([c.r * v, c.g * v, c.b * v], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  for (const { pts, h } of hedges) {
    const hex = HEDGE[Math.floor(rnd() * HEDGE.length)];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.2) continue;
      const box = new THREE.BoxGeometry(len + 0.4, h, 0.8, Math.max(1, Math.round(len / 1.2)), 2, 1).toNonIndexed();
      // Slightly uneven top and sides.
      const p = box.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        const n = Math.sin(p.getX(k) * 4.1 + ax * 0.7 + az) * 0.5 + 0.5;
        if (p.getY(k) > 0) p.setY(k, p.getY(k) + n * 0.12);
        p.setZ(k, p.getZ(k) * (0.92 + n * 0.16));
      }
      box.applyMatrix4(m4.compose(pos.set((ax + bx) / 2, h / 2, (az + bz) / 2), q.setFromAxisAngle(UP, Math.atan2(-(bz - az), bx - ax)), scl.setScalar(1)));
      box.deleteAttribute('uv');
      parts.push(paint(box, hex));
    }
  }
  if (parts.length) {
    const g = mergeGeometries(parts);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }

  // Shrub beds: lumpy bushes scattered inside each bed; flower beds get coloured flowers.
  const inside = (x: number, z: number, p: [number, number][]) => {
    let c = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++)
      if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
    return c;
  };
  const bushes: { x: number; z: number; s: number; hex: number }[] = [];
  const BUSH = [0x3f6c2d, 0x4a7832, 0x365f2b, 0x56803a, 0x5e6f2c];
  const FLOWER = [0xd6455a, 0xf2c14e, 0xe983b0, 0xffffff, 0x8e5bd1];
  for (const { pts, flowers } of shrubs) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z));
    const step = flowers ? 0.9 : 1.7;
    for (let z = z0 + step / 2; z < z1; z += step)
      for (let x = x0 + step / 2; x < x1; x += step) {
        const jx = x + (rnd() - 0.5) * step * 0.6, jz = z + (rnd() - 0.5) * step * 0.6;
        if (!inside(jx, jz, pts)) continue;
        bushes.push({ x: jx, z: jz, s: flowers ? 0.35 + rnd() * 0.15 : 0.7 + rnd() * 0.5, hex: flowers ? FLOWER[Math.floor(rnd() * FLOWER.length)] : BUSH[Math.floor(rnd() * BUSH.length)] });
        if (bushes.length > 20000) break;
      }
  }
  if (bushes.length) {
    const geo = new THREE.IcosahedronGeometry(0.75, 0).scale(1, 0.75, 1).translate(0, 0.45, 0);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const n = Math.sin(p.getX(i) * 17.1 + p.getZ(i) * 9.3) * 0.5 + 0.5;
      p.setXYZ(i, p.getX(i) * (0.85 + n * 0.3), Math.max(0, p.getY(i)), p.getZ(i) * (0.85 + n * 0.3));
    }
    geo.computeVertexNormals();
    const mesh = instanced(geo, new THREE.MeshLambertMaterial({ flatShading: true }), bushes.length);
    bushes.forEach((b, i) => {
      mesh.setMatrixAt(i, m4.compose(pos.set(b.x, 0, b.z), q.setFromAxisAngle(UP, (b.x * 3.7) % 6.28), scl.setScalar(b.s)));
      mesh.setColorAt(i, col.setHex(b.hex));
    });
    group.add(mesh);
  }
  return group;
}
