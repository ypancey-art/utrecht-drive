// The other players' cars: drawn from the poses the network sends (smoothed, about 120 ms
// behind so movement stays fluid), with a name above them. Each has a solid body so you can bump.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildCarModel, type CarModel } from '../art/carModels';
import { carById } from './cars';
import type { PlayerInfo, Pose } from '../net/room';

const DELAY = 160; // ms behind the newest pose
/** Colours for name tags and minimap dots, by player id. */
export const PLAYER_COLORS = ['#ff4d6d', '#4dabff', '#ffd23f', '#3ddc84', '#c77dff', '#ff9f1c', '#2ec4b6', '#f15bb5'];
export const playerColor = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PLAYER_COLORS[h % PLAYER_COLORS.length];
};

interface Snap { t: number; pose: Pose }
interface Remote {
  info: PlayerInfo;
  model: CarModel;
  tag: THREE.Sprite;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  snaps: Snap[];
  spin: number;
  x: number;
  z: number;
  visible: boolean;
  /** Seconds left with the collider switched off (after a jump across the map). */
  ghost: number;
  parked: boolean;
}

const _q = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _wq = new THREE.Quaternion();
const _v = new THREE.Vector3(), _e = new THREE.Euler(), Z = new THREE.Vector3(0, 0, -1);

export class RemotePlayers {
  private list = new Map<string, Remote>();
  constructor(private scene: THREE.Scene, private world: RAPIER.World) {}

  get size() {
    return this.list.size;
  }

  add(info: PlayerInfo) {
    this.remove(info.id);
    const spec = carById(info.car);
    const model = buildCarModel(spec, info.paint);
    const d = spec.dims!;
    const tag = nameTag(info.name, playerColor(info.id));
    tag.position.y = d.height + 0.4;
    model.body.add(tag);
    model.body.visible = false;
    for (const w of model.wheels) w.visible = false;
    this.scene.add(model.body, ...model.wheels);
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -50, 0));
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(d.length / 2, 0.4, d.width / 2).setFriction(0.4), body);
    this.list.set(info.id, { info, model, tag, body, collider, snaps: [], spin: 0, x: 0, z: 0, visible: false, ghost: 0, parked: true });
  }

  /** Car or paint changed: rebuild that car. */
  change(info: PlayerInfo) {
    const r = this.list.get(info.id);
    const snaps = r?.snaps ?? [];
    this.add(info);
    this.list.get(info.id)!.snaps = snaps;
  }

  remove(id: string) {
    const r = this.list.get(id);
    if (!r) return;
    this.scene.remove(r.model.body, ...r.model.wheels);
    // The car's materials are its own copies: free them (geometry is shared with the car pack).
    for (const root of [r.model.body, ...r.model.wheels])
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.dispose();
      });
    r.tag.material.map?.dispose();
    this.world.removeRigidBody(r.body);
    this.list.delete(id);
  }

  clear() {
    for (const id of [...this.list.keys()]) this.remove(id);
  }

  pose(id: string, pose: Pose) {
    const r = this.list.get(id);
    if (!r) return;
    r.snaps.push({ t: performance.now(), pose });
    if (r.snaps.length > 6) r.snaps.shift();
  }

  isRemoteCollider(handle: number) {
    for (const r of this.list.values()) if (r.collider.handle === handle) return true;
    return false;
  }

  /** Positions for the minimap: [x, z, colour, name]. */
  dots(): [number, number, string, string][] {
    return [...this.list.values()].filter((r) => r.visible).map((r) => [r.x, r.z, playerColor(r.info.id), r.info.name]);
  }

  nameOf(id: string) {
    return this.list.get(id)?.info.name;
  }

  names(): { name: string; color: string }[] {
    return [...this.list.values()].map((r) => ({ name: r.info.name, color: playerColor(r.info.id) }));
  }

  /** Moves the bodies (call before the physics step). */
  step(dt: number) {
    for (const r of this.list.values()) {
      if (!this.sample(r)) {
        // No recent pose: move the invisible body out of the way.
        if (!r.parked) {
          r.body.setTranslation({ x: 0, y: -50, z: 0 }, true);
          r.parked = true;
        }
        continue;
      }
      const to = r.model.body.position, at = r.body.translation();
      if (r.parked || Math.hypot(to.x - at.x, to.y - at.y, to.z - at.z) > 8) {
        // A jump (respawn, or a bad pose): teleport without sweeping through other cars, and
        // don't collide for a moment so it can't land on top of someone and fling them.
        r.body.setTranslation(to, true);
        r.body.setRotation(r.model.body.quaternion, true);
        r.collider.setEnabled(false);
        r.ghost = 0.5;
        r.parked = false;
        continue;
      }
      if (r.ghost > 0) {
        r.ghost -= dt;
        if (r.ghost <= 0) r.collider.setEnabled(true);
      }
      r.body.setNextKinematicTranslation(to);
      r.body.setNextKinematicRotation(r.model.body.quaternion);
    }
  }

  /** Moves the visuals; once per frame. */
  update3d(dt: number) {
    for (const r of this.list.values()) {
      const ok = this.sample(r);
      r.visible = ok;
      r.model.body.visible = ok;
      for (const w of r.model.wheels) w.visible = ok;
      if (!ok) continue;
      const last = r.snaps[r.snaps.length - 1].pose;
      const spec = carById(r.info.car), d = spec.dims!;
      r.spin += (last[7] * dt) / d.wheelR;
      const q = r.model.body.quaternion, pos = r.model.body.position;
      const wx = d.wheelbase / 2, wz = d.track || d.width / 2 - 0.2;
      r.model.wheels.forEach((w, i) => {
        const front = i < 2, side = i % 2 ? 1 : -1;
        w.position.copy(_v.set(front ? wx : -wx, -0.38, side * wz).applyQuaternion(q).add(pos));
        _wq.setFromEuler(_e.set(0, front ? last[8] : 0, 0));
        w.quaternion.copy(q).multiply(_wq).multiply(_q.setFromAxisAngle(Z, r.spin));
      });
    }
  }

  /** Interpolated pose DELAY ms ago into model.body; false if there is no recent pose. */
  private sample(r: Remote) {
    const s = r.snaps;
    if (!s.length) return false;
    const now = performance.now();
    if (now - s[s.length - 1].t > 3000) return false; // gone quiet
    const t = now - DELAY;
    let a = s[0], b = s[0];
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i + 1].t >= t) {
        a = s[i];
        b = s[i + 1];
        break;
      }
      a = b = s[i + 1];
    }
    const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
    const A = a.pose, B = b.pose;
    // A big jump (respawn): don't slide across the map.
    const far = Math.hypot(B[0] - A[0], B[2] - A[2]) > 30;
    const kk = far ? 1 : k;
    const pos = r.model.body.position.set(A[0] + (B[0] - A[0]) * kk, A[1] + (B[1] - A[1]) * kk, A[2] + (B[2] - A[2]) * kk);
    _qa.set(A[3], A[4], A[5], A[6]).normalize();
    _qb.set(B[3], B[4], B[5], B[6]).normalize();
    r.model.body.quaternion.copy(_qa).slerp(_qb, kk);
    r.x = pos.x;
    r.z = pos.z;
    return true;
  }
}

function nameTag(name: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 34px system-ui, sans-serif';
  const w = Math.min(248, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(20,24,32,0.75)';
  g.beginPath();
  g.roundRect((256 - w) / 2, 6, w, 52, 18);
  g.fill();
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 128, 33, 230);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 10;
  return s;
}
