// Simple low-poly people and bikes. Local +x is forward, y up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PersonKind, PersonVisual } from '../game/people';
import { getLang } from '../i18n';

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

/** A flat five-pointed star (for the dizzy stars and the crash sparks). */
function starGeometry(r: number) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    if (i) shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return new THREE.ShapeGeometry(shape);
}
const starMat = new THREE.MeshBasicMaterial({ color: 0xffd21f, side: THREE.DoubleSide });
const starGeo = starGeometry(0.11);

export function makePersonVisual(scene: THREE.Scene, kind: PersonKind): PersonVisual {
  const root = new THREE.Group(); // position + heading
  const tilt = new THREE.Group(); // falling over, tumbling through the air
  root.add(tilt);
  const kid = Math.random() < 0.25;
  const s = kid ? 0.7 : 0.9 + Math.random() * 0.15;
  const body = new THREE.Group();
  body.scale.setScalar(s);
  tilt.add(body);
  const shirt = pick(SHIRT), skin = pick(SKIN), hair = pick(HAIR), pants = pick(PANTS);
  const legs: THREE.Group[] = [];
  let wheels: THREE.Mesh[] = [];
  // The bike has its own place in the world, so it can fly off on its own in a crash.
  const bikeRoot = new THREE.Group();
  const bike = new THREE.Group();
  bike.scale.setScalar(s);
  bikeRoot.add(bike);
  const BIKE_PIVOT = 0.5 * s;

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
    bike.add(mesh(frame));
    wheels = [-0.52, 0.55].map((x) => {
      const w = new THREE.Mesh(new THREE.TorusGeometry(R, 0.03, 6, 18), new THREE.MeshLambertMaterial({ color: 0x1b1b1b }));
      w.position.set(x, R, 0);
      bike.add(w);
      return w;
    });
    scene.add(bikeRoot);
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
  // Dizzy stars circling the head while lying on the ground.
  const dizzy = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Mesh(starGeo, starMat);
    st.position.set(Math.cos((i * 2 * Math.PI) / 3) * 0.35, 0, Math.sin((i * 2 * Math.PI) / 3) * 0.35);
    st.rotation.x = -Math.PI / 2;
    st.scale.setScalar(1.8);
    dizzy.add(st);
  }
  dizzy.visible = false;
  root.add(dizzy);
  const HEAD = (kind === 'walker' ? 1.57 : 1.62) * s; // head height when standing
  const PIVOT = 0.9 * s; // tumble around the middle of the body
  scene.add(root);
  return {
    sync(x, z, heading, phase, fallen, flight) {
      root.position.set(x, 0, z);
      root.rotation.y = -heading;
      const flying = !!flight && fallen === 0 && (flight.y > 0 || flight.spin !== 0);
      if (flying) {
        tilt.position.y = flight.y + PIVOT;
        tilt.rotation.z = -flight.spin;
        body.position.y = -PIVOT; // so the body turns around its middle
        // Arms and legs flail.
        legs[0].rotation.z = Math.sin(flight.spin * 3) * 0.9;
        legs[1].rotation.z = -Math.sin(flight.spin * 3) * 0.9;
      } else {
        tilt.rotation.z = -fallen * (Math.PI / 2) * 0.95;
        tilt.position.y = fallen * 0.15 + (flight?.y ?? 0);
        body.position.y = 0;
        if (kind === 'walker' || flight) {
          const swing = Math.sin(phase) * 0.5 * (1 - fallen);
          legs[0].rotation.z = flight ? 0.3 : swing;
          legs[1].rotation.z = flight ? -0.2 : -swing;
          if (!flight) body.position.y = Math.abs(Math.cos(phase)) * 0.03;
        } else {
          // Pedalling: legs go round with the cranks.
          legs[0].rotation.z = 0.6 + Math.sin(phase) * 0.45;
          legs[1].rotation.z = 0.6 - Math.sin(phase) * 0.45;
        }
      }
      dizzy.visible = !!flight && fallen > 0.6;
      if (dizzy.visible) {
        dizzy.position.set(HEAD * 0.95, 0.45, 0);
        dizzy.rotation.y += 0.12;
      }
      if (kind === 'cyclist') {
        const b = flight?.bike;
        if (!b) {
          bikeRoot.position.set(x, 0, z);
          bikeRoot.rotation.set(0, -heading, 0);
          bike.position.y = 0;
        } else {
          bikeRoot.rotation.set(0, -b.heading, 0, 'YXZ');
          if (b.rest) {
            // Lying on its side.
            bikeRoot.position.set(b.x, 0.06, b.z);
            bike.position.y = -BIKE_PIVOT;
            bikeRoot.rotation.x = Math.PI / 2;
          } else {
            bikeRoot.position.set(b.x, b.y + BIKE_PIVOT, b.z);
            bike.position.y = -BIKE_PIVOT;
            bikeRoot.rotation.x = b.spin;
            bikeRoot.rotation.z = b.spin * 0.6;
          }
        }
        for (const w of wheels) w.rotation.z -= flight?.bike && !flight.bike.rest ? 0.5 : 0;
      }
    },
    dispose() {
      scene.remove(root);
      scene.remove(bikeRoot);
      for (const r of [root, bikeRoot])
        r.traverse((o) => {
          if (o instanceof THREE.Mesh && o.geometry !== starGeo) o.geometry.dispose();
        });
      wheels = [];
    },
  };
}

