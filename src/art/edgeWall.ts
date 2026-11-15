// The edge of the map: a red-and-white striped barrier with a see-through glowing screen above
// it, where the invisible physics walls are (mapPhysics.ts), so you can see where the map ends.
import * as THREE from 'three';
import { MAP_HALF_SIZE } from '../game/mapData';

function canvasTexture(draw: (g: CanvasRenderingContext2D) => void, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildEdgeWall(): THREE.Group {
  const group = new THREE.Group();
  const E = MAP_HALF_SIZE - 1; // inner face of the physics walls
  const stripes = canvasTexture((g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#d7262e';
    for (let i = -64; i < 128; i += 64) {
      g.beginPath();
      g.moveTo(i, 64); g.lineTo(i + 32, 64); g.lineTo(i + 96, 0); g.lineTo(i + 64, 0);
      g.fill();
    }
  }, 128, 64);
  stripes.wrapS = THREE.RepeatWrapping;
  const screen = canvasTexture((g) => {
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(120,200,255,0)');
    grad.addColorStop(1, 'rgba(120,200,255,0.55)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = 0; x < 64; x += 16) g.fillRect(x, 0, 2, 64);
  }, 64, 64);
  screen.wrapS = THREE.RepeatWrapping;
  const H = 1.2;
  for (let k = 0; k < 4; k++) {
    const yaw = (k * Math.PI) / 2;
    const side = new THREE.Group();
    side.rotation.y = yaw;
    const len = 2 * E;
    const bt = stripes.clone();
    bt.repeat.set(len / 3, 1);
    bt.needsUpdate = true;
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(len, H, 0.5), new THREE.MeshLambertMaterial({ map: bt }));
    barrier.position.set(0, H / 2, -E + 0.25);
    barrier.receiveShadow = true;
    const st = screen.clone();
    st.repeat.set(len / 8, 1);
    st.needsUpdate = true;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(len, 9), new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    glow.position.set(0, H + 4.5, -E + 0.25);
    side.add(barrier, glow);
    group.add(side);
  }
  return group;
}
