// Level of detail for small moving things (people, traffic): far away they are hidden or stop
// casting shadows. Each one was a few draw calls in the main pass and again in the shadow pass.
import type * as THREE from 'three';

/** Where the camera is; set by the game every frame. */
export const viewer = { x: 0, z: 0 };

export const PEOPLE_HIDE = 80; // m: people are about 1.7 m tall, at 80 m that's a few pixels
export const PEOPLE_SHADOW = 35;
export const CAR_HIDE = 220; // beyond the fog's thick part
export const CAR_SHADOW = 45;

/** Switches castShadow on all meshes under the roots (only when it changes). */
export function shadowSwitch(roots: THREE.Object3D[]) {
  let on: boolean | null = null;
  return (want: boolean) => {
    if (want === on) return;
    on = want;
    for (const r of roots) r.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = want;
    });
  };
}

export const distToViewer = (x: number, z: number) => Math.hypot(x - viewer.x, z - viewer.z);
