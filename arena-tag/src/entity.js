// A single competitor (human or bot). One class, no inheritance: the only
// difference between a player and a bot is who writes `input` each step.

import { PHYS, BODY, MATCH } from './config.js';

export class Entity {
  constructor(index, name, isHuman, skin, controllerSlot) {
    this.index = index;
    this.name = name;
    this.isHuman = isHuman;
    this.skin = skin;
    this.slot = controllerSlot; // 0..3 for humans, -1 for bots

    this.w = BODY.w;
    this.h = BODY.h;
    this.x = 0; this.y = 0;
    this.px = 0; this.py = 0;    // previous position, for render interpolation
    this.vx = 0; this.vy = 0;
    this.face = 1;
    this.onGround = false;

    this.input = { left: false, right: false, jump: false, jumpHeld: false };

    this.coyote = 0;
    this.jumpBuf = 0;
    this.padCd = 0;
    this.launched = false;       // true while riding a drum-pad bounce
    this.squash = 0;             // visual-only bounce feedback

    // Role state
    this.isIt = false;
    this.isZombie = false;
    this.itTime = 0;
    this.infectedAt = Infinity;
    this.tagCd = 0;
    this.freeze = 0;
    this.lockTarget = -1;
    this.lockTime = 0;

    // AI scratch
    this.think = 0;
    this.wanderX = 0;
    this.jumpHold = 0;
  }

  get left() { return this.x - this.w / 2; }
  get top() { return this.y - this.h / 2; }

  reset(x, y) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.vx = this.vy = 0;
    this.onGround = false;
    this.coyote = this.jumpBuf = this.padCd = 0;
    this.launched = false;
    this.freeze = 0;
    this.squash = 0;
    this.input.left = this.input.right = this.input.jump = this.input.jumpHeld = false;
  }

  get speed() {
    return this.isIt || this.isZombie ? this.mode.itSpeed : this.mode.runnerSpeed;
  }

  step(dt, world, mode) {
    this.mode = mode;
    this.px = this.x;
    this.py = this.y;

    if (this.freeze > 0) {
      this.freeze -= dt;
      this.input.left = this.input.right = false;
    }
    if (this.tagCd > 0) this.tagCd -= dt;
    if (this.lockTime > 0) { this.lockTime -= dt; if (this.lockTime <= 0) this.lockTarget = -1; }
    if (this.padCd > 0) this.padCd -= dt;
    if (this.squash > 0) this.squash = Math.max(0, this.squash - dt * 3);

    const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0);
    if (dir !== 0) this.face = dir;

    // ---- horizontal: accelerate toward the target speed
    const target = dir * this.speed;
    const accel = this.onGround ? PHYS.groundAccel : PHYS.airAccel;
    if (dir !== 0) {
      if (this.vx < target) this.vx = Math.min(target, this.vx + accel * dt);
      else if (this.vx > target) this.vx = Math.max(target, this.vx - accel * dt);
    } else {
      const drag = (this.onGround ? PHYS.friction : PHYS.airDrag) * dt;
      if (this.vx > 0) this.vx = Math.max(0, this.vx - drag);
      else this.vx = Math.min(0, this.vx + drag);
    }

    // ---- jumping (with coyote time + input buffering for a responsive feel)
    if (this.onGround) this.coyote = PHYS.coyote;
    else if (this.coyote > 0) this.coyote -= dt;

    if (this.input.jump) { this.jumpBuf = PHYS.jumpBuffer; this.input.jump = false; }
    else if (this.jumpBuf > 0) this.jumpBuf -= dt;

    if (this.jumpBuf > 0 && this.coyote > 0 && this.freeze <= 0) {
      this.vy = -mode.jumpVel;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.onGround = false;
    }
    // Variable jump height: releasing the button clamps upward velocity.
    // Pad launches are exempt, otherwise letting go would cancel the bounce.
    if (this.vy >= 0 || this.onGround) this.launched = false;
    if (this.vy < 0 && !this.input.jumpHeld && !this.launched) {
      const cut = -mode.jumpVel * PHYS.jumpCut;
      if (this.vy < cut) this.vy = cut;
    }

    // ---- gravity
    this.vy = Math.min(PHYS.maxFall, this.vy + mode.gravity * dt);

    this._moveX(this.vx * dt, world);
    this._moveY(this.vy * dt, world);

    // Soft ceiling: the world is open at the top, so clamp instead of walling.
    if (this.top < PHYS.ceiling) {
      this.y = PHYS.ceiling + this.h / 2;
      if (this.vy < 0) this.vy = 0;
    }

    this._pads(world, mode);
  }

  _moveX(dx, world) {
    if (dx === 0) return;
    this.x += dx;
    const hw = this.w / 2;
    const hh = this.h / 2;
    const hits = world.query(this.x - hw, this.y - hh, this.w, this.h);
    for (let i = 0; i < hits.length; i++) {
      const s = hits[i];
      if (this.x - hw < s.x + s.w && this.x + hw > s.x && this.y - hh < s.y + s.h && this.y + hh > s.y) {
        this.x = dx > 0 ? s.x - hw : s.x + s.w + hw;
        this.vx = 0;
      }
    }
  }

  _moveY(dy, world) {
    if (dy === 0) return;
    this.y += dy;
    const hw = this.w / 2;
    const hh = this.h / 2;
    const hits = world.query(this.x - hw, this.y - hh, this.w, this.h);
    let grounded = false;
    for (let i = 0; i < hits.length; i++) {
      const s = hits[i];
      if (this.x - hw < s.x + s.w && this.x + hw > s.x && this.y - hh < s.y + s.h && this.y + hh > s.y) {
        if (dy > 0) { this.y = s.y - hh; grounded = true; }
        else { this.y = s.y + s.h + hh; }
        this.vy = 0;
      }
    }
    this.onGround = grounded;
  }

  /** Drum pads: touching one flings the entity upward. */
  _pads(world, mode) {
    if (this.padCd > 0) return;
    const pads = world.pads;
    const hw = this.w / 2;
    const hh = this.h / 2;
    const l = this.x - hw, r = this.x + hw, t = this.y - hh, b = this.y + hh;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (l < p.x + p.w && r > p.x && t < p.y + p.h && b > p.y + 2) {
        this.vy = -mode.padBounce;
        this.y = p.y - hh;
        this.onGround = false;
        this.padCd = PHYS.padCooldown;
        this.launched = true;
        this.squash = 1;
        p.anim = 1;
        return;
      }
    }
  }

  /** AABB overlap test used for tagging. */
  touches(other, pad = MATCH.tagPad) {
    return (
      Math.abs(this.x - other.x) < (this.w + other.w) / 2 + pad &&
      Math.abs(this.y - other.y) < (this.h + other.h) / 2 + pad
    );
  }
}
