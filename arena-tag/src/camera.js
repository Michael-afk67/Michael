// One camera per split-screen viewport. Smooth follow with look-ahead,
// clamped to the world so the void never shows.

import { CAM } from './config.js';

export class Camera {
  constructor(target, scale) {
    this.target = target;
    this.scale = scale;
    this.x = target ? target.x : 0;
    this.y = target ? target.y : 0;
    this.vx = 0; this.vy = 0; this.vw = 0; this.vh = 0;
  }

  setViewport(x, y, w, h) {
    this.vx = x; this.vy = y; this.vw = w; this.vh = h;
  }

  snap() {
    if (!this.target) return;
    this.x = this.target.x;
    this.y = this.target.y;
  }

  update(dt, world) {
    const t = this.target;
    if (!t) return;
    const tx = t.x + t.vx * CAM.lookAhead;
    const ty = t.y + t.vy * CAM.lookAhead * 0.5 - 40;
    const k = 1 - Math.exp(-CAM.lerp * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;

    const halfW = this.vw / (2 * this.scale);
    const halfH = this.vh / (2 * this.scale);
    this.x = Math.max(halfW, Math.min(world.width - halfW, this.x));
    this.y = Math.max(halfH, Math.min(world.height - halfH, this.y));
  }
}

/**
 * Split-screen layout for n viewports inside a w*h canvas.
 * 1 -> full, 2 -> side by side, 3 -> two on top + one wide below, 4 -> 2x2.
 */
export function layoutViewports(n, w, h, out) {
  out.length = 0;
  if (n <= 1) {
    out.push({ x: 0, y: 0, w, h });
  } else if (n === 2) {
    const hw = Math.floor(w / 2);
    out.push({ x: 0, y: 0, w: hw, h });
    out.push({ x: hw, y: 0, w: w - hw, h });
  } else if (n === 3) {
    const hw = Math.floor(w / 2);
    const hh = Math.floor(h / 2);
    out.push({ x: 0, y: 0, w: hw, h: hh });
    out.push({ x: hw, y: 0, w: w - hw, h: hh });
    out.push({ x: 0, y: hh, w, h: h - hh });
  } else {
    const hw = Math.floor(w / 2);
    const hh = Math.floor(h / 2);
    out.push({ x: 0, y: 0, w: hw, h: hh });
    out.push({ x: hw, y: 0, w: w - hw, h: hh });
    out.push({ x: 0, y: hh, w: hw, h: h - hh });
    out.push({ x: hw, y: hh, w: w - hw, h: h - hh });
  }
  return out;
}
