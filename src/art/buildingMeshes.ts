import * as THREE from 'three';
import type { Building, Pt } from '../game/mapData';

// Façade styles by building era, matching what Utrecht Noord looks like:
// pre-war brick (Zuilen/Tuindorp), 1960s-70s gallery flats and houses (Overvecht),
// 1980s brown brick, and modern buildings.
interface Style {
  bay: number; // metres per window column
  floor: number; // metres per storey
  walls: number[]; // wall tints (multiply the white parts of the texture)
  roofs: number[]; // pitched roof colours
  draw: (g: CanvasRenderingContext2D) => void; // one bay x one floor, 128 x 128, top = top of floor
  plain?: string; // colour of plain wall parts (sheds, gables) when it is baked into the texture
}

const glass = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frame = '#f4f4f0') => {
  g.fillStyle = frame;
  g.fillRect(x - 4, y - 4, w + 8, h + 8);
  g.fillStyle = '#34414f';
  g.fillRect(x, y, w, h);
  g.fillStyle = '#5f7488';
  g.fillRect(x, y, w, h * 0.22); // sky reflection
};
const bricks = (g: CanvasRenderingContext2D) => {
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let y = 6; y < 128; y += 8) g.fillRect(0, y, 128, 1);
};

/** Gallery/balcony flat: infill panel colour + railing colour. */
function flatFacade(g: CanvasRenderingContext2D, infill: string, railing: string) {
  g.fillStyle = infill;
  g.fillRect(0, 0, 128, 92);
  glass(g, 10, 22, 50, 44, '#e9e6df');
  glass(g, 70, 22, 48, 44, '#e9e6df');
  g.fillStyle = '#f2f0ea';
  g.fillRect(0, 92, 128, 36); // concrete balcony band
  g.fillStyle = railing;
  g.fillRect(0, 86, 128, 4);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 90, 128, 2);
}