const WORDS = { nl: ['BOEM!', 'PATS!', 'KNAL!', 'OEPS!'], en: ['BAM!', 'POW!', 'BONK!', 'OOPS!'] };

/** Comic-book crash effects: a big word that pops up, and yellow stars flying out. */
export function makeCrashFx(scene: THREE.Scene) {
  const live: { obj: THREE.Object3D; t: number; life: number; vel?: THREE.Vector3; grow?: number; mat: THREE.Material & { opacity: number } }[] = [];
  const textures = new Map<string, THREE.Texture>();
  const wordTexture = (word: string) => {
    let tex = textures.get(word);
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    const g = c.getContext('2d')!;
    // Spiky burst behind the word.
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r = i % 2 ? 50 : 78;
      g.lineTo(128 + Math.cos(a) * r * 1.5, 80 + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = '#ffd21f';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#d7262e';
    g.stroke();
    g.font = 'bold 56px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 8;
    g.strokeStyle = '#1d1f22';
    g.strokeText(word, 128, 82);
    g.fillStyle = '#d7262e';
    g.fillText(word, 128, 82);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.set(word, tex);
    return tex;
  };
  return {
    burst(x: number, z: number, strength: number) {
      const words = WORDS[getLang()] ?? WORDS.nl;
      const mat = new THREE.SpriteMaterial({ map: wordTexture(pick(words)), transparent: true, depthTest: false });
      const sp = new THREE.Sprite(mat);
      sp.position.set(x, 4.2, z);
      sp.renderOrder = 10;
      scene.add(sp);
      live.push({ obj: sp, t: 0, life: 0.8, grow: 1.2 + strength * 0.9, mat });
      for (let i = 0; i < 6 + Math.round(strength * 8); i++) {
        const m = new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffd21f : 0xffffff, side: THREE.DoubleSide, transparent: true });
        const st = new THREE.Mesh(starGeo, m);
        st.position.set(x, 1.2, z);
        st.scale.setScalar(1.5);
        const a = Math.random() * Math.PI * 2;
        const v = 3 + Math.random() * 4 * (0.5 + strength);
        scene.add(st);
        live.push({ obj: st, t: 0, life: 0.9, vel: new THREE.Vector3(Math.cos(a) * v, 4 + Math.random() * 4, Math.sin(a) * v), mat: m });
      }
    },
    update(dt: number, camera: THREE.Camera) {
      for (const e of [...live]) {
        e.t += dt;
        const k = e.t / e.life;
        if (e.vel) {
          e.vel.y -= 12 * dt;
          e.obj.position.addScaledVector(e.vel, dt);
          e.obj.quaternion.copy(camera.quaternion);
          e.obj.rotateZ(e.t * 8);
        } else {
          // Pop up fast, wobble, then fade.
          const sc = e.grow! * Math.min(1, k * 6) * (1 + Math.sin(e.t * 30) * 0.05 * (1 - k));
          e.obj.scale.set(sc * 1.6, sc, 1);
          e.obj.position.y += dt * 0.8;
        }
        e.mat.opacity = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
        if (k >= 1) {
          scene.remove(e.obj);
          e.mat.dispose();
          live.splice(live.indexOf(e), 1);
        }
      }
    },
  };
}
