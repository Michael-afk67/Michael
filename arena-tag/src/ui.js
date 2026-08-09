// DOM-based menus (main menu, store, leaderboard, pause). Menus are plain
// HTML so they cost nothing while the match is running — the canvas is only
// visible during play.

import { SKINS, getSkin } from './skins.js';
import { MODES } from './modes.js';
import { MAP_POOL } from './maps.js';
import { BINDINGS } from './input.js';
import * as store from './storage.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(hooks) {
    this.hooks = hooks;
    this.screens = {
      menu: $('screen-menu'),
      store: $('screen-store'),
      results: $('screen-results'),
      pause: $('screen-pause'),
    };
    this.players = 1;
    this.mode = '';   // '' = random
    this.map = '';    // '' = random
    this.storeSlot = 0;

    this._buildMenu();
    this._buildStore();
    this.show('menu');
    this.refreshCoins();
  }

  show(name) {
    for (const key of Object.keys(this.screens)) {
      this.screens[key].classList.toggle('active', key === name);
    }
    $('game-canvas').classList.toggle('playing', name === null || name === 'pause');
    this.current = name;
  }

  hideAll() {
    for (const key of Object.keys(this.screens)) this.screens[key].classList.remove('active');
    $('game-canvas').classList.add('playing');
    this.current = null;
  }

  refreshCoins() {
    const coins = store.load().coins;
    for (const el of document.querySelectorAll('.coin-value')) el.textContent = coins.toLocaleString();
  }

  /* ------------------------------------------------------------ main menu */

  _buildMenu() {
    const playerRow = $('player-count');
    playerRow.innerHTML = '';
    for (let n = 1; n <= 4; n++) {
      const b = document.createElement('button');
      b.className = 'chip' + (n === 1 ? ' on' : '');
      b.textContent = n === 1 ? '1 Player' : `${n} Players`;
      b.onclick = () => {
        this.players = n;
        for (const c of playerRow.children) c.classList.remove('on');
        b.classList.add('on');
        this._renderControls();
      };
      playerRow.appendChild(b);
    }

    const modeRow = $('mode-select');
    modeRow.innerHTML = '';
    const modeOptions = [{ id: '', name: 'Random Mode' }].concat(Object.values(MODES).map((m) => ({ id: m.id, name: m.name })));
    for (const opt of modeOptions) {
      const b = document.createElement('button');
      b.className = 'chip' + (opt.id === '' ? ' on' : '');
      b.textContent = opt.name;
      b.onclick = () => {
        this.mode = opt.id;
        for (const c of modeRow.children) c.classList.remove('on');
        b.classList.add('on');
      };
      modeRow.appendChild(b);
    }

    const mapRow = $('map-select');
    mapRow.innerHTML = '';
    const mapOptions = [{ id: '', name: 'Random Map' }].concat(MAP_POOL.map((m) => ({ id: m.id, name: m.name })));
    for (const opt of mapOptions) {
      const b = document.createElement('button');
      b.className = 'chip' + (opt.id === '' ? ' on' : '');
      b.textContent = opt.name;
      b.onclick = () => {
        this.map = opt.id;
        for (const c of mapRow.children) c.classList.remove('on');
        b.classList.add('on');
      };
      mapRow.appendChild(b);
    }

    $('btn-play').onclick = () => this.hooks.onPlay(this.players, this.mode, this.map);
    $('btn-store').onclick = () => { this.show('store'); this._renderStore(); };
    $('btn-store-back').onclick = () => this.show('menu');
    $('btn-results-again').onclick = () => this.hooks.onPlay(this.players, this.mode, this.map);
    $('btn-results-menu').onclick = () => { this.show('menu'); this.refreshCoins(); };
    $('btn-resume').onclick = () => this.hooks.onResume();
    $('btn-quit').onclick = () => this.hooks.onQuit();

    this._renderControls();
  }

  _renderControls() {
    const el = $('controls-list');
    el.innerHTML = '';
    for (let i = 0; i < this.players; i++) {
      const row = document.createElement('div');
      row.className = 'ctrl-row';
      row.innerHTML = `<span class="ctrl-name">${BINDINGS[i].name}</span><span class="ctrl-keys">${BINDINGS[i].label}</span>`;
      el.appendChild(row);
    }
    const bots = 6 - this.players;
    $('bot-note').textContent = bots > 0
      ? `${bots} AI bot${bots === 1 ? '' : 's'} will fill the arena — always 6 competitors.`
      : 'Full lobby: 6 local players.';
  }

  /* ---------------------------------------------------------------- store */

  _buildStore() {
    const slotRow = $('store-slots');
    slotRow.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.className = 'chip' + (i === 0 ? ' on' : '');
      b.textContent = BINDINGS[i].name;
      b.onclick = () => {
        this.storeSlot = i;
        for (const c of slotRow.children) c.classList.remove('on');
        b.classList.add('on');
        this._renderStore();
      };
      slotRow.appendChild(b);
    }
  }

  _renderStore() {
    const save = store.load();
    const grid = $('store-grid');
    grid.innerHTML = '';
    for (const skin of SKINS) {
      const owned = save.owned.includes(skin.id);
      const equipped = save.equipped[this.storeSlot] === skin.id;
      const card = document.createElement('button');
      card.className = 'skin-card' + (equipped ? ' equipped' : '') + (owned ? ' owned' : '');
      card.innerHTML = `
        <span class="skin-art" style="--body:${skin.body};--accent:${skin.accent}">
          <span class="skin-body"></span>
          <span class="skin-mark ${skin.pattern}"></span>
        </span>
        <span class="skin-name">${skin.name}</span>
        <span class="skin-cost">${equipped ? 'EQUIPPED' : owned ? 'Select' : `${skin.cost} ⬤`}</span>`;
      card.onclick = () => {
        const s = store.load();
        if (!s.owned.includes(skin.id)) {
          if (!store.buySkin(skin)) { this._flash('Not enough coins'); return; }
          this._flash(`Unlocked ${skin.name}!`);
        }
        store.equipSkin(this.storeSlot, skin.id);
        this.refreshCoins();
        this._renderStore();
      };
      grid.appendChild(card);
    }
    $('store-hint').textContent = `Equipping for ${BINDINGS[this.storeSlot].name} · currently ${getSkin(save.equipped[this.storeSlot]).name}`;
  }

  _flash(msg) {
    const el = $('store-flash');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  /* ---------------------------------------------------------- leaderboard */

  showResults(result) {
    const list = $('results-list');
    list.innerHTML = '';
    for (const row of result.rows) {
      const skin = getSkin(row.skin);
      const li = document.createElement('div');
      li.className = 'result-row' + (row.isHuman ? ' human' : '') + (row.place === 1 ? ' first' : '');
      li.innerHTML = `
        <span class="place">${row.place}</span>
        <span class="chip-dot" style="background:${skin.body}"></span>
        <span class="who">${row.name}${row.isHuman ? '' : ' <em>bot</em>'}</span>
        <span class="detail">${row.detail}</span>
        <span class="reward">+${row.coins} ⬤</span>`;
      list.appendChild(li);
    }
    $('results-title').textContent = result.rows[0].isHuman ? `${result.rows[0].name} wins!` : `${result.rows[0].name} wins!`;
    $('results-sub').textContent = `${result.mode.name} · ${result.map.name}`;
    $('results-earned').textContent = `You earned ${result.earned} coins`;
    this.refreshCoins();
    this.show('results');
  }
}