const STYLES: Record<string, Style> = {
  prewar: {
    bay: 2.6, floor: 3.2,
    walls: [0x7d6a58, 0x8a7560, 0x6f6150, 0x86705c, 0x9a6a50],
    roofs: [0x8e4430, 0x9b4a32, 0x4a3a35],
    draw: (g) => {
      bricks(g);
      glass(g, 44, 26, 40, 74);
      g.fillStyle = '#f4f4f0';
      g.fillRect(44, 46, 40, 4); // transom
      g.fillRect(62, 50, 4, 50); // mullion
    },
  },
  flat: {
    // White concrete balcony band, dark brown infill panels, red railing (like the Rode Flat).
    bay: 3.6, floor: 2.8,
    walls: [0xffffff, 0xf3f1ec],
    roofs: [0x6f6f72],
    draw: (g) => flatFacade(g, '#5b4a46', '#b23a2e'),
  },
  flatBlue: {
    bay: 3.6, floor: 2.8,
    walls: [0xffffff, 0xeef0f2],
    roofs: [0x6f6f72],
    draw: (g) => flatFacade(g, '#56697a', '#d9dde0'),
  },
  flatWarm: {
    bay: 3.6, floor: 2.8,
    walls: [0xffffff, 0xf6f1e6],
    roofs: [0x6f6f72],
    draw: (g) => flatFacade(g, '#9a6b3f', '#2f3a44'),
  },
  panel: {
    // 1960s-80s schools and shops: blue panels, yellow piers, white window frames (like school Op Dreef).
    bay: 3.4, floor: 3.3,
    walls: [0xffffff],
    roofs: [0x6f6f72],
    draw: (g) => {
      g.fillStyle = '#2f62b0';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#e2b437';
      g.fillRect(0, 0, 14, 128);
      glass(g, 22, 14, 98, 80, '#f4f4f0');
      g.fillStyle = '#f4f4f0';
      g.fillRect(70, 14, 3, 80);
    },
  },
  house60: {
    bay: 3.0, floor: 2.8,
    walls: [0xc9a77c, 0xb98f6a, 0xd2b48c, 0xa86a4c],
    roofs: [0x4a3a35, 0x3f3f44, 0x5a3b32],
    draw: (g) => {
      bricks(g);
      glass(g, 16, 26, 96, 66, '#ffffff');
      g.fillStyle = '#ffffff';
      g.fillRect(62, 26, 4, 66);
    },
  },
  eighties: {
    bay: 3.0, floor: 2.9,
    walls: [0x8a4b3a, 0x7b4636, 0x9b5a40, 0x6e4a3c],
    roofs: [0x3f3f44, 0x4a3a35, 0x2f3033],
    draw: (g) => {
      bricks(g);
      glass(g, 30, 28, 68, 66, '#5a4030');
    },
  },
  church: {
    bay: 3.2, floor: 6,
    walls: [0x6e5e4e, 0x75634f, 0x7a6450],
    roofs: [0x3d4248, 0x47413d],
    draw: (g) => {
      bricks(g);
      // Tall arched window.
      g.fillStyle = '#e8e2d6';
      g.beginPath();
      g.moveTo(44, 120); g.lineTo(44, 40); g.arc(64, 40, 20, Math.PI, 0); g.lineTo(84, 120); g.closePath(); g.fill();
      g.fillStyle = '#3a4a63';
      g.beginPath();
      g.moveTo(48, 118); g.lineTo(48, 42); g.arc(64, 42, 16, Math.PI, 0); g.lineTo(80, 118); g.closePath(); g.fill();
      g.fillStyle = '#e8e2d6';
      g.fillRect(63, 30, 2, 88);
    },
  },
  mosque: {
    bay: 3.4, floor: 5,
    walls: [0xefeae0, 0xe6dfcf],
    roofs: [0x7c8a96],
    draw: (g) => {
      g.fillStyle = '#2f4d6b';
      g.beginPath();
      g.moveTo(46, 116); g.lineTo(46, 50); g.arc(64, 50, 18, Math.PI, 0); g.lineTo(82, 116); g.closePath(); g.fill();
    },
  },
  // Styles matched to Street View, per street (see src/game/streetLooks.ts).
  row62: {
    // 1960s terraced houses: brick, white band under the roof edge, coloured panel under the window.
    plain: '#8c5647',
    bay: 5.2, floor: 2.85,
    walls: [0xffffff],
    roofs: [0x5d6066],
    draw: (g) => {
      g.fillStyle = '#8c5647';
      g.fillRect(0, 0, 128, 128);
      bricks(g);
      glass(g, 14, 30, 64, 46, '#f4f4f0');
      g.fillStyle = '#e6cf72';
      g.fillRect(10, 80, 72, 30); // panel under the window
      g.fillStyle = '#f4f4f0';
      g.fillRect(0, 0, 128, 8); // band
      g.fillRect(92, 24, 26, 104); // door frame
      g.fillStyle = '#e6cf72';
      g.fillRect(96, 30, 18, 98);
    },
  },
  row02: {
    // 2000s houses: orange-brown brick, white frames, grey panels.
    plain: '#9c5b3b',
    bay: 5.0, floor: 2.8,
    walls: [0xffffff],
    roofs: [0x3f3f44],
    draw: (g) => {
      g.fillStyle = '#9c5b3b';
      g.fillRect(0, 0, 128, 128);
      bricks(g);
      glass(g, 16, 26, 48, 40, '#f4f4f0');
      g.fillStyle = '#6f7378';
      g.fillRect(16, 74, 48, 22);
      g.fillStyle = '#f4f4f0';
      g.fillRect(12, 70, 56, 4);
      glass(g, 90, 22, 26, 40, '#f4f4f0');
      g.fillStyle = '#c98a3a';
      g.fillRect(90, 68, 26, 60); // door
    },
  },
  timber: {
    // 1980s houses clad in dark horizontal boards, white window frames.
    plain: '#3f444b',
    bay: 3.4, floor: 2.8,
    walls: [0xffffff],
    roofs: [0x2f3033],
    draw: (g) => {
      g.fillStyle = '#3f444b';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let y = 0; y < 128; y += 10) g.fillRect(0, y, 128, 2);
      glass(g, 24, 26, 80, 60, '#f4f4f0');
    },
  },
  woodSlat: {
    // Modern flats with wooden slat cladding and concrete floor edges.
    plain: '#8b6a4f',
    bay: 3.6, floor: 3.0,
    walls: [0xffffff],
    roofs: [0x3a3b3e],
    draw: (g) => {
      g.fillStyle = '#8b6a4f';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 4; y < 100; y += 7) g.fillRect(0, y, 128, 2);
      glass(g, 8, 18, 112, 62, '#3a3b3e');
      g.fillStyle = '#d6d3cc';
      g.fillRect(0, 104, 128, 24); // concrete floor edge
    },
  },
  modern: {
    bay: 3.4, floor: 3.0,
    walls: [0xd9d4cc, 0xb8b2a8, 0x6d6f73, 0xc7b9a3],
    roofs: [0x3a3b3e, 0x4a4b4f],
    draw: (g) => glass(g, 12, 14, 104, 96, '#3a3b3e'),
  },
};

