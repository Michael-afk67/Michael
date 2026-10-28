-- HITSCAN global leaderboard.
-- Written for SQLite (server.js runs it on start), using column types that
-- read the same way in MySQL or PostgreSQL if the board ever moves there.

CREATE TABLE IF NOT EXISTS Leaderboard (
  id               VARCHAR(48)  PRIMARY KEY,   -- unique record id, e.g. RUN-mh2k1x9a-4f0qz
  user_id          VARCHAR(40)  NOT NULL,      -- the player's account id, e.g. USR-k3j9x0q2m7b1c4d8
  callsign         VARCHAR(12)  NOT NULL,      -- shown on the board, at most 12 characters
  difficulty       TINYINT      NOT NULL,      -- 0 Easy, 1 Medium, 2 Hard, 3 Demon
  score            INTEGER      NOT NULL,      -- raw score of the round
  accuracy         DECIMAL(5,2) NOT NULL,      -- hit percentage with two decimals, e.g. 93.47
  max_streak       INTEGER      NOT NULL,      -- longest run of hits in a row
  duration_seconds SMALLINT     NOT NULL,      -- total round length in seconds (10 to 150)
  finished_at      TIMESTAMP    NOT NULL,      -- when the round ended, UTC ISO 8601
  CHECK (length(callsign) BETWEEN 1 AND 12),
  CHECK (difficulty BETWEEN 0 AND 3),
  CHECK (score > 0),
  CHECK (accuracy BETWEEN 0 AND 100),
  CHECK (max_streak >= 0),
  CHECK (duration_seconds BETWEEN 10 AND 150)
);

-- Ranking order: score, then accuracy, then the earlier run.
CREATE INDEX IF NOT EXISTS leaderboard_ranking
  ON Leaderboard (difficulty, score DESC, accuracy DESC, finished_at, id);
