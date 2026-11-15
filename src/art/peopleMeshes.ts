// Simple low-poly people and bikes. Local +x is forward, y up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PersonKind, PersonVisual } from '../game/people';

const SKIN = [0xf1c7a5, 0xd9a07a, 0xa86b45, 0x6e4329, 0xe8b894];
const SHIRT = [0xd94a3a, 0x2f7fd8, 0xf2c14e, 0x43a75b, 0xffffff, 0x1d1f22, 0x8e5bd1, 0xff8a3d, 0x4fc1c9];
const PANTS = [0x26303f, 0x3b4f73, 0x1d1f22, 0x6b5a45, 0x8a8f96];
const HAIR = [0x2a1d14, 0x5a3a1f, 0xd8b56a, 0x111111, 0x9a5a2a];
const BIKE = [0x1d1f22, 0xd94a3a, 0x2f7fd8, 0x43a75b, 0xf2f2f2];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function colored(geo: THREE.BufferGeometry, color: number, m?: THREE.Matrix4) {
  const g = (geo.index ? geo.toNonIndexed() : geo);
  if (m) g.applyMatrix4(m);
  g.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

function mesh(parts: THREE.BufferGeometry[]) {
  const m = new THREE.Mesh(mergeGeometries(parts), mat);
  m.castShadow = true;
  return m;
}

/** Upper body (torso, arms, head, hair) with its feet at y = 0 relative to the hip height given. */
function upperBody(hip: number, shirt: number, skin: number, hair: number, armsForward = false) {
  const parts = [
    colored(new THREE.BoxGeometry(0.26, 0.55, 0.38), shirt, at(0, hip + 0.3, 0)),
    colored(new THREE.SphereGeometry(0.13, 10, 8), skin, at(0, hip + 0.72, 0)),
    colored(new THREE.SphereGeometry(0.135, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), hair, at(-0.01, hip + 0.74, 0)),
  ];
  for (const s of [-1, 1]) {
    if (armsForward) parts.push(colored(new THREE.BoxGeometry(0.45, 0.09, 0.09), shirt, at(0.2, hip + 0.42, s * 0.22, 0, 0, -0.5)));
    else parts.push(colored(new THREE.BoxGeometry(0.09, 0.5, 0.09), shirt, at(0, hip + 0.3, s * 0.24)));
  }
  return parts;
}

function leg(len: number, pants: number) {
  // Pivot at the hip: the leg hangs down from y = 0.
  const g = new THREE.Group();
  g.add(mesh([colored(new THREE.BoxGeometry(0.12, len, 0.12), pants, at(0, -len / 2, 0)), colored(new THREE.BoxGeometry(0.2, 0.08, 0.12), 0x222222, at(0.04, -len + 0.04, 0))]));
  return g;
}

export function makePersonVisual(scene: THREE.Scene, kind: PersonKind): PersonVisual {
  const root = new THREE.Group(); // position + heading
  const tilt = new THREE.Group(); // falling over
  root.add(tilt);
  const kid = Math.random() < 0.25;
  const s = kid ? 0.7 : 0.9 + Math.random() * 0.15;
  const body = new THREE.Group();
  body.scale.setScalar(s);
  tilt.add(body);
  const shirt = pick(SHIRT), skin = pick(SKIN), hair = pick(HAIR), pants = pick(PANTS);
  const legs: THREE.Group[] = [];
  let wheels: THREE.Mesh[] = [];

  if (kind === 'walker') {
    const HIP = 0.85;
    body.add(mesh(upperBody(HIP, shirt, skin, hair)));
    for (const z of [-0.09, 0.09]) {
      const l = leg(HIP, pants);
      l.position.set(0, HIP, z);
      body.add(l);
      legs.push(l);
    }
  } else {
    // Dutch city bike: two wheels, frame, saddle, handlebar; rider sits upright.
    const color = pick(BIKE);
    const R = 0.34;
    const frame = [
      colored(new THREE.CylinderGeometry(0.025, 0.025, 0.75, 6), color, at(0, 0.55, 0, 0, 0, Math.PI / 2 - 0.15)),
      colored(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), color, at(-0.12, 0.55, 0, 0, 0, 0.35)),
      colored(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6), color, at(0.42, 0.62, 0, 0, 0, 0.3)),
      colored(new THREE.BoxGeometry(0.22, 0.05, 0.12), 0x222222, at(-0.22, 0.86, 0)),
      colored(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6), 0x333333, at(0.5, 0.92, 0, Math.PI / 2)),
      colored(new THREE.BoxGeometry(0.3, 0.04, 0.16), 0x333333, at(-0.48, 0.66, 0)), // rack
    ];
    body.add(mesh(frame));
    wheels = [-0.52, 0.55].map((x) => {
      const w = new THREE.Mesh(new THREE.TorusGeometry(R, 0.03, 6, 18), new THREE.MeshLambertMaterial({ color: 0x1b1b1b }));
      w.position.set(x, R, 0);
      body.add(w);
      return w;
    });
    const HIP = 0.9;
    const up = mesh(upperBody(HIP, shirt, skin, hair, true));
    up.position.x = -0.18;
    body.add(up);
    for (const z of [-0.1, 0.1]) {
      const l = leg(0.62, pants);
      l.position.set(-0.18, HIP, z);
      body.add(l);
      legs.push(l);
    }
  }
  scene.add(root);
  return {
    sync(x, z, heading, phase, fallen) {
      root.position.set(x, 0, z);
      root.rotation.y = -heading;
      tilt.rotation.z = -fallen * (Math.PI / 2) * 0.95;
      tilt.position.y = fallen * 0.15;
      if (kind === 'walker') {
        const swing = Math.sin(phase) * 0.5 * (1 - fallen);
        legs[0].rotation.z = swing;
        legs[1].rotation.z = -swing;
        body.position.y = Math.abs(Math.cos(phase)) * 0.03;
      } else {
        // Pedalling: legs go round with the cranks.
        legs[0].rotation.z = 0.6 + Math.sin(phase) * 0.45;
        legs[1].rotation.z = 0.6 - Math.sin(phase) * 0.45;
      }
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      wheels = [];
    },
  };
}
