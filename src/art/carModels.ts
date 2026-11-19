import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { CarDims, CarSpec } from '../game/cars';
import { groundOffset } from '../game/car';

// Cars come from "Generic passenger car pack" by Comrade1280 (CC BY 4.0), one GLB with
// ten cars standing in a circle. Each car is taken out, straightened to face +x and scaled.

export interface CarModel {
  body: THREE.Group;
  wheels: THREE.Object3D[]; // front-left, front-right, rear-left, rear-right
  /** How far the visual wheels sit outside the physics wheel position (m). */
  wheelOutset: number;
  setPaint: (color: number) => void;
  setOpacity: (v: number) => void;
  /** Police only: flash the roof lights (time in seconds). */
  flash?: (t: number) => void;
}

interface Asset {
  body: THREE.Object3D; // in car space: +x forward, ground at y = 0, centred between the wheels
  wheels: THREE.Object3D[]; // each centred on its own axle, in car orientation
  dims: CarDims;
}
const assets = new Map<string, Asset>();
let pack: Promise<THREE.Group> | null = null;

/** Model id format: "<Body node name>|<length in m>|<flip 0/1>". */
function parseModel(model: string) {
  const [name, len, flip] = model.split('|');
  return { name, length: Number(len), flip: flip === '1' };
}

function extract(scene: THREE.Object3D, model: string): Asset {
  const { name, length, flip } = parseModel(model);
  const bodyNode = scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name)); // loader turns spaces into _
  if (!bodyNode) throw new Error(`Car not in pack: ${name}`);
  const center = new THREE.Box3().setFromObject(bodyNode).getCenter(new THREE.Vector3());

  // The four wheels nearest to this body belong to it.
  const all: { o: THREE.Object3D; c: THREE.Vector3; box: THREE.Box3 }[] = [];
  scene.traverse((o) => {
    if (/^Wheel_/.test(o.name) && o.parent?.name === 'RootNode') {
      const box = new THREE.Box3().setFromObject(o);
      all.push({ o, c: box.getCenter(new THREE.Vector3()), box });
    }
  });
  all.sort((a, b) => a.c.distanceTo(center) - b.c.distanceTo(center));
  const wheels = all.slice(0, 4);

  // Long axis of the car = main direction of the wheel layout (PCA in the ground plane).
  const m = wheels.reduce((s, w) => s.add(w.c), new THREE.Vector3()).multiplyScalar(1 / 4);
  let sxx = 0, sxz = 0, szz = 0;
  for (const w of wheels) {
    const dx = w.c.x - m.x, dz = w.c.z - m.z;
    sxx += dx * dx; sxz += dx * dz; szz += dz * dz;
  }
  let ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  if (flip) ang += Math.PI;
  const groundY = Math.min(...wheels.map((w) => w.box.min.y));

  // World -> car space (rotate so the long axis is +x), then scale to the real length.
  const toCar = new THREE.Matrix4()
    .makeRotationY(ang)
    .multiply(new THREE.Matrix4().makeTranslation(-m.x, -groundY, -m.z));
  const tmp = bodyNode.clone(true);
  tmp.matrixAutoUpdate = false;
  tmp.matrix.copy(toCar).multiply(bodyNode.matrixWorld);
  const holder = new THREE.Group().add(tmp);
  holder.updateMatrixWorld(true);
  const raw = new THREE.Box3().setFromObject(holder).getSize(new THREE.Vector3());
  const s = length / raw.x;
  toCar.premultiply(new THREE.Matrix4().makeScale(s, s, s));

  const body = bodyNode.clone(true);
  body.matrixAutoUpdate = false;
  body.matrix.copy(toCar).multiply(bodyNode.matrixWorld);
  const bodyHolder = new THREE.Group().add(body);
  bodyHolder.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(bodyHolder).getSize(new THREE.Vector3());

  // Wheels: centred on their axle, sorted front-left, front-right, rear-left, rear-right.
  const placed = wheels.map(({ o, c }) => {
    const cc = c.clone().applyMatrix4(toCar);
    const inner = o.clone(true);
    inner.matrixAutoUpdate = false;
    inner.matrix.makeTranslation(-cc.x, -cc.y, -cc.z).multiply(toCar).multiply(o.matrixWorld);
    const w = new THREE.Group().add(inner);
    return { w, cc };
  });
  placed.sort((a, b) => (Math.sign(b.cc.x) - Math.sign(a.cc.x)) * 2 + Math.sign(a.cc.z - b.cc.z));
  const front = placed.filter((p) => p.cc.x > 0), rear = placed.filter((p) => p.cc.x <= 0);
  const wheelR = placed.reduce((sum, p) => sum + p.cc.y, 0) / 4;
  const wheelbase = front.reduce((a, p) => a + p.cc.x, 0) / Math.max(1, front.length) - rear.reduce((a, p) => a + p.cc.x, 0) / Math.max(1, rear.length);

  return {
    body: bodyHolder,
    wheels: placed.map((p) => p.w),
    dims: {
      length: size.x, width: size.z, height: size.y,
      wheelR, wheelbase, track: placed.reduce((a, p) => a + Math.abs(p.cc.z), 0) / 4,
    },
  };
}

