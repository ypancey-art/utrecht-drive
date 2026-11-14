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

/** Low-poly trees: round, tall round and pine. One draw call per part. */
export function buildTrees(trees: Tree[]): THREE.Group {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 1, 6).translate(0, 0.5, 0);
  const crowns = [
    new THREE.IcosahedronGeometry(1, 0).scale(2.6, 2.3, 2.6).translate(0, 5, 0), // round
    new THREE.IcosahedronGeometry(1, 0).scale(1.8, 3.6, 1.8).translate(0, 6.3, 0), // tall
    new THREE.ConeGeometry(2.2, 6, 7).translate(0, 5.5, 0), // pine
  ];
  const trunkH = [3.2, 3.5, 2.8];

  const trunks = instanced(trunkGeo, new THREE.MeshLambertMaterial({ color: palette.trunk }), trees.length);
  const crownMeshes = crowns.map((g, k) =>
    instanced(g, new THREE.MeshLambertMaterial({ flatShading: true }), trees.filter((t) => t.kind === k).length),
  );
  const counters = [0, 0, 0];
  trees.forEach((t, i) => {
    const yaw = (t.x * 13.1 + t.z * 7.7) % (Math.PI * 2);
    q.setFromAxisAngle(UP, yaw);
    pos.set(t.x, 0, t.z);
    scl.set(t.scale, trunkH[t.kind] * t.scale, t.scale);
    trunks.setMatrixAt(i, m4.compose(pos, q, scl));
    scl.setScalar(t.scale);
    const mesh = crownMeshes[t.kind];
    const n = counters[t.kind]++;
    mesh.setMatrixAt(n, m4.compose(pos, q, scl));
    const greens = t.kind === 2 ? palette.pine : palette.leaves;
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
