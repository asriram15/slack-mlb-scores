import { fetchGamesForPolling, fetchLiveFeedWithRetry } from './mlb.js';
import { formatChangeAlert, isNonResultFinal } from './format.js';
import {
  detectChange,
  getLastPlayIndex,
  setLastPlayIndex,
  advanceLastPlayIndex,
  markPendingPlayDetails,
  clearPendingPlayDetails,
  getPendingPlayDetails,
  incrementPendingAttempts,
  markPendingIncompleteAtBat,
  clearPendingIncompleteAtBat,
  getPendingIncompleteAtBat,
  incrementPendingIncompleteAttempts,
  markPendingVideo,
  clearPendingVideo,
  listPendingVideos,
  hasPendingVideos,
  incrementPendingVideoAttempts,
} from './state.js';
import {
  buildPlayAlertContexts,
  findScoringPlaysInGap,
  isPlayComplete,
  maxAtBatIndex,
} from './plays.js';
import {
  fetchHighlightItems,
  findHighlightForPlayId,
  formatHighlightReply,
  pickPlaybackUrl,
} from './highlights.js';

const TZ = () => process.env.GAME_DAY_TZ ?? 'America/New_York';
const INTERVAL = () => Number(process.env.POLL_INTERVAL_MS ?? 120_000);
const IDLE_INTERVAL = () =>
  Number(process.env.POLL_IDLE_INTERVAL_MS ?? 600_000);

/**
 * True when any game is still scheduled or in progress.
 * @param {import('./format.js').GameSummary[]} games
 * @returns {boolean}
 */
export function hasUnfinishedGames(games) {
  return games.some(
    (g) => g.abstractState === 'Preview' || g.abstractState === 'Live',
  );
}

/**
 * @param {number} gamePk
 * @param {import('./format.js').GameSummary} game
 * @param {{
 *   scoreChanged: boolean,
 *   isFinalTransition: boolean,
 *   prevAwayScore?: number,
 *   prevHomeScore?: number,
 *   forceIncomplete?: boolean,
 * }} opts
 * @returns {Promise<{
 *   alerts: import('./plays.js').PlayAlertWithScore[],
 *   holdIncomplete: boolean,
 * }>}
 */
async function fetchPlayContextsForAlert(
  gamePk,
  game,
  {
    scoreChanged,
    isFinalTransition,
    prevAwayScore,
    prevHomeScore,
    forceIncomplete = false,
  },
) {
  const feed = await fetchLiveFeedWithRetry(gamePk);
  const allPlays = feed.liveData?.plays?.allPlays ?? [];
  const sinceIndex = getLastPlayIndex(gamePk);

  if (scoreChanged && !isFinalTransition && !forceIncomplete) {
    const plays = findScoringPlaysInGap(
      allPlays,
      sinceIndex,
      prevAwayScore ?? null,
      prevHomeScore ?? null,
      game.awayScore,
      game.homeScore,
    );
    if (plays.some((p) => !isPlayComplete(p))) {
      return { alerts: [], holdIncomplete: true };
    }
  }

  const alerts = buildPlayAlertContexts(allPlays, {
    scoreChanged,
    isFinalTransition,
    sinceIndex,
    game,
    prevAwayScore,
    prevHomeScore,
  });

  if (alerts.length) {
    const lastIdx = Math.max(...alerts.map((a) => a.atBatIndex));
    setLastPlayIndex(gamePk, lastIdx);
    advanceLastPlayIndex(gamePk, maxAtBatIndex(allPlays));
  }

  return { alerts, holdIncomplete: false };
}

/**
 * Post a held score alert once play-by-play catches up (or we give up).
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @param {import('./format.js').GameSummary} game
 */
