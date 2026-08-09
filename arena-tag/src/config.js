// Central tuning values. Everything gameplay-related lives here so balance
// changes never require touching systems code.

export const PHYS = {
  fixedDt: 1 / 60,   // deterministic simulation step
  maxSteps: 5,       // spiral-of-death guard
  gravity: 2100,
  groundAccel: 4600,
  airAccel: 2800,
  friction: 4000,
  airDrag: 500,
  maxFall: 1500,
  coyote: 0.10,      // grace period for late jumps
  jumpBuffer: 0.12,  // grace period for early jumps
  jumpVel: 760,
  jumpCut: 0.45,     // velocity kept when jump is released early
  padBounce: 1300,
  padCooldown: 0.14,
  ceiling: 40,
};

export const BODY = { w: 26, h: 34 };

export const SPEED = {
  runner: 300,
  taggerMul: 1.16,   // requirement: the tagger is slightly faster
  zombieMul: 0.66,   // requirement: zombies are very slow
};

export const MATCH = {
  slots: 6,          // requirement: always exactly 6 competitors
  countdown: 3,
  duration: 120,
  zombieDuration: 105,
  tagCooldown: 1.0,  // new tagger cannot tag for this long
  tagBackLock: 1.8,  // ...and cannot tag the previous tagger for this long
  tagFreeze: 0.45,   // new tagger is briefly frozen (anti tag-back spam)
  tagPad: 4,         // extra pixels on the tag hitbox
};

// 1st .. 6th place payouts.
export const COINS = [120, 90, 70, 50, 35, 20];

export const CAM = {
  lerp: 9,
  lookAhead: 0.16,
  // Zoom shrinks as the split-screen viewports shrink.
  scaleFor: [1, 1, 0.86, 0.76, 0.76],
};

export const GRID_CELL = 256;

export const COLORS = {
  bg0: '#0a0d1c',
  bg1: '#131b34',
  platform: '#2c3757',
  platformTop: '#4b5f92',
  pad: '#ff3d7f',
  padTop: '#ffa3c6',
  it: '#ff4757',
  zombie: '#5ee06a',
};
