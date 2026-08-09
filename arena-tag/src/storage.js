// Persistent wallet + skin ownership (localStorage). Falls back to an
// in-memory object when storage is unavailable (private mode / file://).

const KEY = 'arena-tag-save-v1';

const DEFAULT_SAVE = {
  coins: 0,
  owned: ['rookie'],
  equipped: ['rookie', 'rookie', 'rookie', 'rookie'],
  matches: 0,
  wins: 0,
};

let cache = null;

function readRaw() {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeRaw(value) {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    /* storage blocked: keep the in-memory copy only */
  }
}

export function load() {
  if (cache) return cache;
  const raw = readRaw();
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = null; }
  }
  cache = Object.assign({}, DEFAULT_SAVE, data || {});
  cache.owned = Array.isArray(cache.owned) && cache.owned.length ? cache.owned.slice() : ['rookie'];
  if (!cache.owned.includes('rookie')) cache.owned.push('rookie');
  cache.equipped = Array.isArray(cache.equipped) ? cache.equipped.slice(0, 4) : [];
  while (cache.equipped.length < 4) cache.equipped.push('rookie');
  cache.equipped = cache.equipped.map((id) => (cache.owned.includes(id) ? id : 'rookie'));
  cache.coins = Math.max(0, Math.floor(cache.coins) || 0);
  return cache;
}

export function save() {
  writeRaw(JSON.stringify(load()));
}

export function addCoins(amount) {
  const s = load();
  s.coins = Math.max(0, s.coins + Math.floor(amount));
  save();
  return s.coins;
}

export function buySkin(skin) {
  const s = load();
  if (s.owned.includes(skin.id)) return true;
  if (s.coins < skin.cost) return false;
  s.coins -= skin.cost;
  s.owned.push(skin.id);
  save();
  return true;
}

export function equipSkin(slot, skinId) {
  const s = load();
  if (!s.owned.includes(skinId)) return false;
  s.equipped[slot] = skinId;
  save();
  return true;
}

export function recordMatch(won) {
  const s = load();
  s.matches += 1;
  if (won) s.wins += 1;
  save();
}
