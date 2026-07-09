import { gameFingerprint } from './format.js';

/**
 * @typedef {object} GameStateEntry
 * @property {string} fp
 * @property {number} lastPlayIndex
 */

/** @type {Map<number, GameStateEntry>} */
const gameState = new Map();

/** @type {Map<number, { awayScore: number, homeScore: number, attempts: number }>} */
const pendingPlayDetails = new Map();

const MAX_PENDING_ATTEMPTS = () =>
  Number(process.env.PLAY_DETAIL_MAX_RETRIES ?? 8);

/**
 * @param {string} fp
 */
function parseFingerprint(fp) {
  const [awayScore, homeScore, inning, inningHalf, abstractState, detailedState] =
    fp.split('|');
  return {
    awayScore: Number(awayScore),
    homeScore: Number(homeScore),
    inning: inning === '' ? null : Number(inning),
    inningHalf: inningHalf || null,
    abstractState,
    detailedState,
  };
}

/**
 * @typedef {object} GameChange
 * @property {import('./format.js').GameSummary} game
 * @property {boolean} scoreChanged
 * @property {boolean} statusChanged
 */

/**
 * Record initial state without posting. Returns null if first sighting.
 * @param {import('./format.js').GameSummary} game
 * @returns {GameChange|null}
 */
export function detectChange(game) {
  const fp = gameFingerprint(game);
  const entry = gameState.get(game.gamePk);

  if (entry === undefined) {
    gameState.set(game.gamePk, { fp, lastPlayIndex: -1 });
    return null;
  }

  if (entry.fp === fp) {
    return null;
  }

  const prev = parseFingerprint(entry.fp);
  gameState.set(game.gamePk, { fp, lastPlayIndex: entry.lastPlayIndex });

  return {
    game,
    scoreChanged:
      prev.awayScore !== game.awayScore || prev.homeScore !== game.homeScore,
    statusChanged: prev.abstractState !== game.abstractState,
  };
}

/**
 * @param {number} gamePk
 * @returns {number}
 */
export function getLastPlayIndex(gamePk) {
  return gameState.get(gamePk)?.lastPlayIndex ?? -1;
}

/**
 * @param {number} gamePk
 * @param {number} atBatIndex
 */
export function setLastPlayIndex(gamePk, atBatIndex) {
  const entry = gameState.get(gamePk);
  if (entry) {
    entry.lastPlayIndex = atBatIndex;
  }
}

/**
 * @param {number} gamePk
 * @param {number} atBatIndex
 */
export function advanceLastPlayIndex(gamePk, atBatIndex) {
  const entry = gameState.get(gamePk);
  if (entry && atBatIndex > entry.lastPlayIndex) {
    entry.lastPlayIndex = atBatIndex;
  }
}

/**
 * Reset all tracked state (mainly for tests).
 */
export function resetState() {
  gameState.clear();
  pendingPlayDetails.clear();
}

/**
 * @param {number} gamePk
 * @param {number} awayScore
 * @param {number} homeScore
 */
export function markPendingPlayDetails(gamePk, awayScore, homeScore) {
  pendingPlayDetails.set(gamePk, { awayScore, homeScore, attempts: 0 });
}

/**
 * @param {number} gamePk
 */
export function clearPendingPlayDetails(gamePk) {
  pendingPlayDetails.delete(gamePk);
}

/**
 * @param {number} gamePk
 * @returns {{ awayScore: number, homeScore: number, attempts: number }|null}
 */
export function getPendingPlayDetails(gamePk) {
  return pendingPlayDetails.get(gamePk) ?? null;
}

/**
 * @param {number} gamePk
 * @returns {boolean} true if exceeded max retries and was cleared
 */
export function incrementPendingAttempts(gamePk) {
  const pending = pendingPlayDetails.get(gamePk);
  if (!pending) return false;
  pending.attempts += 1;
  if (pending.attempts >= MAX_PENDING_ATTEMPTS()) {
    pendingPlayDetails.delete(gamePk);
    return true;
  }
  return false;
}
