// WGS84 (lat, lon) <-> Dutch RD New (EPSG:28992), approximation accurate to ~1 m.
const X0 = 155000, Y0 = 463000, PHI0 = 52.1551744, LAM0 = 5.38720621;
const RP = [[0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705], [3, 1, -2.34], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148]];
const RQ = [[1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788], [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054]];
export function toRd(lat, lon) {
  const dp = 0.36 * (lat - PHI0), dl = 0.36 * (lon - LAM0);
  let x = X0, y = Y0;
  for (const [p, q, r] of RP) x += r * dp ** p * dl ** q;
  for (const [p, q, s] of RQ) y += s * dp ** p * dl ** q;
  return [x, y];
}
