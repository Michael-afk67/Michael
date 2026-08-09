// Procedural map pool. Each preset is a small generator, so a "map" costs a
// name + a seed instead of megabytes of level data. One preset is picked at
// random before every round and re-rolled with a fresh seed.

import { makeRng } from './rng.js';

export const WORLD_W = 4200;
export const WORLD_H = 2400;

const GROUND_H = 110;
const WALL_W = 70;
const PLAT_H = 22;
const PAD_W = 76;
const PAD_H = 16;

// Minimum spacing between floating platforms so a player always fits through.
const MARGIN_X = 70;
const MARGIN_Y = 120;

const GROUND_Y = WORLD_H - GROUND_H;

function overlapsAny(list, x, y, w, h, mx, my) {
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (x - mx < p.x + p.w && x + w + mx > p.x && y - my < p.y + p.h && y + h + my > p.y) {
      return true;
    }
  }
  return false;
}

function addPlatform(list, x, y, w, h = PLAT_H) {
  x = Math.round(Math.max(WALL_W + 20, Math.min(WORLD_W - WALL_W - 20 - w, x)));
  y = Math.round(Math.max(220, Math.min(GROUND_Y - 130, y)));
  if (w < 60) return false;
  if (overlapsAny(list, x, y, w, h, MARGIN_X, MARGIN_Y)) return false;
  list.push({ x, y, w, h });
  return true;
}

/* ------------------------------------------------------------------ presets */

function skyline(rng, plats) {
  // Dense vertical columns: lots of short hops, good for chases.
  for (let x = WALL_W + 140; x < WORLD_W - WALL_W - 200; x += rng.range(240, 320)) {
    const count = rng.int(3, 6);
    let y = GROUND_Y - rng.range(180, 300);
    for (let i = 0; i < count; i++) {
      addPlatform(plats, x + rng.range(-70, 70), y, rng.range(110, 240));
      y -= rng.range(190, 300);
      if (y < 260) break;
    }
  }
}

function cavern(rng, plats) {
  // Wide ledges with open air between them.
  for (let i = 0; i < 14; i++) {
    addPlatform(plats, rng.range(WALL_W, WORLD_W - WALL_W - 380), rng.range(300, GROUND_Y - 160), rng.range(240, 420));
  }
  for (let i = 0; i < 40; i++) {
    addPlatform(plats, rng.range(WALL_W, WORLD_W - WALL_W - 200), rng.range(260, GROUND_Y - 150), rng.range(90, 200));
  }
}

function towers(rng, plats) {
  // Tall stacks separated by wide gaps: pads are the only way up fast.
  const towerCount = rng.int(5, 7);
  const step = (WORLD_W - 2 * WALL_W - 300) / towerCount;
  for (let t = 0; t < towerCount; t++) {
    const cx = WALL_W + 200 + t * step + rng.range(-50, 50);
    let y = GROUND_Y - rng.range(200, 260);
    let w = rng.range(260, 340);
    while (y > 280) {
      addPlatform(plats, cx - w / 2, y, w);
      y -= rng.range(200, 260);
      w = Math.max(90, w - rng.range(30, 70));
    }
  }
}

function rings(rng, plats) {
  // Concentric ledges around an open middle: circular chases.
  const cx = WORLD_W / 2;
  const cy = GROUND_Y - 620;
  for (let ring = 0; ring < 5; ring++) {
    const rx = 300 + ring * 340;
    const ry = 200 + ring * 230;
    const segs = 4 + ring * 2;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2 + rng.range(0, 0.4);
      const w = rng.range(130, 250);
      addPlatform(plats, cx + Math.cos(a) * rx - w / 2, cy + Math.sin(a) * ry * 0.9, w);
    }
  }
  for (let i = 0; i < 18; i++) {
    addPlatform(plats, rng.range(WALL_W, WORLD_W - WALL_W - 200), rng.range(280, GROUND_Y - 150), rng.range(100, 200));
  }
}