async function tryResolvePendingPlayDetails(app, channelId, game) {
  const pending = getPendingPlayDetails(game.gamePk);
  if (!pending) return;

  // Score moved again — normal change detection will rebuild the gap.
  if (
    pending.awayScore !== game.awayScore ||
    pending.homeScore !== game.homeScore
  ) {
    clearPendingPlayDetails(game.gamePk);
    return;
  }

  const gaveUp = incrementPendingAttempts(game.gamePk);
  if (gaveUp) {
    console.log(
      `[poller] gave up play details for game ${game.gamePk}; posting score only`,
    );
    try {
      await postScoreAlerts(app, channelId, game, [], {
        scoreChanged: true,
        statusChanged: false,
        isFinalTransition: false,
      });
    } catch (err) {
      console.error('[poller] play-details give-up Slack post failed:', err.message);
    }
    return;
  }

  /** @type {{ alerts: import('./plays.js').PlayAlertWithScore[], holdIncomplete: boolean }} */
  let resolved;
  try {
    resolved = await fetchPlayContextsForAlert(game.gamePk, game, {
      scoreChanged: true,
      isFinalTransition: false,
      prevAwayScore: pending.prevAwayScore,
      prevHomeScore: pending.prevHomeScore,
    });
  } catch (err) {
    console.error(`[poller] pending retry ${game.gamePk}:`, err.message);
    return;
  }

  if (resolved.holdIncomplete) {
    clearPendingPlayDetails(game.gamePk);
    markPendingIncompleteAtBat(
      game.gamePk,
      game.awayScore,
      game.homeScore,
      pending.prevAwayScore,
      pending.prevHomeScore,
    );
    console.log(
      `[poller] holding ${game.awayAbbrev}@${game.homeAbbrev} ${game.awayScore}-${game.homeScore} until at-bat completes`,
    );
    return;
  }

  if (!resolved.alerts.length) return;

  clearPendingPlayDetails(game.gamePk);
  try {
    await postScoreAlerts(app, channelId, game, resolved.alerts, {
      scoreChanged: true,
      statusChanged: false,
      isFinalTransition: false,
    });
  } catch (err) {
    console.error('[poller] play-details Slack post failed:', err.message);
  }
}

/**
 * Post a held score alert once the open at-bat completes (or we give up).
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @param {import('./format.js').GameSummary} game
 */
async function tryResolvePendingIncompleteAtBat(app, channelId, game) {
  const pending = getPendingIncompleteAtBat(game.gamePk);
  if (!pending) return;

  // Score moved again — normal change detection will rebuild the gap.
  if (
    pending.awayScore !== game.awayScore ||
    pending.homeScore !== game.homeScore
  ) {
    clearPendingIncompleteAtBat(game.gamePk);
    return;
  }

  const gaveUp = incrementPendingIncompleteAttempts(game.gamePk);
  if (gaveUp) {
    console.log(
      `[poller] giving up incomplete at-bat hold for game ${game.gamePk}; posting anyway`,
    );
  }

  /** @type {{ alerts: import('./plays.js').PlayAlertWithScore[], holdIncomplete: boolean }} */
  let resolved;
  try {
    resolved = await fetchPlayContextsForAlert(game.gamePk, game, {
      scoreChanged: true,
      isFinalTransition: false,
      prevAwayScore: pending.prevAwayScore,
      prevHomeScore: pending.prevHomeScore,
      forceIncomplete: gaveUp,
    });
  } catch (err) {
    console.error(
      `[poller] incomplete at-bat retry ${game.gamePk}:`,
      err.message,
    );
    return;
  }

  if (resolved.holdIncomplete) return;

  clearPendingIncompleteAtBat(game.gamePk);
  if (!resolved.alerts.length) return;

  try {
    await postScoreAlerts(app, channelId, game, resolved.alerts, {
      scoreChanged: true,
      statusChanged: false,
      isFinalTransition: false,
    });
  } catch (err) {
    console.error('[poller] incomplete at-bat Slack post failed:', err.message);
  }
}

/**
 * @param {import('./format.js').GameSummary} game
 * @param {import('./plays.js').PlayAlertWithScore} alert
 * @param {{ isFinalTransition: boolean, isLast: boolean }} opts
 */
function gameSnapshotForAlert(game, alert, { isFinalTransition, isLast }) {
  return {
    ...game,
    awayScore: alert.awayScore,
    homeScore: alert.homeScore,
    inning: alert.inning ?? game.inning,
    inningHalf: alert.inningHalf ?? game.inningHalf,
    abstractState:
      isFinalTransition && isLast ? 'Final' : game.abstractState === 'Final' && !isLast
        ? 'Live'
        : game.abstractState,
  };
}

/**
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @param {import('./format.js').GameSummary} game
 * @param {import('./plays.js').PlayAlertWithScore[]} alerts
 * @param {{ scoreChanged: boolean, statusChanged: boolean, isFinalTransition: boolean }} meta
 */
