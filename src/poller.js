import { fetchGamesForPolling, fetchLiveFeedWithRetry } from './mlb.js';
import { formatChangeAlert, formatPlayFollowUp } from './format.js';
import {
  detectChange,
  getLastPlayIndex,
  setLastPlayIndex,
  advanceLastPlayIndex,
  markPendingPlayDetails,
  clearPendingPlayDetails,
  getPendingPlayDetails,
  incrementPendingAttempts,
} from './state.js';
import { buildPlayAlertContext, maxAtBatIndex } from './plays.js';
import { isWithinPollWindow, describePollWindow } from './poll-window.js';

const TZ = () => process.env.GAME_DAY_TZ ?? 'America/New_York';
const INTERVAL = () =>
  Number(process.env.POLL_INTERVAL_MS ?? 120_000);

/**
 * @param {number} gamePk
 * @param {import('./format.js').GameSummary} game
 * @param {{ scoreChanged: boolean, isFinalTransition: boolean }} opts
 * @returns {Promise<import('./plays.js').PlayAlertContext|null>}
 */
async function fetchPlayContextForAlert(
  gamePk,
  game,
  { scoreChanged, isFinalTransition },
) {
  const feed = await fetchLiveFeedWithRetry(gamePk);
  const allPlays = feed.liveData?.plays?.allPlays ?? [];
  const sinceIndex = getLastPlayIndex(gamePk);

  const alert = buildPlayAlertContext(allPlays, {
    scoreChanged,
    isFinalTransition,
    sinceIndex,
    game,
  });

  if (alert) {
    setLastPlayIndex(gamePk, alert.atBatIndex);
    advanceLastPlayIndex(gamePk, maxAtBatIndex(allPlays));
    return alert;
  }

  return null;
}

/**
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @param {import('./format.js').GameSummary} game
 */
async function tryResolvePendingPlayDetails(app, channelId, game) {
  const pending = getPendingPlayDetails(game.gamePk);
  if (!pending) return;

  if (
    pending.awayScore !== game.awayScore ||
    pending.homeScore !== game.homeScore
  ) {
    clearPendingPlayDetails(game.gamePk);
    return;
  }

  if (incrementPendingAttempts(game.gamePk)) {
    console.log(
      `[poller] gave up play details for game ${game.gamePk} after max retries`,
    );
    return;
  }

  let alert;
  try {
    alert = await fetchPlayContextForAlert(game.gamePk, game, {
      scoreChanged: true,
      isFinalTransition: false,
    });
  } catch (err) {
    console.error(`[poller] pending retry ${game.gamePk}:`, err.message);
    return;
  }

  if (!alert) return;

  clearPendingPlayDetails(game.gamePk);
  const text = formatPlayFollowUp(game, alert.text);

  try {
    await app.client.chat.postMessage({
      channel: channelId,
      text,
      unfurl_links: false,
    });
    console.log('[poller] posted play follow-up:', text.replace(/\n/g, ' | '));
  } catch (err) {
    console.error('[poller] Slack follow-up failed:', err.message);
  }
}

/**
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 */
export async function pollOnce(app, channelId) {
  if (!isWithinPollWindow()) {
    return;
  }

  let games;
  try {
    games = await fetchGamesForPolling(TZ());
  } catch (err) {
    console.error('[poller] MLB fetch failed:', err.message);
    return;
  }

  for (const game of games) {
    if (game.abstractState === 'Live') {
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
    const shouldPost =
      change.scoreChanged || (isFinal && change.statusChanged);
    if (!shouldPost) continue;

    const isFinalTransition = isFinal && change.statusChanged;

    let playContext = null;
    let playContextKind = undefined;
    if (change.scoreChanged || isFinalTransition) {
      try {
        const alert = await fetchPlayContextForAlert(game.gamePk, game, {
          scoreChanged: change.scoreChanged,
          isFinalTransition,
        });
        if (alert) {
          playContext = alert.text;
          playContextKind = alert.kind;
          clearPendingPlayDetails(game.gamePk);
        } else if (change.scoreChanged && !isFinalTransition) {
          markPendingPlayDetails(
            game.gamePk,
            game.awayScore,
            game.homeScore,
          );
          console.log(
            `[poller] play details pending for ${game.awayAbbrev} @ ${game.homeAbbrev} ${game.awayScore}-${game.homeScore}`,
          );
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
          );
        }
      }
    }

    const text = formatChangeAlert(change.game, {
      playContext: playContext ?? undefined,
      playContextKind,
      scoreChanged: change.scoreChanged,
      statusChanged: change.statusChanged,
      isFinalTransition,
    });

    try {
      await app.client.chat.postMessage({
        channel: channelId,
        text,
        unfurl_links: false,
      });
      console.log('[poller] posted:', text.replace(/\n/g, ' | '));
    } catch (err) {
      console.error('[poller] Slack post failed:', err.message);
    }
  }
}

/**
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @returns {NodeJS.Timeout}
 */
export function startPoller(app, channelId) {
  const ms = INTERVAL();
  console.log(`[poller] started (every ${ms / 1000}s, window ${describePollWindow()})`);

  pollOnce(app, channelId);
  return setInterval(() => pollOnce(app, channelId), ms);
}
