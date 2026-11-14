import * as THREE from 'three';

const COLORS = { start: 0xffc917, target: 0x35d07f, done: 0x8a8f96 };

/** A glowing beam with a ring on the ground: mission starts (yellow) and targets (green). */
export function beam(kind: keyof typeof COLORS, radius = 12): THREE.Group {
  const g = new THREE.Group();
  const color = COLORS[kind];
  const column = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 60, 16, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
  );
  column.position.y = 30;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.8, radius, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }),
  );
  ring.position.y = 0.15;
  g.add(column, ring);
  return g;
}
