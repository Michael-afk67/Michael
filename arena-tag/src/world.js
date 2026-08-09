// World = static geometry + a uniform-grid broadphase.
//
// Every query (physics, ledge probes, render culling) goes through the same
// grid and writes into a reusable output array, so the hot loop allocates
// nothing. That is the single biggest reason the frame time stays flat even
// on the largest maps.

import { GRID_CELL } from './config.js';

export class World {
  constructor(map) {
    this.map = map;
    this.solids = map.solids;
    this.pads = map.pads;
    this.width = map.width;
    this.height = map.height;

    this.cell = GRID_CELL;
    this.cols = Math.ceil(map.width / this.cell) + 1;
    this.rows = Math.ceil((map.height + 400) / this.cell) + 1;
    this.originY = -400; // walls start above the world

    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = null;

    this.stamps = new Int32Array(this.solids.length);
    this.stamp = 0;
    this.out = [];

    for (let i = 0; i < this.solids.length; i++) this._insert(i, this.solids[i]);
  }

  _cellX(x) { return Math.max(0, Math.min(this.cols - 1, Math.floor(x / this.cell))); }
  _cellY(y) { return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.originY) / this.cell))); }

  _insert(index, r) {
    const cx0 = this._cellX(r.x);
    const cx1 = this._cellX(r.x + r.w);
    const cy0 = this._cellY(r.y);
    const cy1 = this._cellY(r.y + r.h);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = cy * this.cols + cx;
        if (!this.buckets[k]) this.buckets[k] = [];
        this.buckets[k].push(index);
      }
    }
  }

  /** Solids overlapping the given AABB. Returns a shared array — do not keep it. */
  query(x, y, w, h) {
    const out = this.out;
    out.length = 0;
    this.stamp++;
    const stamp = this.stamp;
    const cx0 = this._cellX(x);
    const cx1 = this._cellX(x + w);
    const cy0 = this._cellY(y);
    const cy1 = this._cellY(y + h);
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.buckets[row + cx];
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          if (this.stamps[idx] === stamp) continue;
          this.stamps[idx] = stamp;
          const s = this.solids[idx];
          if (x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y) out.push(s);
        }
      }
    }
    return out;
  }

  /** Same as query() but writes into a caller-owned array (used by the renderer). */
  queryInto(x, y, w, h, dest) {
    dest.length = 0;
    this.stamp++;
    const stamp = this.stamp;
    const cx0 = this._cellX(x);
    const cx1 = this._cellX(x + w);
    const cy0 = this._cellY(y);
    const cy1 = this._cellY(y + h);
    for (let cy = cy0; cy <= cy1; cy++) {
      const row = cy * this.cols;
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = this.buckets[row + cx];
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const idx = bucket[i];
          if (this.stamps[idx] === stamp) continue;
          this.stamps[idx] = stamp;
          const s = this.solids[idx];
          if (x < s.x + s.w && x + w > s.x && y < s.y + s.h && y + h > s.y) dest.push(s);
        }
      }
    }
    return dest;
  }

  /** Cheap boolean test used by the AI probes. */
  isSolid(x, y, w, h) {
    return this.query(x, y, w, h).length > 0;
  }
}
