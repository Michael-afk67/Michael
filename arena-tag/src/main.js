// Entry point: owns the requestAnimationFrame loop and wires the Game to
// the UI. Kept deliberately thin — all real logic lives in game.js.

import { Renderer } from './renderer.js';
import { Input } from './input.js';
import { TouchControls } from './touch.js';
import { Game } from './game.js';
import { UI } from './ui.js';

const canvas = document.getElementById('game-canvas');
const renderer = new Renderer(canvas);
const input = new Input();
const touch = new TouchControls();
const game = new Game(renderer, input, touch);

const ui = new UI({
  onPlay(players, mode, map) {
    ui.hideAll();
    renderer.resize();
    game.start(players, mode || undefined, map || undefined);
  },
  onResume() {
    ui.hideAll();
    const wasPaused = game.togglePause();
    if (wasPaused) game.togglePause(); // ensure we land on "playing"
  },
  onQuit() {
    game.quit();
    ui.show('menu');
    ui.refreshCoins();
  },
}, touch);

touch.onPause = () => {
  if (game.state === 'playing' || game.state === 'countdown') {
    game.togglePause();
    ui.show('pause');
  }
};

const rotateHint = document.getElementById('rotate-hint');

window.__arenaTag = { game, renderer, ui, touch }; // handy for debugging in devtools

game.onMatchEnd = (result) => {
  setTimeout(() => ui.showResults(result), 500);
};

function resize() {
  if (renderer.resize()) game.layout();
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (game.state === 'playing' || game.state === 'countdown') {
    game.togglePause();
    ui.show('pause');
  } else if (game.state === 'paused') {
    game.togglePause();
    ui.hideAll();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && (game.state === 'playing' || game.state === 'countdown')) {
    game.togglePause();
    ui.show('pause');
  }
});

let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsTimer = 0;
const MAX_FRAME = 1 / 15; // clamp huge gaps (tab switches) so physics doesn't explode

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  fpsAcc += dt; fpsN++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) { game.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; fpsTimer = 0; }

  game.update(dt);
  if (game.state !== 'idle') {
    renderer.draw(game, game.state === 'paused' ? 1 : game.alpha);
  }
  input.endFrame();

  const live = game.state === 'playing' || game.state === 'countdown';
  touch.setVisible(live);
  rotateHint.classList.toggle('show', live);
}
requestAnimationFrame(frame);

window.addEventListener('keydown', (e) => {
  if (e.code === 'F3') game.showFps = !game.showFps;
});
