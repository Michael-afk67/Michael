// Touch controls: a floating virtual joystick + a jump button + a pause
// button. They write into the same input.left/right/jump/jumpHeld fields the
// keyboard uses, so entity.step() never needs to know which device produced
// the input — Game just merges touch on top of keyboard for the P1 slot.

const DEAD_ZONE = 0.28;
const RADIUS = 50;

function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  constructor() {
    this.mode = 'auto'; // 'auto' | 'on' | 'off'
    this.isTouch = isTouchDevice();

    this.root = document.getElementById('touch-controls');
    this.stickZone = document.getElementById('stick-zone');
    this.stickBase = document.getElementById('stick-base');
    this.stickKnob = document.getElementById('stick-knob');
    this.jumpBtn = document.getElementById('touch-jump');
    this.pauseBtn = document.getElementById('touch-pause');

    this.state = { left: false, right: false, jump: false, jumpHeld: false };
    this.onPause = null;

    this._stickId = null;
    this._baseX = 0;
    this._baseY = 0;
    this._visible = false;

    this._bind();
  }

  get enabled() {
    if (this.mode === 'off') return false;
    if (this.mode === 'on') return true;
    return this.isTouch;
  }

  setMode(mode) {
    this.mode = mode;
    this.setVisible(this._visible);
  }

  _bind() {
    this.stickZone.addEventListener('pointerdown', (e) => {
      if (this._stickId !== null) return;
      this._stickId = e.pointerId;
      this.stickZone.setPointerCapture(e.pointerId);
      this._baseX = e.clientX;
      this._baseY = e.clientY;
      this.stickBase.style.left = `${e.clientX}px`;
      this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('show');
      this._updateStick(e.clientX, e.clientY);
    });
    this.stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      this._updateStick(e.clientX, e.clientY);
    });
    const releaseStick = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      this.state.left = false;
      this.state.right = false;
      this.stickBase.classList.remove('show');
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    };
    this.stickZone.addEventListener('pointerup', releaseStick);
    this.stickZone.addEventListener('pointercancel', releaseStick);

    this.jumpBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.state.jumpHeld = true;
      this.state.jump = true;
      this.jumpBtn.classList.add('pressed');
    });
    const releaseJump = () => {
      this.state.jumpHeld = false;
      this.jumpBtn.classList.remove('pressed');
    };
    this.jumpBtn.addEventListener('pointerup', releaseJump);
    this.jumpBtn.addEventListener('pointercancel', releaseJump);
    this.jumpBtn.addEventListener('pointerleave', releaseJump);

    this.pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.onPause) this.onPause();
    });
  }

  _updateStick(clientX, clientY) {
    let dx = clientX - this._baseX;
    let dy = clientY - this._baseY;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS;
      dy = (dy / dist) * RADIUS;
    }
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const norm = dx / RADIUS;
    this.state.left = norm < -DEAD_ZONE;
    this.state.right = norm > DEAD_ZONE;
  }

  setVisible(visible) {
    this._visible = visible;
    this.root.classList.toggle('show', visible && this.enabled);
  }

  /** Merge touch state onto an entity's input (OR'd with any keyboard state). */
  applyTo(entity) {
    const inp = entity.input;
    if (this.state.left) inp.left = true;
    if (this.state.right) inp.right = true;
    if (this.state.jumpHeld) inp.jumpHeld = true;
    if (this.state.jump) {
      inp.jump = true;
      this.state.jump = false;
    }
  }
}