async function postScoreAlerts(app, channelId, game, alerts, meta) {
  const { scoreChanged, statusChanged, isFinalTransition } = meta;

  if (alerts.length === 0) {
    const text = formatChangeAlert(game, {
      scoreChanged,
      statusChanged,
      isFinalTransition,
    });
    await app.client.chat.postMessage({
      channel: channelId,
      text,
      unfurl_links: false,
    });
    console.log('[poller] posted:', text.replace(/\n/g, ' | '));
    return;
  }

  for (let i = 0; i < alerts.length; i++) {
    const alert = alerts[i];
    const isLast = i === alerts.length - 1;
    const snapshot = gameSnapshotForAlert(game, alert, {
      isFinalTransition,
      isLast,
    });

    const text = formatChangeAlert(snapshot, {
      playContext: alert.text,
      playContextKind: alert.kind,
      scoreChanged: true,
      statusChanged: isLast ? statusChanged : false,
      isFinalTransition: isLast && isFinalTransition,
    });

    const result = await app.client.chat.postMessage({
      channel: channelId,
      text,
      unfurl_links: false,
    });
    console.log('[poller] posted:', text.replace(/\n/g, ' | '));

    if (alert.playId && result?.ts) {
      markPendingVideo(channelId, result.ts, game.gamePk, alert.playId);
      console.log(
        `[poller] highlight pending for ${game.awayAbbrev}@${game.homeAbbrev} play ${alert.playId}`,
      );
    }
  }
}

/**
 * When MLB publishes a clip for a scored play, reply in that alert's thread.
 * @param {import('@slack/bolt').App} app
 */
async function tryResolvePendingVideos(app) {
  const pending = listPendingVideos();
  if (pending.length === 0) return;

  /** @type {Map<number, import('./state.js').PendingVideo[]>} */
  const byGame = new Map();
  for (const entry of pending) {
    const list = byGame.get(entry.gamePk) ?? [];
    list.push(entry);
    byGame.set(entry.gamePk, list);
  }

  for (const [gamePk, entries] of byGame) {
    /** @type {import('./highlights.js').HighlightItem[]|null} */
    let items = null;
    try {
      items = await fetchHighlightItems(gamePk);
    } catch (err) {
      console.error(`[poller] highlight fetch ${gamePk}:`, err.message);
      for (const entry of entries) {
        if (
          incrementPendingVideoAttempts(entry.channelId, entry.threadTs)
        ) {
          console.log(
            `[poller] gave up highlight for play ${entry.playId} after max retries`,
          );
        }
      }
      continue;
    }

    for (const entry of entries) {
      const item = findHighlightForPlayId(items, entry.playId);
      const url = item ? pickPlaybackUrl(item.playbacks) : null;

      if (!url) {
        if (
          incrementPendingVideoAttempts(entry.channelId, entry.threadTs)
        ) {
          console.log(
            `[poller] gave up highlight for play ${entry.playId} after max retries`,
          );
        }
        continue;
      }

      const text = formatHighlightReply(url);
      try {
        await app.client.chat.postMessage({
          channel: entry.channelId,
          thread_ts: entry.threadTs,
          text,
          unfurl_links: true,
          unfurl_media: true,
        });
        clearPendingVideo(entry.channelId, entry.threadTs);
        console.log(
          '[poller] posted highlight reply:',
          text.replace(/\n/g, ' | '),
        );
      } catch (err) {
        console.error(
          `[poller] highlight Slack reply failed for ${entry.playId}:`,
          err.message,
        );
        if (
          incrementPendingVideoAttempts(entry.channelId, entry.threadTs)
        ) {
          console.log(
            `[poller] gave up highlight for play ${entry.playId} after max retries`,
          );
        }
      }
    }
  }
}

/**
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @param {import('./format.js').GameSummary[]} games
 */
