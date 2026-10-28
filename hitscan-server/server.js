#!/usr/bin/env node
'use strict';

/*
 * HITSCAN leaderboard server. No dependencies: Node.js 22.13 or newer
 * (for the built-in node:sqlite module).
 *
 *   GET  /                  the game (../hitscan-3d.html)
 *   GET  /api/config        the signing passphrase and the game's public address
 *   GET  /api/leaderboard   ?difficulty=0..3&offset=0&limit=10, one page of the top 100
 *   POST /api/scores        a signed score: saved when the signature matches, dropped when not
 *   GET  /api/health        "ok"
 *
 * Settings (environment variables):
 *   PORT                    default 8787
 *   HOST                    default 0.0.0.0
 *   LEADERBOARD_PASSPHRASE  the signing secret; set your own
 *   DATABASE_FILE           default ./leaderboard.db next to this file
 *   PUBLIC_URL              the game's public address, for the share card's QR code
 *   GAME_FILE               default ../hitscan-3d.html
 *   RATE_LIMIT_PER_MINUTE   scores one address may post per minute, default 12
 *   TRUST_PROXY             set to 1 behind a reverse proxy, so the client address is read from X-Forwarded-For
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_PASSPHRASE = 'hitscan-range-key-change-me';
const SETTINGS = Object.freeze({
  port: Number(process.env.PORT) || 8787,
  host: process.env.HOST || '0.0.0.0',
  passphrase: process.env.LEADERBOARD_PASSPHRASE || DEFAULT_PASSPHRASE,
  databaseFile: process.env.DATABASE_FILE || path.join(__dirname, 'leaderboard.db'),
  publicUrl: /^https?:\/\//.test(process.env.PUBLIC_URL || '') ? process.env.PUBLIC_URL : null,
  gameFile: process.env.GAME_FILE || path.join(__dirname, '..', 'hitscan-3d.html'),
  submissionsPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE) > 0 ? Number(process.env.RATE_LIMIT_PER_MINUTE) : 12,
  // X-Forwarded-For is only believable when a proxy we run sets it; otherwise anyone could fake it.
  trustProxy: process.env.TRUST_PROXY === '1'
});

const LIMITS = Object.freeze({
  topSize: 100,
  maxPageSize: 25,
  maxBodyBytes: 4096,
  minDurationSeconds: 10,
  maxDurationSeconds: 150,
  // Plausibility ceiling: nobody lands more than 8 hits a second for a whole round.
  maxHitsPerSecond: 8,
  futureToleranceMs: 5 * 60 * 1000
});

// Base points of one hit per level (0 Easy, 1 Medium, 2 Hard, 3 Demon), as in the game.
const BASE_HIT_POINTS = [100, 150, 220, 300];

const CALLSIGN_PATTERN = /^[A-Z0-9._-](?:[A-Z0-9 ._-]{0,10}[A-Z0-9._-])?$/;
const USER_ID_PATTERN = /^USR-[a-z0-9]{8,32}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9-]{4,48}$/;
const ACCURACY_PATTERN = /^(?:100\.00|\d{1,2}\.\d{2})$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

/* ---------------------------------------------------------------------------
   Database
   --------------------------------------------------------------------------- */

const database = new DatabaseSync(SETTINGS.databaseFile);
database.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

