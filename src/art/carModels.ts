import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarDims, CarSpec } from '../game/cars';
import { groundOffset } from '../game/car';

// Cars are the Kenney "Car Kit" models (CC0), in public/models/cars.
// The models face +z with wheels as separate nodes; the game uses +x forward.

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

const SCALE = 1.55; // the kit is toy-sized; this gives roughly real car sizes
const WHEEL_NODES = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'];

interface Asset {
  body: THREE.Object3D; // model without wheels, in model space
  wheels: { mesh: THREE.Mesh; center: THREE.Vector3 }[]; // in model space
  dims: CarDims;
  bodyColor: [number, number, number] | null; // main paint colour in the texture (0-255)
  image: HTMLImageElement | ImageBitmap | null;
}
const assets = new Map<string, Asset>();

/** The most common strongly-coloured texel under the body mesh: that's the paint. */
function findBodyColor(mesh: THREE.Mesh, image: CanvasImageSource & { width: number; height: number }) {
  const c = document.createElement('canvas');
  c.width = image.width;
  c.height = image.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(image, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const uv = mesh.geometry.getAttribute('uv');
  const counts = new Map<string, number>();
  for (let i = 0; i < uv.count; i++) {
    const x = Math.min(c.width - 1, Math.floor(uv.getX(i) * c.width));
    const y = Math.min(c.height - 1, Math.floor(uv.getY(i) * c.height));
    const o = (y * c.width + x) * 4;
    const [r, gg, b] = [data[o], data[o + 1], data[o + 2]];
    const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
    if (max - min < 40 || max < 60) continue; // skip greys, black, glass
    const k = `${r},${gg},${b}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best: string | null = null, n = 0;
  for (const [k, v] of counts) if (v > n) (best = k), (n = v);
  return best ? (best.split(',').map(Number) as [number, number, number]) : null;
}

/** Loads the car models and measures them (sizes go into spec.dims for the physics). */
export async function loadCarAssets(specs: CarSpec[]) {
  const loader = new GLTFLoader();
  const base = `${import.meta.env.BASE_URL}models/cars/`;
  await Promise.all(
    specs.map(async (spec) => {
      if (!assets.has(spec.model)) {
        const gltf = await loader.loadAsync(`${base}${spec.model}.glb`);
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const wheels: Asset['wheels'] = [];
        for (const name of WHEEL_NODES) {
          const node = scene.getObjectByName(name) as THREE.Mesh | undefined;
          if (!node) continue;
          const box = new THREE.Box3().setFromObject(node);
          wheels.push({ mesh: node, center: box.getCenter(new THREE.Vector3()) });
        }
        for (const w of wheels) w.mesh.removeFromParent();
        const bodyBox = new THREE.Box3().setFromObject(scene);
        const size = bodyBox.getSize(new THREE.Vector3());
        const wb = wheels.length === 4 ? Math.abs(wheels[0].center.z - wheels[2].center.z) : size.z * 0.6;
        const track = wheels.length === 4 ? Math.abs(wheels[0].center.x) : size.x / 2 - 0.1;
        const wheelR = wheels.length ? new THREE.Box3().setFromObject(wheels[0].mesh).getSize(new THREE.Vector3()).y / 2 : 0.3;
        const bodyMesh = scene.getObjectByName('body') as THREE.Mesh | undefined;
        const image = ((bodyMesh?.material as THREE.MeshStandardMaterial | undefined)?.map?.image ?? null) as HTMLImageElement | ImageBitmap | null;
        assets.set(spec.model, {
          body: scene,
          wheels,
          image,
          bodyColor: bodyMesh && image ? findBodyColor(bodyMesh, image) : null,
          dims: {
            length: size.z * SCALE, width: size.x * SCALE, height: size.y * SCALE,
            wheelR: wheelR * SCALE, wheelbase: wb * SCALE, track: track * SCALE,
          },
        });
      }
      spec.dims = assets.get(spec.model)!.dims;
    }),
  );
}

/** Texture copy with the body colour replaced by the paint colour. */
const paintCache = new Map<string, THREE.Texture>();
function paintedTexture(asset: Asset, original: THREE.Texture, paint: number) {
  if (!paint || !asset.bodyColor || !asset.image) return original;
  const key = `${asset.bodyColor.join(',')}-${paint}`;
  const hit = paintCache.get(key);
  if (hit) return hit;
  const img = asset.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const [r0, g0, b0] = asset.bodyColor;
  const to = new THREE.Color(paint);
  const lum0 = (r0 + g0 + b0) / 3 || 1;
  for (let i = 0; i < d.data.length; i += 4) {
    const dr = d.data[i] - r0, dg = d.data[i + 1] - g0, db = d.data[i + 2] - b0;
    if (dr * dr + dg * dg + db * db > 40 * 40) continue;
    // Keep the shading of the original pixel relative to the base colour.
    const shade = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3 / lum0;
    d.data[i] = Math.min(255, to.r * 255 * shade);
    d.data[i + 1] = Math.min(255, to.g * 255 * shade);
    d.data[i + 2] = Math.min(255, to.b * 255 * shade);
  }
  g.putImageData(d, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = original.flipY;
  tex.colorSpace = original.colorSpace;
  tex.magFilter = original.magFilter;
  tex.minFilter = original.minFilter;
  paintCache.set(key, tex);
  return tex;
}

/** A new instance of a car model, origin at the physics chassis centre. */
export function buildCarModel(spec: CarSpec, paint = 0, opts: { police?: boolean } = {}): CarModel {
  const asset = assets.get(spec.model);
  if (!asset) throw new Error(`Car model not loaded: ${spec.model}`);
  const dims = asset.dims;

  // Each instance gets its own materials (for paint and fading).
  const materials: THREE.MeshStandardMaterial[] = [];
  const own = (o: THREE.Object3D) =>
    o.traverse((m) => {
      if (m instanceof THREE.Mesh) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        materials.push(m.material);
        m.castShadow = true;
      }
    });

  const inner = asset.body.clone(true);
  own(inner);
  inner.scale.setScalar(SCALE);
  inner.rotation.y = Math.PI / 2; // model +z -> game +x
  inner.position.y = -groundOffset(dims.wheelR);
  const body = new THREE.Group();
  body.add(inner);

  const wheels = asset.wheels.map(({ mesh, center }) => {
    const w = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.PI / 2;
    pivot.scale.setScalar(SCALE);
    const m = mesh.clone();
    own(m);
    // Put the wheel's centre at the pivot origin.
    m.position.sub(center);
    pivot.add(m);
    w.add(pivot);
    return w;
  });

  let flash: CarModel['flash'];
  if (opts.police) {
    // Extra flashing beacons on the roof.
    const blueA = new THREE.MeshBasicMaterial({ color: 0x2050ff }), blueB = new THREE.MeshBasicMaterial({ color: 0x2050ff });
    const y = dims.height - groundOffset(dims.wheelR) + 0.05;
    for (const [mat, z] of [[blueA, -0.3], [blueB, 0.3]] as const) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.35), mat);
      b.position.set(-0.1, y, z);
      body.add(b);
    }
    flash = (t) => {
      const on = Math.floor(t * 6) % 2 === 0;
      blueA.color.setHex(on ? 0x6d95ff : 0x0a1440);
      blueB.color.setHex(on ? 0x0a1440 : 0x6d95ff);
    };
  }

  const originals = new Map(materials.map((m) => [m, m.map]));
  const setPaint = (hex: number) => {
    for (const m of materials) {
      const orig = originals.get(m);
      if (!orig) continue;
      m.map = paintedTexture(asset, orig, hex);
      m.needsUpdate = true;
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
        m.transparent = v < 1;
        m.opacity = v;
      }
    },
    flash,
  };
}
