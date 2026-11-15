// Loops: an orange toy-car track with yellow side walls, standing on two pairs of posts.
import * as THREE from 'three';
import type { Loop } from '../game/mapData';
import { loopSections, loopGeometry, LOOP_W } from '../game/loops';

export function buildLoops(loops: Loop[]): THREE.Group {
  const group = new THREE.Group();
  if (!loops.length) return group;
  const trackMat = new THREE.MeshLambertMaterial({ color: 0xff6a00, side: THREE.DoubleSide });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xffd21f, side: THREE.DoubleSide });
  const postMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ab });
  for (const l of loops) {
    const { pos, road, walls } = loopGeometry(l);
    // Give the track some thickness: a second road surface a little further out.
    const secs = loopSections(l);
    const under: number[] = [];
    const hw = LOOP_W / 2 + 0.05;
    for (const { p, side, up } of secs)
      for (const a of [-hw, hw]) under.push(p[0] + side[0] * a - up[0] * 0.25, p[1] + side[1] * a - up[1] * 0.25, p[2] + side[2] * a - up[2] * 0.25);
    const uIdx: number[] = [];
    for (let i = 0; i < secs.length - 1; i++) {
      const a = i * 2, b = a + 2;
      uIdx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const mesh = (P: number[], I: number[], mat: THREE.Material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setIndex(I);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    group.add(mesh(pos, road, trackMat), mesh(pos, walls, wallMat), mesh(under, uIdx, trackMat));
    // Posts beside the loop, up to its top, on both sides.
    const c = Math.cos(l.yaw), s = Math.sin(l.yaw);
    const top = l.r * 2;
    for (const v of [-LOOP_W / 2 - 0.9, l.d + LOOP_W / 2 + 0.9])
      for (const u of [-0.6, 0.6]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, top, 8), postMat);
        post.position.set(l.x + c * u - s * v, top / 2, l.z + s * u + c * v);
        post.castShadow = true;
        group.add(post);
      }
    // A beam over the top that carries the track.
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, l.d + LOOP_W + 1.8), postMat);
    beam.position.set(l.x - s * (l.d / 2), top + 0.45, l.z + c * (l.d / 2));
    beam.rotation.y = -l.yaw;
    beam.castShadow = true;
    group.add(beam);
  }
  return group;
}