function footprintArea(pts: Pt[]) {
  let a = 0;
  for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return Math.abs(a / 2);
}

const hslOf = (hex: number) => {
  const o = { h: 0, s: 0, l: 0 };
  new THREE.Color().setHex(hex).getHSL(o);
  return o;
};
/** For gallery flats with a street photo: pick the panel colour closest to what the photo shows. */
function flatFromPhoto(b: Building): 'flat' | 'flatBlue' | 'flatWarm' | null {
  if (!b.facade) return null;
  for (const c of [b.facade[1], b.facade[0]]) {
    const { h, s, l } = hslOf(c);
    if (s < 0.12 || l < 0.12 || l > 0.85) continue;
    if (h > 0.5 && h < 0.72) return 'flatBlue';
    if (h > 0.05 && h < 0.15) return 'flatWarm';
    if (h <= 0.05 || h > 0.9) return 'flat';
  }
  return null;
}

function styleFor(b: Building): keyof typeof STYLES {
  if (b.church) return b.church;
  if (b.look && b.look in STYLES) return b.look;
  const named = styleByYear(b);
  if (named.startsWith('flat')) return flatFromPhoto(b) ?? named;
  return named;
}

function styleByYear(b: Building): keyof typeof STYLES {
  const year = b.year ?? 0;
  const floors = b.floors || Math.round(b.h / 3);
  if (!year) return b.h > 12 ? 'flatBlue' : 'house60';
  if (year < 1945) return 'prewar';
  if (year < 1986 && year >= 1955 && !b.lod && b.h <= 10 && footprintArea(b.pts) > 350) return 'panel';
  if (year < 1976) return floors >= 4 || b.h > 11 ? (['flat', 'flatBlue', 'flatWarm'] as const)[Math.abs(Math.round(b.pts[0][0] * 3 + b.pts[0][1])) % 3] : 'house60';
  if (year < 1996) return 'eighties';
  return 'modern';
}

function texture(style: Style) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  style.draw(g);
  g.fillStyle = style.plain ?? '#ffffff';
  g.fillRect(0, 0, 4, 4); // guaranteed plain-wall pixel for sheds/gables (uv 0.01, 0.99)
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function openRing(pts: Pt[]): Pt[] {
  const a = pts[0], b = pts[pts.length - 1];
  return a[0] === b[0] && a[1] === b[1] ? pts.slice(0, -1) : pts;
}