const RANKING_ORDER = 'score DESC, accuracy DESC, finished_at ASC, id ASC';
const statements = {
  insert: database.prepare(
    'INSERT INTO Leaderboard (id, user_id, callsign, difficulty, score, accuracy, max_streak, duration_seconds, finished_at) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ),
  findById: database.prepare('SELECT * FROM Leaderboard WHERE id = ?'),
  countLevel: database.prepare('SELECT COUNT(*) AS total FROM Leaderboard WHERE difficulty = ?'),
  countBetter: database.prepare(
    'SELECT COUNT(*) AS better FROM Leaderboard WHERE difficulty = ? AND ('
    + 'score > ? OR (score = ? AND accuracy > ?) '
    + 'OR (score = ? AND accuracy = ? AND finished_at < ?) '
    + 'OR (score = ? AND accuracy = ? AND finished_at = ? AND id < ?))'
  ),
  page: database.prepare(
    'SELECT id, callsign, score, accuracy, max_streak, duration_seconds, finished_at FROM Leaderboard '
    + 'WHERE difficulty = ? ORDER BY ' + RANKING_ORDER + ' LIMIT ? OFFSET ?'
  )
};

/** 1-based position of a stored row among its level's runs. */
function rankOf(row) {
  const better = statements.countBetter.get(
    row.difficulty,
    row.score, row.score, row.accuracy,
    row.score, row.accuracy, row.finished_at,
    row.score, row.accuracy, row.finished_at, row.id
  ).better;
  return Number(better) + 1;
}

/* ---------------------------------------------------------------------------
   Validation and the signature check
   --------------------------------------------------------------------------- */

/** The game's signature: SHA-256 of "callsign|score|accuracy|passphrase". */
function expectedSignature(callsign, score, accuracyText) {
  return crypto.createHash('sha256')
    .update(callsign + '|' + score + '|' + accuracyText + '|' + SETTINGS.passphrase, 'utf8')
    .digest('hex');
}

function signatureMatches(submission) {
  if (typeof submission.signature !== 'string' || !SIGNATURE_PATTERN.test(submission.signature)) {
    return false;
  }
  const expected = Buffer.from(expectedSignature(submission.callsign, submission.score, submission.accuracy), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(submission.signature, 'hex'));
}

/** The highest score a round of this level and length could reach (a sanity ceiling, not a target). */
function maximumPlausibleScore(difficulty, durationSeconds) {
  const hits = Math.ceil(durationSeconds * LIMITS.maxHitsPerSecond);
  // A hit pays at most base × 1.5 (dead center) × 4 (streak multiplier) + the 500 bullseye bonus;
  // streak bonuses add 250, 500, 750 … at every 5th hit in a row.
  const milestones = Math.floor(hits / 5);
  return hits * (BASE_HIT_POINTS[difficulty] * 6 + 500) + 125 * milestones * (milestones + 1);
}

/** Checks one submission's fields. Returns a reason string, or null when it looks like a real round. */
function validationError(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return 'the body must be a JSON object';
  }
  if (typeof body.id !== 'string' || !RECORD_ID_PATTERN.test(body.id)) {
    return 'bad record id';
  }
  if (typeof body.userId !== 'string' || !USER_ID_PATTERN.test(body.userId)) {
    return 'bad user id';
  }
  if (typeof body.callsign !== 'string' || !CALLSIGN_PATTERN.test(body.callsign)) {
    return 'callsigns are 1 to 12 characters: A-Z, 0-9, space, dot, dash or underscore';
  }
  if (!Number.isInteger(body.difficulty) || body.difficulty < 0 || body.difficulty > 3) {
    return 'difficulty must be 0, 1, 2 or 3';
  }
  if (!Number.isInteger(body.durationSeconds) || body.durationSeconds < LIMITS.minDurationSeconds || body.durationSeconds > LIMITS.maxDurationSeconds) {
    return 'round length must be 10 to 150 seconds';
  }
  if (!Number.isSafeInteger(body.score) || body.score <= 0) {
    return 'only positive whole scores go on the board';
  }
  if (typeof body.accuracy !== 'string' || !ACCURACY_PATTERN.test(body.accuracy)) {
    return 'accuracy must be a percentage with two decimals, like "93.47"';
  }
  if (!Number.isInteger(body.maxStreak) || body.maxStreak < 1) {
    return 'a positive score needs at least one hit';
  }
  const accuracy = Number(body.accuracy);
  if (accuracy <= 0) {
    return 'a positive score needs at least one hit';
  }
  const maximumHits = Math.ceil(body.durationSeconds * LIMITS.maxHitsPerSecond);
  if (body.maxStreak > maximumHits) {
    return 'streak too long for the round';
  }
  if (body.score > maximumPlausibleScore(body.difficulty, body.durationSeconds)) {
    return 'score out of range for the round';
  }
  const finishedAt = typeof body.finishedAt === 'string' ? Date.parse(body.finishedAt) : NaN;
  if (!Number.isFinite(finishedAt) || finishedAt > Date.now() + LIMITS.futureToleranceMs) {
    return 'bad finish time';
  }
  return null;
}

/* ---------------------------------------------------------------------------
   HTTP plumbing
   --------------------------------------------------------------------------- */

const BASE_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff'
});

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, BASE_HEADERS));
  response.end(body);
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > LIMITS.maxBodyBytes) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(Object.assign(new Error('the body is not valid JSON'), { status: 400 }));
      }
    });
    request.on('error', reject);
  });
}

/** At most RATE_LIMIT_PER_MINUTE submissions a minute from one address. */
const recentSubmissions = new Map();
function isRateLimited(address) {
  const now = Date.now();
  const times = (recentSubmissions.get(address) || []).filter((time) => now - time < 60000);
  times.push(now);
  recentSubmissions.set(address, times);
  return times.length > SETTINGS.submissionsPerMinute;
}
setInterval(() => {
  const now = Date.now();
  for (const [address, times] of recentSubmissions) {
    if (times.every((time) => now - time >= 60000)) {
      recentSubmissions.delete(address);
    }
  }
}, 60000).unref();

