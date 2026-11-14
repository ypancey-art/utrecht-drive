import * as THREE from 'three';

export interface CarLook { body: number; cabin: number }

/** Low-poly car. Forward is +x. Returns the body group and 4 wheel meshes (FL, FR, RL, RR). */
export function buildCarMesh(look: CarLook = { body: 0xe23b3b, cabin: 0x2b3a4a }) {
  const body = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: look.body });
  const glass = new THREE.MeshLambertMaterial({ color: look.cabin });
  const lower = new THREE.Mesh(new THREE.BoxGeometry(4, 0.7, 1.8), paint);
  lower.position.y = 0;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.6, 1.6), glass);
  cabin.position.set(-0.3, 0.65, 0);
  const lights = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 1.4), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
  lights.position.set(2.0, 0.1, 0);
  for (const m of [lower, cabin]) m.castShadow = true;
  body.add(lower, cabin, lights);

  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 12).rotateX(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1b1b1b });
  const wheels = [0, 1, 2, 3].map(() => {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.castShadow = true;
    return w;
  });
  /** Fades the car out (1 = solid, 0 = gone), e.g. while it sinks. */
  const materials = new Set<THREE.Material>();
  for (const o of [body, ...wheels]) o.traverse((m) => m instanceof THREE.Mesh && materials.add(m.material as THREE.Material));
  const setOpacity = (v: number) => {
    for (const m of materials) {
      m.transparent = v < 1;
      m.opacity = v;
    }
  };
  return { body, wheels, setOpacity };
}