/** Finds walls shared with a neighbouring building (terraced houses), so roof ridges run the right way. */
function partyWalls(rings: Pt[][]) {
  const grid = new Map<string, { b: number; x: number; z: number }[]>();
  const mids = rings.map((ring, b) =>
    ring.map((p, i) => {
      const q = ring[(i + 1) % ring.length];
      const m = { b, x: (p[0] + q[0]) / 2, z: (p[1] + q[1]) / 2 };
      const k = `${Math.round(m.x)},${Math.round(m.z)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(m);
      return m;
    }),
  );
  return mids.map((list, b) =>
    list.map((m) => {
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
          for (const o of grid.get(`${Math.round(m.x) + dx},${Math.round(m.z) + dz}`) ?? [])
            if (o.b !== b && Math.hypot(o.x - m.x, o.z - m.z) < 0.8) return true;
      return false;
    }),
  );
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], color: THREE.Color, uvs?: number[][]) {
    for (const [i, p] of [a, b, c].entries()) {
      this.pos.push(p[0], p[1], p[2]);
      this.col.push(color.r, color.g, color.b);
      const t = uvs?.[i] ?? [0.01, 0.99];
      this.uv.push(t[0], t[1]);
    }
  }
  mesh(material: THREE.Material, computeNormals: boolean) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (computeNormals) g.computeVertexNormals();
    else g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    const m = new THREE.Mesh(g, material);
    m.castShadow = m.receiveShadow = true;
    return m;
  }
}

/** All buildings: one wall mesh per façade style, plus one roof mesh. */
export function buildBuildings(list: Building[], lod3d?: { pos: Int16Array; idx: Uint16Array }): THREE.Group {
  const rings = list.map((b) => openRing(b.pts));
  const party = partyWalls(rings);
  const walls = new Map<string, Builder>();
  const roofs = new Builder();
  const wc = new THREE.Color(), rc = new THREE.Color();

  list.forEach((b, idx) => {
    const ring = rings[idx];
    if (ring.length < 3) return;
    const styleName = styleFor(b);
    const style = STYLES[styleName];
    const small = b.h <= 4 && (b.floors ?? 1) <= 1;
    const pitched = !!(b.eave && b.ridge);
    const wallH = pitched ? b.eave! : b.h;
    wc.setHex(style.walls[idx % style.walls.length]);
    if (b.lookWall !== undefined) wc.setHex(b.lookWall);
    else if (b.facade && !styleName.startsWith('flat') && styleName !== 'panel' && !b.look) {
      // Real wall colour from a street photo. Photos are often in shade: lift the brightness.
      const { h, s, l } = hslOf(b.facade[0]);
      wc.setHSL(h, Math.min(0.55, s * 1.15), Math.max(0.25, Math.min(0.88, l * 1.3 + 0.06)));
    }
    rc.setHex(pitched ? style.roofs[idx % style.roofs.length] : [0x6f6f72, 0x7d7a74, 0x5d6066][idx % 3]);
    if (b.roofColor !== undefined) {
      // Real roof colour from the aerial photo. Aerial photos look hazy, so make it
      // a bit richer and darker.
      rc.setHex(b.roofColor);
      const hsl = { h: 0, s: 0, l: 0 };
      rc.getHSL(hsl);
      rc.setHSL(hsl.h, Math.min(1, hsl.s * 1.6), hsl.l * 0.8);
    }
    const wb = walls.get(styleName) ?? walls.set(styleName, new Builder()).get(styleName)!;

    if (b.lod && lod3d) {
      // Real 3D shape (3D BAG LoD2.2): walls get the façade texture, roofs the measured colour.
      const [v0, , i0, nWall, nRoof] = b.lod;
      const P = (k: number) => [lod3d.pos[(v0 + k) * 3] / 10, lod3d.pos[(v0 + k) * 3 + 1] / 10, lod3d.pos[(v0 + k) * 3 + 2] / 10];
      for (let t = 0; t < nWall; t += 3) {
        const a = P(lod3d.idx[i0 + t]), bb = P(lod3d.idx[i0 + t + 1]), cc = P(lod3d.idx[i0 + t + 2]);
        const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const hl = Math.hypot(nx, nz) || 1, tx = -nz / hl, tz = nx / hl; // along the wall
        for (const p of [a, bb, cc]) {
          wb.pos.push(p[0], p[1], p[2]);
          wb.nor.push(nx, ny, nz);
          wb.uv.push(small ? 0.01 : (p[0] * tx + p[2] * tz) / style.bay, small ? 0.99 : p[1] / style.floor);
          wb.col.push(wc.r, wc.g, wc.b);
        }
      }
      for (let t = nWall; t < nWall + nRoof; t += 3) {
        roofs.tri(P(lod3d.idx[i0 + t]), P(lod3d.idx[i0 + t + 1]), P(lod3d.idx[i0 + t + 2]), rc);
      }
      return;
    }

    // Walls, wound so their front faces outward.
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length];
      area += x0 * z1 - x1 * z0;
    }
    const sign = area > 0 ? 1 : -1;
    let u = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const nx = (sign * (bz - az)) / len, nz = (sign * -(bx - ax)) / len;
      const plain = small || party[idx][i];
      const u0 = plain ? 0.01 : u / style.bay, u1 = plain ? 0.01 : (u + len) / style.bay;
      const v0 = plain ? 0.99 : 0, v1 = plain ? 0.99 : wallH / style.floor;
      const quad = [[ax, 0, az, u0, v0], [bx, 0, bz, u1, v0], [bx, wallH, bz, u1, v1], [ax, wallH, az, u0, v1]];
      for (const k of sign > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) {
        const [x, y, z, uu, vv] = quad[k];
        wb.pos.push(x, y, z);
        wb.nor.push(nx, 0, nz);
        wb.uv.push(uu, vv);
        wb.col.push(wc.r, wc.g, wc.b);
      }
      u += len;
    }

    const at = (p: Pt, y: number) => [p[0], y, p[1]];
    if (pitched && ring.length === 4) {
      // Gable roof. Gable ends go on the shared (party) walls, or on the short sides.
      const len = (i: number) => Math.hypot(ring[(i + 1) % 4][0] - ring[i][0], ring[(i + 1) % 4][1] - ring[i][1]);
      const partyA = party[idx][0] || party[idx][2], partyB = party[idx][1] || party[idx][3];
      const gableOnB = partyB !== partyA ? partyB : len(1) + len(3) < len(0) + len(2);
      const r = gableOnB ? ring : [ring[1], ring[2], ring[3], ring[0]];
      const mid = (p: Pt, q: Pt): Pt => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const m12 = mid(r[1], r[2]), m30 = mid(r[3], r[0]);
      const E = b.eave!, R = b.ridge!;
      roofs.tri(at(r[0], E), at(r[1], E), at(m12, R), rc);
      roofs.tri(at(r[0], E), at(m12, R), at(m30, R), rc);
      roofs.tri(at(r[2], E), at(r[3], E), at(m30, R), rc);
      roofs.tri(at(r[2], E), at(m30, R), at(m12, R), rc);
      roofs.tri(at(r[1], E), at(r[2], E), at(m12, R), wc); // gable ends in wall colour
      roofs.tri(at(r[3], E), at(r[0], E), at(m30, R), wc);
    } else if (pitched && ring.length <= 10) {
      // Hipped roof up to a peak over the centre.
      const c: Pt = [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
      for (let i = 0; i < ring.length; i++) roofs.tri(at(ring[i], b.eave!), at(ring[(i + 1) % ring.length], b.eave!), at(c, b.ridge!), rc);
    } else {
      const top = pitched ? (b.eave! + b.ridge!) / 2 : b.h;
      const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
      for (const [a, bb, cc] of THREE.ShapeUtils.triangulateShape(contour, [])) {
        roofs.tri(at(ring[a], top), at(ring[bb], top), at(ring[cc], top), rc);
      }
      if (pitched) {
        // Fill the gap between the eaves and the raised flat top.
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i], q = ring[(i + 1) % ring.length];
          roofs.tri(at(p, b.eave!), at(q, b.eave!), at(q, top), wc);
          roofs.tri(at(p, b.eave!), at(q, top), at(p, top), wc);
        }
      }
    }
  });

  const group = new THREE.Group();
  for (const [name, wb] of walls) {
    group.add(wb.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, map: texture(STYLES[name]) }), false));
  }
  group.add(roofs.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), true));
  return group;
}
