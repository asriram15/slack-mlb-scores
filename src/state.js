import { gameFingerprint } from './format.js';

/**
 * @typedef {object} GameStateEntry
 * @property {string} fp
 * @property {number} lastPlayIndex
 */

/** @type {Map<number, GameStateEntry>} */
const gameState = new Map();

/**
 * Score changed but live play-by-play was not ready yet.
 * @typedef {object} PendingPlayDetails
 * @property {number} awayScore
 * @property {number} homeScore
 * @property {number} prevAwayScore
 * @property {number} prevHomeScore
 * @property {number} attempts
 */

/** @type {Map<number, PendingPlayDetails>} */
const pendingPlayDetails = new Map();

/**
 * Score changed on an at-bat that is still open (WP during PA, etc.).
 * @typedef {object} PendingIncompleteAtBat
 * @property {number} awayScore
 * @property {number} homeScore
 * @property {number} prevAwayScore
 * @property {number} prevHomeScore
 * @property {number} attempts
 */

/** @type {Map<number, PendingIncompleteAtBat>} */
const pendingIncompleteAtBats = new Map();

/**
 * Score-alert parents waiting for an MLB highlight clip.
 * Keyed by `${channelId}:${threadTs}`.
 * @typedef {object} PendingVideo
 * @property {string} channelId
 * @property {string} threadTs
 * @property {number} gamePk
 * @property {string} playId
 * @property {number} attempts
 */

/** @type {Map<string, PendingVideo>} */
const pendingVideos = new Map();

const MAX_PENDING_ATTEMPTS = () =>
  Number(process.env.PLAY_DETAIL_MAX_RETRIES ?? 8);

/** Highlight clips often lag the live feed by several minutes. */
const MAX_VIDEO_ATTEMPTS = () =>
  Number(process.env.VIDEO_HIGHLIGHT_MAX_RETRIES ?? 20);

/**
 * @param {string} channelId
 * @param {string} threadTs
 * @returns {string}
 */
function videoKey(channelId, threadTs) {
  return `${channelId}:${threadTs}`;
}

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
 * @property {number} prevAwayScore
 * @property {number} prevHomeScore
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
    prevAwayScore: prev.awayScore,
    prevHomeScore: prev.homeScore,
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
  pendingIncompleteAtBats.clear();
  pendingVideos.clear();
}

/**
 * @param {number} gamePk
 * @param {number} awayScore
 * @param {number} homeScore
 * @param {number} prevAwayScore
 * @param {number} prevHomeScore
 */
export function markPendingIncompleteAtBat(
  gamePk,
  awayScore,
  homeScore,
  prevAwayScore,
  prevHomeScore,
) {
  pendingIncompleteAtBats.set(gamePk, {
    awayScore,
    homeScore,
    prevAwayScore,
    prevHomeScore,
    attempts: 0,
  });
}

/**
 * @param {number} gamePk
 */
export function clearPendingIncompleteAtBat(gamePk) {
  pendingIncompleteAtBats.delete(gamePk);
}

/**
 * @param {number} gamePk
 * @returns {PendingIncompleteAtBat|null}
 */
export function getPendingIncompleteAtBat(gamePk) {
  return pendingIncompleteAtBats.get(gamePk) ?? null;
}

/**
 * @param {number} gamePk
 * @returns {boolean} true if exceeded max retries and was cleared
 */
export function incrementPendingIncompleteAttempts(gamePk) {
  const pending = pendingIncompleteAtBats.get(gamePk);
  if (!pending) return false;
  pending.attempts += 1;
  if (pending.attempts >= MAX_PENDING_ATTEMPTS()) {
    pendingIncompleteAtBats.delete(gamePk);
    return true;
  }
  return false;
}

/**
 * @param {string} channelId
 * @param {string} threadTs
 * @param {number} gamePk
 * @param {string} playId
 */
export function markPendingVideo(channelId, threadTs, gamePk, playId) {
  if (!channelId || !threadTs || !playId) return;
  pendingVideos.set(videoKey(channelId, threadTs), {
    channelId,
    threadTs,
    gamePk,
    playId,
    attempts: 0,
  });
}

/**
 * @param {string} channelId
 * @param {string} threadTs
 */
export function clearPendingVideo(channelId, threadTs) {
  pendingVideos.delete(videoKey(channelId, threadTs));
}

/**
 * @returns {PendingVideo[]}
 */
export function listPendingVideos() {
  return [...pendingVideos.values()];
}

/**
 * @returns {boolean}
 */
export function hasPendingVideos() {
  return pendingVideos.size > 0;
}

/**
 * @param {string} channelId
 * @param {string} threadTs
 * @returns {boolean} true if exceeded max retries and was cleared
 */
export function incrementPendingVideoAttempts(channelId, threadTs) {
  const key = videoKey(channelId, threadTs);
  const pending = pendingVideos.get(key);
  if (!pending) return false;
  pending.attempts += 1;
  if (pending.attempts >= MAX_VIDEO_ATTEMPTS()) {
    pendingVideos.delete(key);
    return true;
  }
  return false;
}

/**
 * @param {number} gamePk
 * @param {number} awayScore
 * @param {number} homeScore
 * @param {number} prevAwayScore
 * @param {number} prevHomeScore
 */
export function markPendingPlayDetails(
  gamePk,
  awayScore,
  homeScore,
  prevAwayScore,
  prevHomeScore,
) {
  pendingPlayDetails.set(gamePk, {
    awayScore,
    homeScore,
    prevAwayScore,
    prevHomeScore,
    attempts: 0,
  });
}

/**
 * @param {number} gamePk
 */
export function clearPendingPlayDetails(gamePk) {
  pendingPlayDetails.delete(gamePk);
}

/**
 * @param {number} gamePk
 * @returns {PendingPlayDetails|null}
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
