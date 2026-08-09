// Character skins for the store. Pure data + flat colors: no image assets,
// so there is nothing to download or decode at runtime.

export const SKINS = [
  { id: 'rookie',  name: 'Rookie',   cost: 0,    body: '#5ab0ff', accent: '#d7ecff', pattern: 'none'   },
  { id: 'ember',   name: 'Ember',    cost: 150,  body: '#ff7043', accent: '#ffd0b0', pattern: 'stripe' },
  { id: 'aqua',    name: 'Aqua',     cost: 150,  body: '#22c7c7', accent: '#c8fbff', pattern: 'dot'    },
  { id: 'mint',    name: 'Mint',     cost: 250,  body: '#4ade80', accent: '#e7ffe9', pattern: 'stripe' },
  { id: 'violet',  name: 'Violet',   cost: 250,  body: '#a06bff', accent: '#ece0ff', pattern: 'dot'    },
  { id: 'sunset',  name: 'Sunset',   cost: 400,  body: '#ff5c8a', accent: '#ffe0aa', pattern: 'stripe' },
  { id: 'toxic',   name: 'Toxic',    cost: 400,  body: '#b4ff2e', accent: '#2b3a00', pattern: 'dot'    },
  { id: 'cosmic',  name: 'Cosmic',   cost: 700,  body: '#6c5ce7', accent: '#ffd93d', pattern: 'dot'    },
  { id: 'shadow',  name: 'Shadow',   cost: 700,  body: '#2f3542', accent: '#8e9bb3', pattern: 'stripe' },
  { id: 'gold',    name: 'Gold',     cost: 1200, body: '#ffc312', accent: '#7a4b00', pattern: 'stripe' },
  { id: 'prism',   name: 'Prism',    cost: 1600, body: '#00d2ff', accent: '#ff4fd8', pattern: 'dot'    },
  { id: 'void',    name: 'Void',     cost: 2500, body: '#12121c', accent: '#c400ff', pattern: 'stripe' },
];

export const BOT_SKINS = ['ember', 'aqua', 'mint', 'violet', 'sunset', 'toxic', 'shadow', 'gold'];

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function getSkin(id) {
  return BY_ID.get(id) || SKINS[0];
}
