// Bot brains. Deliberately cheap: a bot re-plans ~12 times a second and in
// between just holds its last decision, so 5 bots cost far less than one
// pathfinding query would.

import { WORLD_W } from './maps.js';

const THINK_MIN = 0.07;
const THINK_MAX = 0.11;

const FLEE_RANGE = 620;
const PANIC_RANGE = 260;

function clearInput(e) {
  e.input.left = false;
  e.input.right = false;
}

function press(e, dir) {
  e.input.left = dir < 0;
  e.input.right = dir > 0;
}

function requestJump(e, hold = 0.3) {
  e.input.jump = true;
  e.jumpHold = hold;
}

/** Is there ground just ahead of the entity's feet? */
function groundAhead(world, e, dir) {
  const probeX = e.x + dir * (e.w / 2 + 16);
  return world.isSolid(probeX - 6, e.y + e.h / 2 + 2, 12, 26);
}

/** Is there a wall directly in front? */
function wallAhead(world, e, dir) {
  const probeX = e.x + dir * (e.w / 2 + 4);
  return world.isSolid(probeX - 4, e.y - e.h / 2 + 4, 10, e.h - 8);
}

/** Nearest drum pad within `range`, preferring ones on the way to `biasX`. */
function nearestPad(world, e, range, biasX) {
  let best = null;
  let bestScore = Infinity;
  const pads = world.pads;
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    const cx = p.x + p.w / 2;
    const dx = cx - e.x;
    const dy = p.y - e.y;
    if (Math.abs(dx) > range || dy > 140 || dy < -240) continue;
    let score = Math.abs(dx) + Math.abs(dy) * 0.6;
    if (biasX !== undefined && Math.sign(dx) !== Math.sign(biasX - e.x)) score += 260;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function nearestOpponent(game, e, wantIt) {
  let best = null;
  let bestD = Infinity;
  const list = game.entities;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === e) continue;
    const hostile = o.isIt || o.isZombie;
    if (wantIt !== hostile) continue;
    const d = Math.abs(o.x - e.x) + Math.abs(o.y - e.y) * 0.8;
    if (d < bestD) { bestD = d; best = o; }
  }
  return best;
}

function moveToward(world, e, targetX, targetY, urgent) {
  const dx = targetX - e.x;
  const dir = Math.abs(dx) < 14 ? 0 : Math.sign(dx);
  press(e, dir);

  if (dir === 0) { clearInput(e); return; }

  // Obstacle handling: hop walls, hop gaps, and never walk off a high ledge
  // unless we actually want to go down.
  if (e.onGround) {
    if (wallAhead(world, e, dir)) {
      requestJump(e, 0.35);
    } else if (!groundAhead(world, e, dir)) {
      if (urgent || Math.abs(dx) > 120) requestJump(e, 0.4);
      else press(e, -dir);
    } else if (targetY !== undefined && targetY < e.y - 70) {
      requestJump(e, 0.4);
    }
  }
}

function decide(game, e) {
  const world = game.world;
  const hostile = e.isIt || e.isZombie;

  if (hostile) {
    const prey = nearestOpponent(game, e, false);
    if (!prey) { clearInput(e); return; }

    // Chase directly; use a pad when the target is meaningfully above us.
    if (prey.y < e.y - 120) {
      const pad = nearestPad(world, e, 520, prey.x);
      if (pad) {
        moveToward(world, e, pad.x + pad.w / 2, pad.y, true);
        return;
      }
    }
    moveToward(world, e, prey.x, prey.y, true);
    if (e.onGround && prey.y < e.y - 40 && Math.abs(prey.x - e.x) < 90) requestJump(e, 0.45);
    return;
  }

  const threat = nearestOpponent(game, e, true);
  if (threat) {
    const dist = Math.hypot(threat.x - e.x, (threat.y - e.y) * 0.7);
    if (dist < FLEE_RANGE) {
      // Prefer escaping upward via a pad, that is what pads are for.
      const pad = nearestPad(world, e, 420);
      const padGood = pad && Math.abs(pad.x + pad.w / 2 - threat.x) > 150;
      if (padGood && dist > 150) {
        moveToward(world, e, pad.x + pad.w / 2, pad.y, true);
        return;
      }
      let away = Math.sign(e.x - threat.x) || 1;
      // Do not flee into a wall — turn around if we are cornered.
      if (e.x < 260) away = 1;
      if (e.x > WORLD_W - 260) away = -1;
      moveToward(world, e, e.x + away * 700, undefined, true);
      if (e.onGround && dist < PANIC_RANGE) requestJump(e, 0.45);
      return;
    }
  }

  // Idle: roam toward a wander point, re-picking when we arrive.
  if (e.wanderX === 0 || Math.abs(e.wanderX - e.x) < 90) {
    e.wanderX = 260 + game.rng() * (WORLD_W - 520);
  }
  moveToward(world, e, e.wanderX, undefined, false);
}

export function updateAI(game, e, dt) {
  if (e.jumpHold > 0) {
    e.jumpHold -= dt;
    e.input.jumpHeld = true;
  } else {
    e.input.jumpHeld = false;
  }

  e.think -= dt;
  if (e.think > 0) return;
  e.think = THINK_MIN + game.rng() * (THINK_MAX - THINK_MIN);
  decide(game, e);
}
