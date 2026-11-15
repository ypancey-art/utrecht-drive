import RAPIER from '@dimforge/rapier3d-compat';
import type { MapData } from './mapData';
import type { Tree } from './scenery';
import { RAIL_H, RAIL_DECK, type Dyke } from './railway';
import type { Item } from './playgrounds';
import { MAP_HALF_SIZE } from './mapData';

/** Static colliders: ground, building walls (one trimesh) and the map edge. */
export function buildMapPhysics(
  world: RAPIER.World,
  map: MapData,
  trees: Tree[] = [],
  bridges: { ax: number; az: number; bx: number; bz: number; width: number; rails: [boolean, boolean] }[] = [],
  dyke?: Dyke,
  play?: { items: Item[]; areas: MapData['playgrounds'] },
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
    if (!b.rails[0] && !b.rails[1]) continue;
    const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
    if (len < 0.05) continue;
    const ux = (b.bx - b.ax) / len, uz = (b.bz - b.az) / len;
    const yaw = Math.atan2(-uz, ux);
    const rot = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    for (const side of [-1, 1]) {
      if (!b.rails[side < 0 ? 1 : 0]) continue;
      const cx = (b.ax + b.bx) / 2 - uz * side * (b.width / 2), cz = (b.az + b.bz) / 2 + ux * side * (b.width / 2);
      world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2 + 0.05, 0.6, 0.1).setTranslation(cx, 0.6, cz).setRotation(rot), fixed);
    }
  }

  // Railway dyke (sloped sides + top) and the railway bridges over the streets.
  if (dyke) {
    if (dyke.idx.length) world.createCollider(RAPIER.ColliderDesc.trimesh(dyke.pos, dyke.idx).setFriction(0.8), fixed);
    if (dyke.walls.length) {
      const w = new Float32Array(dyke.walls);
      world.createCollider(RAPIER.ColliderDesc.trimesh(w, Uint32Array.from({ length: w.length / 3 }, (_, i) => i)), fixed);
    }
    for (const d of dyke.decks) {
      const len = Math.hypot(d.bx - d.ax, d.bz - d.az);
      if (len < 0.05) continue;
      const yaw = Math.atan2(-(d.bz - d.az) / len, (d.bx - d.ax) / len);
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(len / 2 + 0.2, RAIL_DECK / 2, d.width / 2)
          .setTranslation((d.ax + d.bx) / 2, RAIL_H - RAIL_DECK / 2, (d.az + d.bz) / 2)
          .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
        fixed,
      );
    }
  }

  // Playground equipment and fences.
  if (play) {
    for (const it of play.items) {
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(...it.half).setTranslation(it.x, it.half[1], it.z).setRotation({ x: 0, y: Math.sin(it.rot / 2), z: 0, w: Math.cos(it.rot / 2) }),
        fixed,
      );
    }
    for (const { pts } of play.areas) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.3) continue;
        const yaw = Math.atan2(-(bz - az), bx - ax);
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(len / 2, 0.5, 0.05).setTranslation((ax + bx) / 2, 0.5, (az + bz) / 2).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }),
          fixed,
        );
      }
    }
  }

  // Invisible walls around the playable area.
  const E = MAP_HALF_SIZE;
  for (const [x, z, hx, hz] of [[E, 0, 1, E], [-E, 0, 1, E], [0, E, E, 1], [0, -E, E, 1]]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 10, hz).setTranslation(x, 10, z), fixed);
  }
}
