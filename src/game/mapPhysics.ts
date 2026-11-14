import RAPIER from '@dimforge/rapier3d-compat';
import type { MapData } from './mapData';
import type { Tree } from './scenery';
import { MAP_HALF_SIZE } from './mapData';

/** Static colliders: ground, building walls (one trimesh) and the map edge. */
export function buildMapPhysics(
  world: RAPIER.World,
  map: MapData,
  trees: Tree[] = [],
  bridges: { ax: number; az: number; bx: number; bz: number; width: number }[] = [],
) {
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const S = MAP_HALF_SIZE + 200;
  world.createCollider(RAPIER.ColliderDesc.cuboid(S, 0.5, S).setTranslation(0, -0.5, 0).setFriction(1), fixed);

  const verts: number[] = [];
  const idx: number[] = [];
  for (const { pts, h } of map.buildings) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const base = verts.length / 3;
      verts.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  world.createCollider(
    RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)).setFriction(0.3),
    fixed,
  );

  // Tree trunks.
  for (const t of trees) {
    world.createCollider(RAPIER.ColliderDesc.cylinder(2, Math.max(0.1, t.h / 75)).setTranslation(t.x, 2, t.z), fixed);
  }

  // Bridge railings, so cars stay on the bridge.
  for (const b of bridges) {
    const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
    if (len < 0.05) continue;
    const ux = (b.bx - b.ax) / len, uz = (b.bz - b.az) / len;
    const yaw = Math.atan2(-uz, ux);
    const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    for (const side of [-1, 1]) {
      const cx = (b.ax + b.bx) / 2 - uz * side * (b.width / 2), cz = (b.az + b.bz) / 2 + ux * side * (b.width / 2);
      world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2 + 0.3, 0.6, 0.1).setTranslation(cx, 0.6, cz).setRotation(rot), fixed);
    }
  }

  // Invisible walls around the playable area.
  const E = MAP_HALF_SIZE;
  for (const [x, z, hx, hz] of [[E, 0, 1, E], [-E, 0, 1, E], [0, E, E, 1], [0, -E, E, 1]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 10, hz).setTranslation(x, 10, z), fixed);
  }
}
