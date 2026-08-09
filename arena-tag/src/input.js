// Keyboard input for up to 4 local players on one keyboard.
// A flat key-state map + per-slot bindings; no per-frame allocation.

export const BINDINGS = [
  { name: 'P1', left: 'KeyA',      right: 'KeyD',       jump: 'KeyW',    label: 'A / D + W' },
  { name: 'P2', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ArrowUp', label: '← / → + ↑' },
  { name: 'P3', left: 'KeyJ',      right: 'KeyL',       jump: 'KeyI',    label: 'J / L + I' },
  { name: 'P4', left: 'KeyF',      right: 'KeyH',       jump: 'KeyT',    label: 'F / H + T' },
];

const BLOCKED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();   // edge: cleared at the end of each frame
    this.enabled = true;

    this._onDown = (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    };
    this._onUp = (e) => { this.down.delete(e.code); };
    this._onBlur = () => { this.down.clear(); this.pressed.clear(); };

    window.addEventListener('keydown', this._onDown);
    window.addEventListener('keyup', this._onUp);
    window.addEventListener('blur', this._onBlur);
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  /** Copy the bindings for `slot` into an entity's input object. */
  applyTo(entity, slot) {
    const b = BINDINGS[slot];
    const inp = entity.input;
    if (!this.enabled || !b) {
      inp.left = inp.right = inp.jumpHeld = false;
      return;
    }
    inp.left = this.down.has(b.left);
    inp.right = this.down.has(b.right);
    inp.jumpHeld = this.down.has(b.jump);
    if (this.pressed.has(b.jump)) inp.jump = true;
  }

  endFrame() { this.pressed.clear(); }

  destroy() {
    window.removeEventListener('keydown', this._onDown);
    window.removeEventListener('keyup', this._onUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