async function processGames(app, channelId, games) {
  await tryResolvePendingVideos(app);

  for (const game of games) {
    if (game.abstractState === 'Live') {
      await tryResolvePendingIncompleteAtBat(app, channelId, game);
      await tryResolvePendingPlayDetails(app, channelId, game);
    }
  }

  for (const game of games) {
    if (game.abstractState === 'Preview') {
      detectChange(game);
      continue;
    }

    const change = detectChange(game);
    if (!change) continue;

    const isFinal = game.abstractState === 'Final';
    const nonResult = isNonResultFinal(game);
    const shouldPost =
      change.scoreChanged || (isFinal && change.statusChanged);
    if (!shouldPost) continue;

    // Postponed/cancelled are abstract Final but have no result or plays.
    const isFinalTransition = isFinal && change.statusChanged && !nonResult;

    /** @type {import('./plays.js').PlayAlertWithScore[]} */
    let alerts = [];
    if (!nonResult && (change.scoreChanged || isFinalTransition)) {
      try {
        const resolved = await fetchPlayContextsForAlert(game.gamePk, game, {
          scoreChanged: change.scoreChanged,
          isFinalTransition,
          prevAwayScore: change.prevAwayScore,
          prevHomeScore: change.prevHomeScore,
        });

        if (resolved.holdIncomplete) {
          markPendingIncompleteAtBat(
            game.gamePk,
            game.awayScore,
            game.homeScore,
            change.prevAwayScore,
            change.prevHomeScore,
          );
          console.log(
            `[poller] holding ${game.awayAbbrev}@${game.homeAbbrev} ${game.awayScore}-${game.homeScore} until at-bat completes`,
          );
          continue;
        }

        alerts = resolved.alerts;
        if (alerts.length) {
          clearPendingPlayDetails(game.gamePk);
          clearPendingIncompleteAtBat(game.gamePk);
        } else if (change.scoreChanged && !isFinalTransition) {
          markPendingPlayDetails(
            game.gamePk,
            game.awayScore,
            game.homeScore,
            change.prevAwayScore,
            change.prevHomeScore,
          );
          console.log(
            `[poller] holding ${game.awayAbbrev}@${game.homeAbbrev} ${game.awayScore}-${game.homeScore} until play details arrive`,
          );
          continue;
        }
      } catch (err) {
        console.error(
          `[poller] live feed ${game.gamePk}:`,
          err.message,
        );
        if (change.scoreChanged && !isFinalTransition) {
          markPendingPlayDetails(
            game.gamePk,
            game.awayScore,
            game.homeScore,
            change.prevAwayScore,
            change.prevHomeScore,
          );
          console.log(
            `[poller] holding ${game.awayAbbrev}@${game.homeAbbrev} ${game.awayScore}-${game.homeScore} until play details arrive`,
          );
          continue;
        }
      }
    }

    try {
      await postScoreAlerts(app, channelId, game, alerts, {
        scoreChanged: change.scoreChanged,
        statusChanged: change.statusChanged,
        isFinalTransition,
      });
    } catch (err) {
      console.error('[poller] Slack post failed:', err.message);
    }
  }
}

/**
 * Fetch schedule; process alerts when the slate is active (or was on the
 * previous tick, so a last-game Final transition still posts).
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @param {{ processIfIdle?: boolean }} [opts]
 * @returns {Promise<boolean>} true if any Preview/Live games remain
 */
export async function pollOnce(app, channelId, opts = {}) {
  const processIfIdle = opts.processIfIdle ?? true;

  let games;
  try {
    games = await fetchGamesForPolling(TZ());
  } catch (err) {
    console.error('[poller] MLB fetch failed:', err.message);
    return false;
  }

  const unfinished = hasUnfinishedGames(games);
  if (unfinished || processIfIdle) {
    await processGames(app, channelId, games);
  } else if (hasPendingVideos()) {
    // Keep draining highlight threads after the slate is idle.
    await tryResolvePendingVideos(app);
  }

  // Stay on the active poll interval while clips may still arrive.
  return unfinished || hasPendingVideos();
}

/**
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @returns {{ stop: () => void }}
 */
export function startPoller(app, channelId) {
  const activeMs = INTERVAL();
  const idleMs = IDLE_INTERVAL();
  console.log(
    `[poller] started (active every ${activeMs / 1000}s when Preview/Live, idle every ${idleMs / 1000}s)`,
  );

  /** @type {ReturnType<typeof setTimeout>|null} */
  let timer = null;
  /** Process even when idle on the first tick (seed fingerprints) and once after the slate finishes (Final alerts). */
  let processIfIdle = true;
  let stopped = false;

  const schedule = (ms) => {
    if (stopped) return;
    timer = setTimeout(run, ms);
  };

  const run = async () => {
    const unfinished = await pollOnce(app, channelId, { processIfIdle });
    processIfIdle = unfinished;
    schedule(unfinished ? INTERVAL() : IDLE_INTERVAL());
  };

  run();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
