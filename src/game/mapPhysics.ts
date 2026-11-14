import RAPIER from '@dimforge/rapier3d-compat';
import type { MapData } from './mapData';
import type { Tree } from './scenery';
import { MAP_HALF_SIZE } from './mapData';

/** Static colliders: ground, building walls (one trimesh) and the map edge. */
export function buildMapPhysics(world: RAPIER.World, map: MapData, trees: Tree[] = []) {
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

  // Invisible walls around the playable area.
  const E = MAP_HALF_SIZE;
  for (const [x, z, hx, hz] of [[E, 0, 1, E], [-E, 0, 1, E], [0, E, E, 1], [0, -E, E, 1]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 10, hz).setTranslation(x, 10, z), fixed);
  }
}
