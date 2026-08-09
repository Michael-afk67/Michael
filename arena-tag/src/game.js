// Match orchestration: builds the arena, owns the entities, runs the fixed
// timestep simulation and produces the end-of-match ranking.

import { MATCH, CAM, COINS, PHYS } from './config.js';
import { makeRng } from './rng.js';
import { buildMap } from './maps.js';
import { World } from './world.js';
import { Entity } from './entity.js';
import { updateAI } from './ai.js';
import { Camera, layoutViewports } from './camera.js';
import { pickMode } from './modes.js';
import { BOT_SKINS } from './skins.js';
import { BINDINGS } from './input.js';
import * as store from './storage.js';

const BOT_NAMES = ['Nova', 'Blitz', 'Echo', 'Pixel', 'Rocket', 'Zap', 'Comet', 'Dash'];

export class Game {
  constructor(renderer, input) {
    this.renderer = renderer;
    this.input = input;
    this.state = 'idle'; // idle | countdown | playing | paused | over
    this.entities = [];
    this.cameras = [];
    this.viewports = [];
    this.accumulator = 0;
    this.fps = 60;
    this.showFps = false;
    this.timeLeft = 0;
    this.countdown = 0;
    this.onMatchEnd = null;
    this.banner = '';
    this.bannerTime = 0;
  }

  get humanCount() { return this.cameras.length; }

  /** Build a brand new match. `humans` is 1..4. */
  start(humans, forcedMode, forcedMap) {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
    this.rng = makeRng(seed);
    this.map = buildMap(this.rng.int(1, 0x7ffffff), forcedMap);
    this.world = new World(this.map);
    this.mode = pickMode(this.rng, forcedMode);
    this.renderer.setTint(this.map.tint);

    const save = store.load();
    this.entities.length = 0;

    for (let i = 0; i < humans; i++) {
      this.entities.push(new Entity(i, BINDINGS[i].name, true, save.equipped[i], i));
    }
    const names = BOT_NAMES.slice();
    for (let i = names.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      const t = names[i]; names[i] = names[j]; names[j] = t;
    }
    for (let i = humans; i < MATCH.slots; i++) {
      const skin = BOT_SKINS[(i * 3 + this.rng.int(0, 7)) % BOT_SKINS.length];
      this.entities.push(new Entity(i, names[i - humans], false, skin, -1));
    }

    // Spread everyone across the spawn points.
    const spawns = this.map.spawns.slice();
    for (let i = spawns.length - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      const t = spawns[i]; spawns[i] = spawns[j]; spawns[j] = t;
    }
    for (let i = 0; i < this.entities.length; i++) {
      const s = spawns[i % spawns.length];
      this.entities[i].reset(s.x, s.y);
    }

    // Who starts as IT / patient zero.
    const first = this.rng.int(0, this.entities.length - 1);
    for (const e of this.entities) {
      e.isIt = false;
      e.isZombie = false;
      e.itTime = 0;
      e.infectedAt = Infinity;
      e.tagCd = 0;
      e.lockTarget = -1;
      e.think = this.rng() * 0.2;
    }
    if (this.mode.rule === 'infect') {
      this.entities[first].isZombie = true;
      this.entities[first].infectedAt = 0;
    } else {
      this.entities[first].isIt = true;
      this.entities[first].tagCd = MATCH.tagCooldown;
    }

    // Cameras: one viewport per local human.
    this.cameras.length = 0;
    const scale = CAM.scaleFor[Math.min(humans, 4)];
    for (let i = 0; i < humans; i++) this.cameras.push(new Camera(this.entities[i], scale));
    this.layout();
    for (const c of this.cameras) c.snap();

    this.timeLeft = this.mode.duration;
    this.countdown = MATCH.countdown;
    this.accumulator = 0;
    this.result = null;
    this.banner = '';
    this.bannerTime = 0;
    this.state = 'countdown';
  }

  layout() {
    const vps = layoutViewports(this.cameras.length, this.renderer.width, this.renderer.height, this.viewports);
    for (let i = 0; i < this.cameras.length; i++) {
      const v = vps[i];
      this.cameras[i].setViewport(v.x, v.y, v.w, v.h);
    }
  }

  togglePause() {
    if (this.state === 'playing' || this.state === 'countdown') { this.state = 'paused'; return true; }
    if (this.state === 'paused') { this.state = 'countdown'; this.countdown = Math.max(this.countdown, 1); return false; }
    return false;
  }

  quit() {
    this.state = 'idle';
    this.entities.length = 0;
    this.cameras.length = 0;
  }

