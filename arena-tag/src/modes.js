// The three game modes. Every mode shares the same map pool and only swaps
// physics constants + the tag rule, which keeps the simulation branch-free.

import { PHYS, SPEED, MATCH } from './config.js';

export const MODES = {
  standard: {
    id: 'standard',
    name: 'Standard Tag',
    blurb: 'One tagger. Whoever is IT when the clock runs out finishes last.',
    rule: 'tag',            // "IT" is passed on contact
    gravity: PHYS.gravity,
    jumpVel: PHYS.jumpVel,
    padBounce: PHYS.padBounce,
    duration: MATCH.duration,
    runnerSpeed: SPEED.runner,
    itSpeed: SPEED.runner * SPEED.taggerMul,
    accent: '#ff4757',
  },
  zombie: {
    id: 'zombie',
    name: 'Zombie Outbreak',
    blurb: 'Zombies are slow but every runner they touch joins the horde.',
    rule: 'infect',
    gravity: PHYS.gravity,
    jumpVel: PHYS.jumpVel,
    padBounce: PHYS.padBounce,
    duration: MATCH.zombieDuration,
    runnerSpeed: SPEED.runner,
    itSpeed: SPEED.runner * SPEED.zombieMul,
    accent: '#5ee06a',
  },
  moon: {
    id: 'moon',
    name: 'Moon Gravity',
    blurb: 'Low gravity: jump between platforms and never touch the floor.',
    rule: 'tag',
    gravity: PHYS.gravity * 0.30,
    jumpVel: PHYS.jumpVel * 1.05,
    // Bounce is scaled with sqrt(gravity) so pads stay powerful without
    // launching anyone off the top of the world.
    padBounce: PHYS.padBounce * Math.sqrt(0.30) * 1.35,
    duration: MATCH.duration,
    runnerSpeed: SPEED.runner * 0.95,
    itSpeed: SPEED.runner * 0.95 * SPEED.taggerMul,
    accent: '#8ab4ff',
  },
};

export const MODE_IDS = Object.keys(MODES);

export function pickMode(rng, forced) {
  if (forced && MODES[forced]) return MODES[forced];
  return MODES[rng.pick(MODE_IDS)];
}
