# Hitscan leaderboard server

A small Node.js server for the global leaderboard in `hitscan-3d.html`. It serves the game, hands
the game its signing passphrase, checks every submitted score's signature and stores the good ones
in a SQLite table called `Leaderboard`. It has no dependencies: it only uses modules built into
Node.js, so there is nothing to `npm install`.

## Run it on your computer

You need Node.js 22.13 or newer (`node --version`).

```bash
cd hitscan-server
LEADERBOARD_PASSPHRASE='pick-your-own-long-secret' node server.js
```

Then open <http://localhost:8787>. The menu's leaderboard switch shows **Global top 100** live. Finish
a standard round (Easy, Medium, Hard or Demon), save your callsign, and the score is posted to the
server too. Node prints a one-time "SQLite is an experimental feature" warning; that is expected.

Opening `hitscan-3d.html` straight from a file still works, but then there is no server to talk to,
so the global board says it is offline and only **My scores** (saved in the browser) is filled.

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on |
| `HOST` | `0.0.0.0` | Address to listen on |
| `LEADERBOARD_PASSPHRASE` | `hitscan-range-key-change-me` | The secret used to sign scores. Set your own. |
| `DATABASE_FILE` | `hitscan-server/leaderboard.db` | Where the SQLite file lives. Put it on a disk that survives restarts. |
| `PUBLIC_URL` | none | The game's public address. The QR code on the share card points here. |
| `GAME_FILE` | `../hitscan-3d.html` | The game page served at `/` |
| `RATE_LIMIT_PER_MINUTE` | `12` | Scores one address may post per minute |
| `TRUST_PROXY` | off | Set to `1` when the server runs behind a reverse proxy (most hosts), so the real client address is read from `X-Forwarded-For`. Leave it off otherwise: anyone can fake that header. |

## The table

`schema.sql` creates it when the server starts:

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `VARCHAR(48)` primary key | Unique record id from the game, such as `RUN-mh2k1x9a-4f0qz` |
| `user_id` | `VARCHAR(40)` | The player's account id, such as `USR-k3j9x0q2m7b1c4d8` |
| `callsign` | `VARCHAR(12)` | Name shown on the board, 1 to 12 characters |
| `difficulty` | `TINYINT` | 0 Easy, 1 Medium, 2 Hard, 3 Demon |
| `score` | `INTEGER` | Raw score of the round |
| `accuracy` | `DECIMAL(5,2)` | Hit percentage with two decimals, such as `93.47` |
| `max_streak` | `INTEGER` | Longest run of hits in a row |
| `duration_seconds` | `SMALLINT` | Round length, 10 to 150 seconds |
| `finished_at` | `TIMESTAMP` | When the round ended (UTC) |

Ranking: higher score first, then higher accuracy, then the earlier run.

## How the anti-cheat signature works

1. When the game finishes a standard round and the player saves it, it builds one string from the
   callsign, the score, the accuracy (always two decimals) and the passphrase, joined with `|`:
   `ACE|48210|93.47|<passphrase>`.
2. It hashes that string with SHA-256 and sends the 64-character hex signature along with the stats.
3. The server rebuilds the same string with **its own** copy of the passphrase and hashes it. If the
   two signatures match, the score is saved. If they do not, the score is dropped at once and the
   game gets `403 signature mismatch`.

The server also refuses scores no real round can produce (for example, more points than the level
allows in that many seconds, or a positive score with no hits), and takes at most 12 scores a minute
from one address (`RATE_LIMIT_PER_MINUTE`).

**Be aware of the limit of this design.** The browser must know the passphrase to sign, so it gets it
from `GET /api/config`, and anyone who opens the browser's developer tools can read it and sign a
made-up score. Signing stops casual tampering (editing a request by hand, replaying a score with a
changed number), not a determined cheater. Stopping those for real means the server has to watch the
game being played, which is a much bigger project.

## API

`GET /api/config` returns `{ "passphrase": "…", "publicUrl": "…" | null, "topSize": 100 }`.

`GET /api/leaderboard?difficulty=1&offset=0&limit=10` returns one page of the top 100:

```json
{
  "difficulty": 1, "offset": 0, "limit": 10, "total": 37,
  "entries": [
    { "rank": 1, "id": "RUN-…", "callsign": "ACE", "score": 48210, "accuracy": 93.47,
      "maxStreak": 27, "durationSeconds": 60, "finishedAt": "2026-10-28T12:00:00.000Z" }
  ]
}
```

`POST /api/scores` with a JSON body:

```json
{ "id": "RUN-…", "userId": "USR-…", "callsign": "ACE", "difficulty": 1, "score": 48210,
  "accuracy": "93.47", "maxStreak": 27, "durationSeconds": 60,
  "finishedAt": "2026-10-28T12:00:00.000Z", "signature": "<64 hex characters>" }
```

It answers `201 { "accepted": true, "id": "RUN-…", "rank": 4, "total": 38 }`, or
`403 { "accepted": false, "reason": "signature mismatch" }`, or `400` with the reason a field was
refused.

## Putting it online

Any host that runs a Node.js 22.13+ process and keeps a file between restarts will do. Upload the
repository (the server reads `../hitscan-3d.html`), set `LEADERBOARD_PASSPHRASE`, `DATABASE_FILE`
(on the persistent disk), `PUBLIC_URL` and, if the host puts a proxy in front of your app,
`TRUST_PROXY=1`. Start it with `npm start` from `hitscan-server/`.

If the game page is hosted somewhere else (for example GitHub Pages), set the server's address in
`hitscan-3d.html`:

```js
const GLOBAL_LEADERBOARD_SERVER = 'https://your-hitscan-server.example.com';
```

The server already allows requests from any site (CORS), so the page can reach it.
