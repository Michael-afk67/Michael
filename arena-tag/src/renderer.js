// Canvas renderer.
//
// Performance rules followed here:
//  * one canvas, one context, no per-frame object allocation
//  * static geometry culled through the world grid before drawing
//  * gradients / star tiles built once on resize, never per frame
//  * interpolated positions computed once per frame, reused by every viewport

import { COLORS } from './config.js';
import { getSkin } from './skins.js';

const MAX_DPR = 2;

function roundRect(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cull = [];
    this.starPattern = null;
    this.nebulaPattern = null;
    this.skyGrad = null;
    this.sky = { top: '#1c2c56', mid: '#243866' };
    this.glow = ['#5ab0ff', '#c26bff'];
    this._buildStars();
    this._buildNebula();
  }

  _buildStars() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    let seed = 1337;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 42; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 0.6 + rand() * 1.4;
      g.globalAlpha = 0.25 + rand() * 0.5;
      g.fillStyle = '#9fc2ff';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    this.starTile = c;
    this.starPattern = this.ctx.createPattern(c, 'repeat');
  }

  /** Big soft color blobs, tiled as a slow parallax layer behind the stars. */
  _buildNebula() {
    const size = 768;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.clearRect(0, 0, size, size);
    let seed = 91;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const spots = [
      { x: 0.18, y: 0.22, r: 0.30, c: this.glow[0] },
      { x: 0.78, y: 0.18, r: 0.26, c: this.glow[1] },
      { x: 0.55, y: 0.62, r: 0.34, c: this.glow[0] },
      { x: 0.1, y: 0.75, r: 0.24, c: this.glow[1] },
    ];
    g.globalCompositeOperation = 'lighter';
    for (const s of spots) {
      const cx = (s.x + (rand() - 0.5) * 0.08) * size;
      const cy = (s.y + (rand() - 0.5) * 0.08) * size;
      const r = s.r * size;
      const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, s.c + '55');
      rg.addColorStop(1, s.c + '00');
      g.fillStyle = rg;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }
    this.nebulaTile = c;
    this.nebulaPattern = this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (this.width === w && this.height === h && this.dpr === dpr) return false;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this._buildSky();
    return true;
  }

  /** Called once per match: swaps in the map's vivid sky + nebula colors. */
  setPalette(map) {
    this.sky = (map && map.sky) || this.sky;
    this.glow = (map && map.glow) || this.glow;
    this._buildSky();
    this._buildNebula();
  }

  _buildSky() {
    if (!this.height) return;
    const g = this.ctx.createLinearGradient(0, 0, 0, this.height);
    g.addColorStop(0, this.sky.top);
    g.addColorStop(0.45, this.sky.mid);
    g.addColorStop(1, COLORS.bg0);
    this.skyGrad = g;
  }

  draw(game, alpha) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.bg0;
    ctx.fillRect(0, 0, this.width, this.height);

    // Interpolate once, reuse in every viewport.
    const ents = game.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      e.rx = e.px + (e.x - e.px) * alpha;
      e.ry = e.py + (e.y - e.py) * alpha;
    }

    for (let i = 0; i < game.cameras.length; i++) {
      this._viewport(game, game.cameras[i]);
    }

    // Split-screen dividers
    if (game.cameras.length > 1) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      for (let i = 0; i < game.cameras.length; i++) {
        const c = game.cameras[i];
        ctx.fillRect(c.vx, c.vy, c.vw, 2);
        ctx.fillRect(c.vx, c.vy, 2, c.vh);
      }
    }

    this._hud(game);
  }

  _viewport(game, cam) {
    const ctx = this.ctx;
    const world = game.world;
    const s = cam.scale;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cam.vx, cam.vy, cam.vw, cam.vh);
    ctx.clip();
    ctx.translate(cam.vx, cam.vy);

    // --- background (screen space, parallax scrolled)
    ctx.fillStyle = this.skyGrad;
    ctx.fillRect(0, 0, cam.vw, cam.vh);
    if (this.nebulaPattern) {
      const nx = -(cam.x * 0.10) % 768;
      const ny = -(cam.y * 0.10) % 768;
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.translate(nx, ny);
      ctx.fillStyle = this.nebulaPattern;
      ctx.fillRect(-nx - 768, -ny - 768, cam.vw + 1536, cam.vh + 1536);
      ctx.restore();
    }
    if (this.starPattern) {
      const ox = -(cam.x * 0.25) % 256;
      const oy = -(cam.y * 0.25) % 256;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillStyle = this.starPattern;
      ctx.fillRect(-ox - 256, -oy - 256, cam.vw + 512, cam.vh + 512);
      ctx.restore();
    }

    // --- world space
    const viewW = cam.vw / s;
    const viewH = cam.vh / s;
    const camLeft = cam.x - viewW / 2;
    const camTop = cam.y - viewH / 2;

    ctx.scale(s, s);
    ctx.translate(-camLeft, -camTop);

    // Platforms (grid-culled to the visible rect)
    const list = world.queryInto(camLeft - 40, camTop - 40, viewW + 80, viewH + 80, this.cull);
    ctx.fillStyle = COLORS.platform;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
    ctx.fillStyle = COLORS.platformTop;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      ctx.fillRect(p.x, p.y, p.w, 4);
    }

    // Drum pads
    const pads = world.pads;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p.x + p.w < camLeft || p.x > camLeft + viewW || p.y + p.h < camTop || p.y > camTop + viewH) continue;
      const squish = p.anim * 6;
      ctx.fillStyle = COLORS.pad;
      roundRect(ctx, p.x, p.y + squish, p.w, p.h - squish, 6);
      ctx.fill();
      ctx.fillStyle = COLORS.padTop;
      ctx.fillRect(p.x + 6, p.y + squish + 3, p.w - 12, 3);
    }

    // Entities
    const ents = game.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.rx + 60 < camLeft || e.rx - 60 > camLeft + viewW || e.ry + 80 < camTop || e.ry - 80 > camTop + viewH) continue;
      this._entity(ctx, e);
    }

    ctx.restore();

    // --- viewport overlay (screen space)
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cam.vx, cam.vy, cam.vw, cam.vh);
    ctx.clip();
    ctx.translate(cam.vx, cam.vy);
    this._offscreenMarkers(ctx, cam, game);
    this._viewportLabel(ctx, cam, game);
    ctx.restore();
  }

  _entity(ctx, e) {
    const skin = getSkin(e.skin);
    const hostile = e.isIt || e.isZombie;
    const squash = e.squash;
    const w = e.w * (1 - squash * 0.18);
    const h = e.h * (1 + squash * 0.22);
    const x = e.rx - w / 2;
    const y = e.ry + e.h / 2 - h;

    if (hostile) {
      ctx.fillStyle = e.isZombie ? 'rgba(94,224,106,0.20)' : 'rgba(255,71,87,0.22)';
      ctx.beginPath();
      ctx.arc(e.rx, e.ry, 34, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = e.isZombie ? '#3f9b4a' : skin.body;
    roundRect(ctx, x, y, w, h, 7);
    ctx.fill();

    if (skin.pattern === 'stripe') {
      ctx.fillStyle = skin.accent;
      ctx.fillRect(x, y + h * 0.45, w, 4);
    } else if (skin.pattern === 'dot') {
      ctx.fillStyle = skin.accent;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h * 0.72, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Eyes (face direction)
    const ex = x + w / 2 + e.face * 4;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ex - 5, y + 8, 4, 5);
    ctx.fillRect(ex + 2, y + 8, 4, 5);
    ctx.fillStyle = '#101018';
    ctx.fillRect(ex - 4 + e.face, y + 10, 2, 3);
    ctx.fillRect(ex + 3 + e.face, y + 10, 2, 3);

    // IT crown / zombie tag
    if (hostile) {
      ctx.fillStyle = e.isZombie ? COLORS.zombie : COLORS.it;
      ctx.beginPath();
      ctx.moveTo(e.rx - 9, y - 5);
      ctx.lineTo(e.rx, y - 16);
      ctx.lineTo(e.rx + 9, y - 5);
      ctx.closePath();
      ctx.fill();
    }

    if (e.freeze > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 8);
      ctx.stroke();
    }

    // Name plate
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = e.isHuman ? '#ffffff' : 'rgba(255,255,255,0.55)';
    ctx.fillText(e.name, e.rx, y - (hostile ? 22 : 8));
  }

  /** Edge arrows pointing at off-screen taggers/zombies. */
  _offscreenMarkers(ctx, cam, game) {
    const s = cam.scale;
    const ents = game.entities;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (!(e.isIt || e.isZombie) || e === cam.target) continue;
      const sx = (e.rx - cam.x) * s + cam.vw / 2;
      const sy = (e.ry - cam.y) * s + cam.vh / 2;
      if (sx > 20 && sx < cam.vw - 20 && sy > 20 && sy < cam.vh - 20) continue;
      const cx = Math.max(18, Math.min(cam.vw - 18, sx));
      const cy = Math.max(18, Math.min(cam.vh - 18, sy));
      const ang = Math.atan2(sy - cam.vh / 2, sx - cam.vw / 2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.fillStyle = e.isZombie ? COLORS.zombie : COLORS.it;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-7, -6);
      ctx.lineTo(-7, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  _viewportLabel(ctx, cam, game) {
    const t = cam.target;
    if (!t) return;
    const hostile = t.isIt || t.isZombie;
    if (hostile) {
      ctx.strokeStyle = t.isZombie ? 'rgba(94,224,106,0.55)' : 'rgba(255,71,87,0.55)';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, cam.vw - 6, cam.vh - 6);
    }
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(8, 8, 116, 22);
    ctx.fillStyle = hostile ? (t.isZombie ? COLORS.zombie : COLORS.it) : '#cfe0ff';
    const state = game.mode.rule === 'infect'
      ? (t.isZombie ? 'ZOMBIE' : 'SURVIVOR')
      : (t.isIt ? "YOU'RE IT" : 'RUNNER');
    ctx.fillText(`${t.name} · ${state}`, 14, 23);
  }

  _hud(game) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cx = this.width / 2;

    ctx.fillStyle = 'rgba(6,10,22,0.72)';
    roundRect(ctx, cx - 130, 8, 260, 52, 12);
    ctx.fill();

    const time = Math.max(0, game.timeLeft);
    const mm = Math.floor(time / 60);
    const ss = Math.floor(time % 60);
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle = time <= 10 ? '#ff6b6b' : '#ffffff';
    ctx.fillText(`${mm}:${ss < 10 ? '0' : ''}${ss}`, cx, 34);
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillStyle = game.mode.accent;
    ctx.fillText(`${game.mode.name.toUpperCase()} · ${game.map.name.toUpperCase()}`, cx, 51);

    if (game.mode.rule === 'infect') {
      const alive = game.entities.reduce((n, e) => n + (e.isZombie ? 0 : 1), 0);
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = COLORS.zombie;
      ctx.fillText(`${alive} SURVIVOR${alive === 1 ? '' : 'S'} LEFT`, cx, 74);
    }

    if (game.bannerTime > 0 && game.countdown <= 0) {
      const a = Math.min(1, game.bannerTime / 0.4);
      ctx.globalAlpha = a;
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(6,10,22,0.72)';
      const tw = ctx.measureText(game.banner).width + 28;
      roundRect(ctx, cx - tw / 2, this.height - 62, tw, 34, 10);
      ctx.fill();
      ctx.fillStyle = game.mode.accent;
      ctx.fillText(game.banner, cx, this.height - 39);
      ctx.globalAlpha = 1;
    }

    if (game.countdown > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 90px system-ui, sans-serif';
      const n = Math.ceil(game.countdown);
      ctx.fillText(n > 0 ? String(n) : 'GO!', cx, this.height / 2);
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillStyle = game.mode.accent;
      ctx.fillText(game.mode.blurb, cx, this.height / 2 + 44);
    }

    if (game.showFps) {
      ctx.textAlign = 'right';
      ctx.font = '12px monospace';
      ctx.fillStyle = '#8fe6a0';
      ctx.fillText(`${game.fps.toFixed(0)} fps`, this.width - 10, 20);
    }
  }
}
