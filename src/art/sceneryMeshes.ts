import * as THREE from 'three';
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
  // Crowns span the top part of a 1 m tall, 1 m wide box.
  const crowns = [
    new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.62, 1).translate(0, 0.69, 0), // round
    new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.8, 1).translate(0, 0.6, 0), // narrow
    new THREE.ConeGeometry(0.5, 0.85, 7).translate(0, 0.575, 0), // conifer
    new THREE.IcosahedronGeometry(0.5, 1).scale(1, 0.55, 1).translate(0, 0.66, 0), // willow
  ];
  const trunkTop = [0.45, 0.3, 0.25, 0.45];
  const jitter = (g: THREE.BufferGeometry, seed: number) => {
    // Push vertices in and out a little so crowns look less like perfect balls.
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const n = Math.sin(p.getX(i) * 12.9 + p.getY(i) * 78.2 + p.getZ(i) * 37.7 + seed) * 0.5 + 0.5;
      p.setXYZ(i, p.getX(i) * (0.9 + n * 0.2), p.getY(i), p.getZ(i) * (0.9 + n * 0.2));
    }
    g.computeVertexNormals();
    return g;
  };
  crowns.forEach((g, k) => k !== 2 && jitter(g, k));

  const trunks = instanced(trunkGeo, new THREE.MeshLambertMaterial({ color: palette.trunk }), trees.length);
  const crownMeshes = crowns.map((g, k) =>
    instanced(g, new THREE.MeshLambertMaterial({ flatShading: true }), trees.filter((t) => t.kind === k).length),
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