/** Loads the car pack and prepares every car (sizes go into spec.dims for the physics). */
export async function loadCarAssets(specs: CarSpec[]) {
  if (!pack) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    pack = loader.loadAsync(`${import.meta.env.BASE_URL}models/cars/car-pack.glb`).then((g) => {
      g.scene.updateMatrixWorld(true);
      return g.scene;
    });
  }
  const scene = await pack;
  for (const spec of specs) {
    if (!assets.has(spec.model)) assets.set(spec.model, extract(scene, spec.model));
    spec.dims = assets.get(spec.model)!.dims;
  }
}

/** Greyscale copy of a paint texture, so a colour can be multiplied onto it. */
const greyCache = new Map<THREE.Texture, THREE.Texture>();
function greyTexture(tex: THREE.Texture) {
  const hit = greyCache.get(tex);
  if (hit) return hit;
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const l = Math.min(255, (0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2]) * 1.6 + 40);
    d.data[i] = d.data[i + 1] = d.data[i + 2] = l;
  }
  g.putImageData(d, 0, 0);
  const out = new THREE.CanvasTexture(c);
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace;
  out.wrapS = tex.wrapS;
  out.wrapT = tex.wrapT;
  greyCache.set(tex, out);
  return out;
}

/** A new instance of a car, origin at the physics chassis centre. */
export function buildCarModel(spec: CarSpec, paint = 0, opts: { police?: boolean } = {}): CarModel {
  const asset = assets.get(spec.model);
  if (!asset) throw new Error(`Car model not loaded: ${spec.model}`);
  const dims = asset.dims;

  const materials: THREE.MeshStandardMaterial[] = [];
  const paintable: { m: THREE.MeshStandardMaterial; map: THREE.Texture | null; color: THREE.Color }[] = [];
  const own = (root: THREE.Object3D) =>
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const src = o.material as THREE.MeshStandardMaterial;
      let m: THREE.MeshStandardMaterial;
      if (/glass/i.test(src.name)) {
        // Plain tinted glass instead of (slow) transmission.
        m = new THREE.MeshStandardMaterial({ color: 0x1b2633, metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.72 });
      } else {
        m = src.clone();
        if (/^body/i.test(src.name)) {
          m.metalness = Math.max(m.metalness, 0.45);
          m.roughness = Math.min(m.roughness, 0.35);
          paintable.push({ m, map: m.map, color: m.color.clone() });
        }
      }
      o.material = m;
      materials.push(m);
      o.castShadow = true;
    });

  const inner = asset.body.clone(true);
  own(inner);
  inner.position.y = -groundOffset(dims.wheelR);
  const body = new THREE.Group().add(inner);
  const wheels = asset.wheels.map((w) => {
    const c = w.clone(true);
    own(c);
    return c;
  });

  let flash: CarModel['flash'];
  if (opts.police) {
    const y = dims.height - groundOffset(dims.wheelR);
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1d20 });
    const blueA = new THREE.MeshBasicMaterial({ color: 0x2050ff }), blueB = new THREE.MeshBasicMaterial({ color: 0x2050ff });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, dims.width * 0.55), dark);
    bar.position.set(-0.2, y + 0.02, 0);
    body.add(bar);
    for (const [mat, z] of [[blueA, -1], [blueB, 1]] as const) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, dims.width * 0.24), mat);
      b.position.set(-0.2, y + 0.08, (z * dims.width) / 7);
      body.add(b);
    }
    // Dutch police stripes: blue with a yellow edge, along both sides.
    for (const side of [-1, 1]) {
      const blue = new THREE.Mesh(new THREE.BoxGeometry(dims.length * 0.6, 0.16, 0.02), new THREE.MeshStandardMaterial({ color: 0x1f3f9a }));
      blue.position.set(0, 0.7 - groundOffset(dims.wheelR), side * (dims.width / 2 - 0.02));
      const yellow = new THREE.Mesh(new THREE.BoxGeometry(dims.length * 0.6, 0.05, 0.02), new THREE.MeshStandardMaterial({ color: 0xf2b31a }));
      yellow.position.set(0, 0.81 - groundOffset(dims.wheelR), side * (dims.width / 2 - 0.02));
      body.add(blue, yellow);
    }
    flash = (t) => {
      const on = Math.floor(t * 6) % 2 === 0;
      blueA.color.setHex(on ? 0x6d95ff : 0x0a1440);
      blueB.color.setHex(on ? 0x0a1440 : 0x6d95ff);
    };
  }

  const setPaint = (hex: number) => {
    for (const p of paintable) {
      if (!hex) {
        p.m.map = p.map;
        p.m.color.copy(p.color);
      } else {
        p.m.map = p.map ? greyTexture(p.map) : null;
        p.m.color.setHex(hex);
      }
      p.m.needsUpdate = true;
    }
  };
  if (paint) setPaint(paint);

  return {
    body,
    wheels,
    wheelOutset: 0,
    setPaint,
    setOpacity: (v) => {
      for (const m of materials) {
        const glass = m.opacity < 1 && m.transparent && m.roughness === 0.05;
        m.transparent = glass || v < 1;
        m.opacity = glass ? 0.72 * v : v;
      }
    },
    flash,
  };
}

/** Frees a car model's own materials (geometry and textures are shared with the car pack). */
export function disposeCarModel(model: CarModel) {
  for (const root of [model.body, ...model.wheels])
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) for (const mm of Array.isArray(m) ? m : [m]) mm.dispose();
    });
}
