// Low-poly art style. Swap these (and the mesh builders in src/art) for a different look.
export const palette = {
  sky: 0xa9cbe6, // fog / horizon colour
  ground: 0xa8b98a,
  green: 0x86b860,
  water: 0x3f7fae,
  road: 0x45484f,
  pavement: 0xb9b5ad,
  marking: 0xf2f2ee,
  path: 0xcdbb9c,
  ballast: 0x8a8178,
  dyke: 0x7fa65a,
  sleeper: 0x5b4a3e,
  steel: 0x9aa0a6,
  waterBed: 0x1d2f33,
  bank: 0x6f6553,
  bridge: 0x55585e,
  bridgeSide: 0x8d8a83,
  railing: 0x4a5a66,
  kerb: 0xc9c6bf,
  // Walls (multiplied with the window texture). Tall flats get the first three.
  flats: [0xe9e4da, 0xd6d3cc, 0xcfc4b0],
  houses: [0xb9654a, 0xa9573f, 0xc98f6e, 0xd9c3a5, 0x9b5a45],
  roofFlat: [0x6f6f72, 0x7d7a74, 0x5d6066],
  roofHouse: [0x5a3b32, 0x3f3f44, 0x7a3e2e],
  trunk: 0x6b4b34,
  leaves: [0x41702e, 0x4d7d34, 0x38632b, 0x58833a, 0x46743a, 0x5a7a30], // matched to Street View
  pine: [0x2f6b3a, 0x2a5e35],
  willow: [0x8aa84f, 0x7d9e4a],
  lampPole: 0x5a5f66,
  lampLight: 0xfff4c8,
  station: 0xffc917,
};