  /** Called once per rendered frame. Runs 0..maxSteps fixed simulation steps. */
  update(dt) {
    if (this.state === 'idle' || this.state === 'over' || this.state === 'paused') return;

    // Human input is sampled once per frame and held across the fixed steps.
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.isHuman) this.input.applyTo(e, e.slot);
    }

    this.accumulator += dt;
    const step = PHYS.fixedDt;
    let steps = 0;
    while (this.accumulator >= step && steps < PHYS.maxSteps) {
      this.fixedStep(step);
      this.accumulator -= step;
      steps++;
    }
    if (steps === PHYS.maxSteps) this.accumulator = 0; // drop the backlog

    for (let i = 0; i < this.cameras.length; i++) this.cameras[i].update(dt, this.world);
    if (this.bannerTime > 0) this.bannerTime -= dt;

    const pads = this.world.pads;
    for (let i = 0; i < pads.length; i++) if (pads[i].anim > 0) pads[i].anim = Math.max(0, pads[i].anim - dt * 4);
  }

  get alpha() { return this.accumulator / PHYS.fixedDt; }

  fixedStep(dt) {
    const ents = this.entities;

    if (this.countdown > 0) {
      this.countdown -= dt;
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i];
        e.input.left = e.input.right = e.input.jump = e.input.jumpHeld = false;
        e.step(dt, this.world, this.mode);
      }
      if (this.countdown <= 0) this.state = 'playing';
      return;
    }

    this.timeLeft -= dt;

    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!e.isHuman) updateAI(this, e, dt);
      e.step(dt, this.world, this.mode);
      if (e.isIt || e.isZombie) e.itTime += dt;
    }

    this.resolveTags();

    if (this.timeLeft <= 0) this.finish('time');
    else if (this.mode.rule === 'infect' && ents.every((e) => e.isZombie)) this.finish('infected');
  }

  resolveTags() {
    const ents = this.entities;
    const infect = this.mode.rule === 'infect';
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i];
      if (!(a.isIt || a.isZombie)) continue;
      if (a.tagCd > 0 || a.freeze > 0) continue;
      for (let j = 0; j < ents.length; j++) {
        const b = ents[j];
        if (b === a || b.isIt || b.isZombie) continue;
        if (a.lockTarget === b.index) continue;
        if (!a.touches(b)) continue;

        if (infect) {
          b.isZombie = true;
          b.infectedAt = this.mode.duration - this.timeLeft;
          b.freeze = MATCH.tagFreeze * 0.8;
          b.tagCd = MATCH.tagCooldown;
          a.tagCd = 0.5;
          this.setBanner(`${a.name} infected ${b.name}!`);
        } else {
          a.isIt = false;
          a.lockTarget = -1;
          b.isIt = true;
          b.tagCd = MATCH.tagCooldown;
          b.freeze = MATCH.tagFreeze;
          b.lockTarget = a.index;
          b.lockTime = MATCH.tagBackLock;
          this.setBanner(`${b.name} is IT!`);
        }
        break;
      }
    }
  }

  setBanner(text) {
    this.banner = text;
    this.bannerTime = 1.6;
  }

  finish(reason) {
    if (this.state === 'over') return;
    this.state = 'over';

    const ents = this.entities.slice();
    const dur = this.mode.duration;

    if (this.mode.rule === 'infect') {
      // Survive longest = win. Never infected ranks above everyone.
      ents.sort((a, b) => {
        const sa = a.infectedAt === Infinity ? dur + 1000 : a.infectedAt;
        const sb = b.infectedAt === Infinity ? dur + 1000 : b.infectedAt;
        return sb - sa || a.index - b.index;
      });
    } else {
      // Least time spent as IT wins; whoever is IT at the buzzer is last.
      ents.sort((a, b) => {
        const sa = a.itTime + (a.isIt ? 1e6 : 0);
        const sb = b.itTime + (b.isIt ? 1e6 : 0);
        return sa - sb || a.index - b.index;
      });
    }

    let earned = 0;
    const rows = ents.map((e, i) => {
      const coins = COINS[Math.min(i, COINS.length - 1)];
      if (e.isHuman) earned += coins;
      let detail;
      if (this.mode.rule === 'infect') {
        detail = e.infectedAt === Infinity ? 'Survived the outbreak' : `Infected at ${e.infectedAt.toFixed(1)}s`;
      } else {
        detail = e.isIt ? `IT at the buzzer · ${e.itTime.toFixed(1)}s tagged` : `${e.itTime.toFixed(1)}s spent as IT`;
      }
      return { place: i + 1, name: e.name, isHuman: e.isHuman, skin: e.skin, coins, detail };
    });

    if (earned > 0) store.addCoins(earned);
    store.recordMatch(rows[0].isHuman);

    this.result = {
      reason,
      rows,
      earned,
      mode: this.mode,
      map: this.map,
      coins: store.load().coins,
    };
    if (this.onMatchEnd) this.onMatchEnd(this.result);
  }
}
