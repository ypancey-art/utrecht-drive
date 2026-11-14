import * as THREE from 'three';
import type { CarShape } from '../game/cars';
import { groundOffset } from '../game/car';

export interface CarModel {
  body: THREE.Group;
  wheels: THREE.Object3D[];
  setPaint: (color: number) => void;
  setOpacity: (v: number) => void;
  /** Police only: flash the roof lights (time in seconds). */
  flash?: (t: number) => void;
}

const glassMat = () => new THREE.MeshPhongMaterial({ color: 0x18202a, shininess: 90, specular: 0x8899aa });
const trimMat = () => new THREE.MeshLambertMaterial({ color: 0x1c1d20 });
const lightMat = (color: number) => new THREE.MeshBasicMaterial({ color });

function extrude(points: [number, number][], depth: number, bevel = 0.04) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: depth - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2,
  });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  return g;
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * Low-poly contemporary car from a few shape numbers. Built with the ground at y = 0,
 * then shifted so the group origin matches the physics chassis centre.
 */
export function buildCarModel(s: CarShape, paint: number, opts: { police?: boolean } = {}): CarModel {
  const car = new THREE.Group();
  const L = s.length, W = s.width, hl = L / 2;
  const paintMat = new THREE.MeshPhongMaterial({ color: paint, shininess: 70, specular: 0x666666 });
  const roofMat = s.roofColor !== undefined ? new THREE.MeshPhongMaterial({ color: s.roofColor, shininess: 60 }) : paintMat;
  const glass = glassMat(), trim = trimMat();

  // Lower body (side profile, extruded across the width).
  const c = s.clearance;
  const lower = extrude(
    [
      [-hl, c + 0.15], [-hl + 0.12, c], [hl - 0.18, c], [hl, c + 0.18],
      [hl, s.noseTop], [hl - s.hood, s.belt], [-hl + Math.max(s.deck, 0.05), s.belt], [-hl, Math.min(s.tailTop, s.belt)],
    ],
    W,
  );
  car.add(new THREE.Mesh(lower, paintMat));

  // Glasshouse, narrowing towards the roof.
  const gh = extrude(
    [[-hl + s.deck, s.belt], [-hl + s.roofRear, s.height - 0.05], [hl - s.roofFront, s.height - 0.05], [hl - s.hood, s.belt]],
    W - 0.14, 0.03,
  );
  const p = gh.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const k = Math.max(0, (p.getY(i) - s.belt) / (s.height - s.belt));
    p.setZ(i, p.getZ(i) * (1 - 0.16 * k));
  }
  gh.computeVertexNormals();
  car.add(new THREE.Mesh(gh, glass));

  // Roof panel and pillars.
  const roofLen = L - s.roofFront - s.roofRear;
  const roofMid = (-hl + s.roofRear + hl - s.roofFront) / 2;
  car.add(box(roofLen + 0.1, 0.07, (W - 0.14) * 0.84 + 0.02, roofMat, roofMid, s.height - 0.03, 0));
  const bx = roofMid - roofLen * 0.05;
  for (const side of [-1, 1]) {
    const zPillar = side * ((W - 0.14) / 2) * 0.92;
    const pillar = box(0.12, s.height - s.belt, 0.04, roofMat, bx, (s.height + s.belt) / 2, zPillar);
    pillar.rotation.x = side * 0.08;
    car.add(pillar);
    car.add(box(0.18, 0.1, 0.12, paintMat, hl - s.hood - 0.05, s.belt + 0.08, side * (W / 2 + 0.03))); // mirror
  }
  if (s.roofColor !== undefined && s.lights === 'buzz') {
    // ID. Buzz style: light upper body band above the belt line.
    car.add(box(L - s.hood - 0.15, 0.12, W + 0.005, roofMat, -s.hood / 2 + 0.02, s.belt + 0.03, 0));
  }

  // Dark sills and bumpers.
  car.add(box(L - 1.2, 0.12, W + 0.02, trim, 0, c + 0.06, 0));
  car.add(box(0.1, 0.18, W - 0.1, trim, hl - 0.02, c + 0.12, 0));
  car.add(box(0.1, 0.18, W - 0.1, trim, -hl + 0.02, c + 0.14, 0));

  // Lights.
  const white = lightMat(0xf4f8ff), red = lightMat(0xd0202a);
  const fy = s.noseTop - 0.07;
  const front = (w: number, h: number, z: number, y = fy) => car.add(box(0.04, h, w, white, hl + 0.005, y, z));
  switch (s.lights) {
    case 'bar':
      front(W * 0.86, 0.035, 0);
      for (const z of [-1, 1]) front(0.06, 0.16, z * W * 0.4, fy - 0.1);
      break;
    case 'quad':
      for (const z of [-1, 1]) for (const dz of [-0.07, 0.07]) for (const dy of [0, -0.09]) front(0.07, 0.06, z * W * 0.36 + dz, fy + dy);
      break;
    case 'round':
      for (const z of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.05, 14).rotateZ(Math.PI / 2), white);
        lens.position.set(hl - 0.05, fy - 0.04, z * W * 0.33);
        car.add(lens, box(0.03, 0.03, 0.22, trim, hl - 0.02, fy + 0.07, z * W * 0.33));
      }
      break;
    case 'slim':
      for (const z of [-1, 1]) front(0.42, 0.06, z * W * 0.34);
      break;
    case 'buzz': {
      for (const z of [-1, 1]) front(0.3, 0.14, z * W * 0.34, s.noseTop - 0.12);
      front(W * 0.4, 0.025, 0, s.noseTop - 0.12);
      const logo = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 16).rotateZ(Math.PI / 2), lightMat(0xdfe3e8));
      logo.position.set(hl + 0.01, s.noseTop - 0.12, 0);
      car.add(logo);
      break;
    }
  }
  if (s.lights === 'round' || s.lights === 'slim') {
    for (const z of [-1, 1]) car.add(box(0.04, 0.09, 0.3, red, -hl - 0.005, Math.min(s.tailTop, s.belt) - 0.12, z * W * 0.36));
  } else {
    car.add(box(0.04, 0.05, W * 0.88, red, -hl - 0.005, Math.min(s.tailTop, s.belt) - 0.1, 0)); // full-width tail bar
  }

  // Police livery: blue/yellow side stripes and a roof light bar.
  let flash: CarModel['flash'];
  if (opts.police) {
    for (const side of [-1, 1]) {
      car.add(box(L * 0.8, 0.12, 0.01, lightMat(0x1f3f9a), 0, s.belt - 0.22, side * (W / 2 + 0.01)));
      car.add(box(L * 0.8, 0.05, 0.01, lightMat(0xf2b31a), 0, s.belt - 0.13, side * (W / 2 + 0.01)));
    }
    const bar = box(0.25, 0.08, W * 0.65, trim, roofMid, s.height + 0.04, 0);
    const blueA = lightMat(0x2050ff), blueB = lightMat(0x2050ff);
    const la = box(0.22, 0.09, W * 0.28, blueA, roofMid, s.height + 0.08, -W * 0.17);
    const lb = box(0.22, 0.09, W * 0.28, blueB, roofMid, s.height + 0.08, W * 0.17);
    car.add(bar, la, lb);
    flash = (t) => {
      const on = Math.floor(t * 6) % 2 === 0;
      blueA.color.setHex(on ? 0x4d7dff : 0x0a1440);
      blueB.color.setHex(on ? 0x0a1440 : 0x4d7dff);
    };
  }

  car.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  car.position.y = -groundOffset(s.wheelR);
  const body = new THREE.Group();
  body.add(car);

  // Wheels: tyre + rim; spun by the game around their local z axis.
  const tyreGeo = new THREE.CylinderGeometry(s.wheelR, s.wheelR, 0.24, 16).rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(s.wheelR * 0.62, s.wheelR * 0.62, 0.25, 10).rotateX(Math.PI / 2);
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x18181a });
  const rimMat = new THREE.MeshPhongMaterial({ color: 0xb8bcc2, shininess: 80 });
  const wheels = [0, 1, 2, 3].map(() => {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.castShadow = true;
    w.add(tyre, new THREE.Mesh(rimGeo, rimMat));
    return w;
  });

  const materials = new Set<THREE.Material>();
  for (const o of [body, ...wheels]) o.traverse((m) => m instanceof THREE.Mesh && materials.add(m.material as THREE.Material));
  return {
    body,
    wheels,
    setPaint: (color) => paintMat.color.setHex(color),
    setOpacity: (v) => {
      for (const m of materials) {
        m.transparent = v < 1;
        m.opacity = v;
      }
    },
    flash,
  };
}