function clientAddress(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (SETTINGS.trustProxy && typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

/* ---------------------------------------------------------------------------
   Routes
   --------------------------------------------------------------------------- */

function serveGame(response) {
  fs.readFile(SETTINGS.gameFile, (error, contents) => {
    if (error) {
      sendJson(response, 500, { reason: 'the game file is missing on the server' });
      return;
    }
    response.writeHead(200, Object.assign({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': contents.length,
      'Cache-Control': 'no-cache'
    }, BASE_HEADERS));
    response.end(contents);
  });
}

function handleLeaderboard(url, response) {
  const difficulty = Number(url.searchParams.get('difficulty'));
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 10);
  if (!Number.isInteger(difficulty) || difficulty < 0 || difficulty > 3) {
    sendJson(response, 400, { reason: 'difficulty must be 0, 1, 2 or 3' });
    return;
  }
  if (!Number.isInteger(offset) || offset < 0 || offset >= LIMITS.topSize || !Number.isInteger(limit) || limit < 1 || limit > LIMITS.maxPageSize) {
    sendJson(response, 400, { reason: 'offset must be 0 to 99 and limit 1 to 25' });
    return;
  }
  const pageLimit = Math.min(limit, LIMITS.topSize - offset);
  const rows = statements.page.all(difficulty, pageLimit, offset);
  const total = Math.min(LIMITS.topSize, Number(statements.countLevel.get(difficulty).total));
  sendJson(response, 200, {
    difficulty: difficulty,
    offset: offset,
    limit: pageLimit,
    total: total,
    entries: rows.map((row, index) => ({
      rank: offset + index + 1,
      id: row.id,
      callsign: row.callsign,
      score: Number(row.score),
      accuracy: Math.round(Number(row.accuracy) * 100) / 100,
      maxStreak: Number(row.max_streak),
      durationSeconds: Number(row.duration_seconds),
      finishedAt: row.finished_at
    }))
  });
}

async function handleSubmission(request, response) {
  const address = clientAddress(request);
  if (isRateLimited(address)) {
    sendJson(response, 429, { accepted: false, reason: 'too many scores at once; wait a minute' });
    return;
  }
  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, error.status || 400, { accepted: false, reason: error.message });
    return;
  }
  const problem = validationError(body);
  if (problem !== null) {
    sendJson(response, 400, { accepted: false, reason: problem });
    return;
  }
  // The anti-cheat step: rebuild the signature with this server's passphrase; a mismatch drops the score.
  if (!signatureMatches(body)) {
    console.warn('[hitscan] dropped a score with a bad signature from ' + address + ' (' + body.callsign + ', ' + body.score + ')');
    sendJson(response, 403, { accepted: false, reason: 'signature mismatch' });
    return;
  }

  const row = {
    id: body.id,
    user_id: body.userId,
    callsign: body.callsign,
    difficulty: body.difficulty,
    score: body.score,
    accuracy: Number(body.accuracy),
    max_streak: body.maxStreak,
    duration_seconds: body.durationSeconds,
    finished_at: new Date(Date.parse(body.finishedAt)).toISOString()
  };
  const existing = statements.findById.get(row.id);
  if (existing) {
    // A retry of a score already saved answers with its rank; a different run reusing the id is refused.
    const isSameRun = existing.user_id === row.user_id && Number(existing.score) === row.score && existing.difficulty === row.difficulty;
    if (!isSameRun) {
      sendJson(response, 409, { accepted: false, reason: 'that record id is taken' });
      return;
    }
    sendJson(response, 200, { accepted: true, id: existing.id, rank: rankOf(existing), total: Number(statements.countLevel.get(existing.difficulty).total) });
    return;
  }
  statements.insert.run(row.id, row.user_id, row.callsign, row.difficulty, row.score, row.accuracy, row.max_streak, row.duration_seconds, row.finished_at);
  const stored = statements.findById.get(row.id);
  const rank = rankOf(stored);
  const total = Number(statements.countLevel.get(row.difficulty).total);
  console.log('[hitscan] saved ' + row.callsign + ' ' + row.score + ' on level ' + row.difficulty + ' (rank ' + rank + ' of ' + total + ')');
  sendJson(response, 201, { accepted: true, id: row.id, rank: rank, total: total });
}

const server = http.createServer((request, response) => {
  let url;
  try {
    url = new URL(request.url, 'http://localhost');
  } catch (error) {
    sendJson(response, 400, { reason: 'bad address' });
    return;
  }
  const route = request.method + ' ' + url.pathname;
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, Object.assign({ 'Access-Control-Max-Age': '600' }, BASE_HEADERS));
      response.end();
    } else if (route === 'GET /' || route === 'GET /hitscan-3d.html') {
      serveGame(response);
    } else if (route === 'GET /api/config') {
      sendJson(response, 200, { passphrase: SETTINGS.passphrase, publicUrl: SETTINGS.publicUrl, topSize: LIMITS.topSize });
    } else if (route === 'GET /api/leaderboard') {
      handleLeaderboard(url, response);
    } else if (route === 'POST /api/scores') {
      handleSubmission(request, response).catch((error) => {
        console.error('[hitscan] submission failed', error);
        sendJson(response, 500, { accepted: false, reason: 'server error' });
      });
    } else if (route === 'GET /api/health') {
      sendJson(response, 200, { ok: true });
    } else {
      sendJson(response, 404, { reason: 'not found' });
    }
  } catch (error) {
    console.error('[hitscan] request failed', error);
    sendJson(response, 500, { reason: 'server error' });
  }
});

server.listen(SETTINGS.port, SETTINGS.host, () => {
  console.log('[hitscan] leaderboard server on http://localhost:' + SETTINGS.port + ' (database ' + SETTINGS.databaseFile + ')');
  if (SETTINGS.passphrase === DEFAULT_PASSPHRASE) {
    console.warn('[hitscan] using the default passphrase; set LEADERBOARD_PASSPHRASE to your own secret');
  }
});

function shutDown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