function lattice(rng, plats) {
  // Regular grid with random holes: predictable parkour, great for Moon mode.
  const cols = 12;
  const rows = 7;
  const cw = (WORLD_W - 2 * WALL_W - 200) / cols;
  const ch = (GROUND_Y - 320) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng.chance(0.32)) continue;
      const w = rng.range(120, cw - 40);
      addPlatform(plats, WALL_W + 100 + c * cw + rng.range(0, 30), 300 + r * ch + rng.range(-20, 20), w);
    }
  }
}

export const MAP_POOL = [
  { id: 'skyline', name: 'Neon Skyline', build: skyline, tint: '#16204a' },
  { id: 'cavern',  name: 'Hollow Cavern', build: cavern,  tint: '#1a1630' },
  { id: 'towers',  name: 'Sky Towers',   build: towers,  tint: '#0f2438' },
  { id: 'rings',   name: 'Orbit Rings',  build: rings,   tint: '#231a35' },
  { id: 'lattice', name: 'Grid Gardens', build: lattice, tint: '#12262b' },
];

/* ------------------------------------------------------------------- build */

function addPads(rng, plats, pads) {
  // Drum pads on top of wide platforms...
  const wide = [];
  for (let i = 0; i < plats.length; i++) if (plats[i].w >= 130) wide.push(plats[i]);
  const target = Math.min(wide.length, Math.max(10, Math.round(wide.length * 0.4)));
  for (let i = wide.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = wide[i]; wide[i] = wide[j]; wide[j] = tmp;
  }
  for (let i = 0; i < target; i++) {
    const p = wide[i];
    const x = p.x + rng.range(10, Math.max(10, p.w - PAD_W - 10));
    pads.push({ x: Math.round(x), y: p.y - PAD_H, w: PAD_W, h: PAD_H, anim: 0 });
  }
  // ...and a row along the ground so anyone can get airborne from spawn.
  const groundPads = 9;
  const span = (WORLD_W - 2 * WALL_W - 300) / groundPads;
  for (let i = 0; i < groundPads; i++) {
    const x = WALL_W + 150 + i * span + rng.range(-40, 40);
    pads.push({ x: Math.round(x), y: GROUND_Y - PAD_H, w: PAD_W, h: PAD_H, anim: 0 });
  }
}

function buildSpawns(rng, plats) {
  const spawns = [];
  const pool = plats.filter((p) => p.w >= 120 && p.y < GROUND_Y - 200);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  // Spread spawns horizontally so nobody starts on top of the tagger.
  for (let i = 0; i < pool.length && spawns.length < 12; i++) {
    const p = pool[i];
    const x = p.x + p.w / 2;
    let tooClose = false;
    for (const s of spawns) if (Math.abs(s.x - x) < 420) { tooClose = true; break; }
    if (tooClose) continue;
    spawns.push({ x, y: p.y - 40 });
  }
  for (let i = 0; spawns.length < 8; i++) {
    spawns.push({ x: WALL_W + 250 + i * 480, y: GROUND_Y - 60 });
  }
  return spawns;
}

/**
 * Build a full map instance.
 * @param {number} seed
 * @param {string} [forcedId] optional preset id, otherwise random from the pool
 */
export function buildMap(seed, forcedId) {
  const rng = makeRng(seed);
  const preset = (forcedId && MAP_POOL.find((m) => m.id === forcedId)) || rng.pick(MAP_POOL);

  const solids = [];
  // Static shell: ground slab + side walls.
  solids.push({ x: 0, y: GROUND_Y, w: WORLD_W, h: GROUND_H + 40 });
  solids.push({ x: 0, y: -400, w: WALL_W, h: WORLD_H + 400 });
  solids.push({ x: WORLD_W - WALL_W, y: -400, w: WALL_W, h: WORLD_H + 400 });

  const plats = [];
  preset.build(rng, plats);

  const pads = [];
  addPads(rng, plats, pads);

  const spawns = buildSpawns(rng, plats);

  return {
    id: preset.id,
    name: preset.name,
    tint: preset.tint,
    width: WORLD_W,
    height: WORLD_H,
    groundY: GROUND_Y,
    solids: solids.concat(plats),
    shellCount: solids.length,
    pads,
    spawns,
    seed,
  };
}
