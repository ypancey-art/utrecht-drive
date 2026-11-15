// Splits big static meshes into square tiles so the renderer can skip whatever is behind the
// camera, beyond the fog, or outside the shadow area. Merged city-wide meshes (all buildings in
// one draw call) are cheap on the CPU but force the GPU to process everything every frame.
import * as THREE from 'three';

const TILE = 200;
const key = (x: number, z: number) => Math.floor(x / TILE) * 4096 + Math.floor(z / TILE);

function splitGeometry(geo: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const P = pos.array as ArrayLike<number>;
  const I = geo.index ? (geo.index.array as ArrayLike<number>) : null;
  const triCount = (I ? I.length : pos.count) / 3;
  const v = (t: number, k: number) => (I ? I[t * 3 + k] : t * 3 + k);
  // Group triangles by the tile of their centre.
  const groups = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const a = v(t, 0) * 3, b = v(t, 1) * 3, c = v(t, 2) * 3;
    const kk = Math.floor((P[a] + P[b] + P[c]) / 3 / TILE) * 4096 + Math.floor((P[a + 2] + P[b + 2] + P[c + 2]) / 3 / TILE);
    const list = groups.get(kk);
    if (list) list.push(t);
    else groups.set(kk, [t]);
  }
  if (groups.size <= 1) return [geo];
  const names = Object.keys(geo.attributes);
  const out: THREE.BufferGeometry[] = [];
  for (const tris of groups.values()) {
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const src = geo.getAttribute(name) as THREE.BufferAttribute;
      const n = src.itemSize;
      const S = src.array as ArrayLike<number>;
      const arr = new (src.array.constructor as Float32ArrayConstructor)(tris.length * 3 * n);
      let o = 0;
      for (const t of tris)
        for (let k = 0; k < 3; k++) {
          const i = v(t, k) * n;
          for (let c = 0; c < n; c++) arr[o++] = S[i + c];
        }
      g.setAttribute(name, new THREE.BufferAttribute(arr, n, src.normalized));
    }
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

function splitInstanced(mesh: THREE.InstancedMesh): THREE.InstancedMesh[] {
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), c = new THREE.Color();
  const groups = new Map<number, number[]>();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    const k = key(p.x, p.z);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }
  if (groups.size <= 1) return [mesh];
  const out: THREE.InstancedMesh[] = [];
  for (const ids of groups.values()) {
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, ids.length);
    ids.forEach((id, j) => {
      mesh.getMatrixAt(id, m);
      im.setMatrixAt(j, m);
      if (mesh.instanceColor) {
        mesh.getColorAt(id, c);
        im.setColorAt(j, c);
      }
    });
    im.castShadow = mesh.castShadow;
    im.receiveShadow = mesh.receiveShadow;
    im.renderOrder = mesh.renderOrder;
    im.computeBoundingSphere();
    out.push(im);
  }
  return out;
}

/** Replaces every large mesh under `root` with one mesh per tile (in place). Only for meshes in world coordinates. */
export function tileStatic(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  for (const mesh of meshes) {
    const parent = mesh.parent;
    if (!parent || !mesh.matrix.equals(new THREE.Matrix4()) || parent !== root && !parent.matrixWorld.equals(new THREE.Matrix4())) continue;
    let parts: THREE.Mesh[];
    if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
      const im = mesh as THREE.InstancedMesh;
      if (im.count < 50) continue;
      parts = splitInstanced(im);
    } else {
      const geo = mesh.geometry;
      geo.computeBoundingSphere();
      if (!geo.boundingSphere || geo.boundingSphere.radius < TILE) continue;
      parts = splitGeometry(geo).map((g) => {
        const m = new THREE.Mesh(g, mesh.material);
        m.castShadow = mesh.castShadow;
        m.receiveShadow = mesh.receiveShadow;
        m.renderOrder = mesh.renderOrder;
        return m;
      });
    }
    if (parts.length <= 1) continue;
    parent.remove(mesh);
    parent.add(...parts);
    if (!(mesh as THREE.InstancedMesh).isInstancedMesh) mesh.geometry.dispose();
  }
}
