const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const MLB_LIVE_BASE = 'https://statsapi.mlb.com/api/v1.1';

/**
 * @param {string} timeZone - IANA timezone, e.g. America/New_York
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD in the given timezone
 */
export function todayInTimezone(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * @param {string} dateStr - YYYY-MM-DD
 * @param {number} deltaDays
 * @returns {string}
 */
export function shiftDateString(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return t.toISOString().slice(0, 10);
}

/**
 * @param {string} timeZone
 * @param {Date} [now]
 * @returns {string}
 */
export function yesterdayInTimezone(timeZone, now = new Date()) {
  return shiftDateString(todayInTimezone(timeZone, now), -1);
}

/**
 * Hour 0–23 in the given IANA timezone.
 * @param {string} timeZone
 * @param {Date} [now]
 * @returns {number}
 */
export function hourInTimezone(timeZone, now = new Date()) {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hour12: false,
    }).format(now),
  );
}

/**
 * @param {import('./format.js').GameSummary[]} lists
 * @returns {import('./format.js').GameSummary[]}
 */
export function mergeGamesByPk(...lists) {
  const byPk = new Map();
  for (const list of lists) {
    for (const game of list) {
      byPk.set(game.gamePk, game);
    }
  }
  return [...byPk.values()];
}

/**
 * @param {object} game - Raw game from schedule API
 * @returns {import('./format.js').GameSummary}
 */
export function normalizeGame(game) {
  const away = game.teams?.away ?? {};
  const home = game.teams?.home ?? {};
  const linescore = game.linescore ?? {};
  const status = game.status ?? {};

  return {
    gamePk: game.gamePk,
    awayId: away.team?.id ?? null,
    homeId: home.team?.id ?? null,
    awayName: away.team?.name ?? away.team?.teamName ?? 'Away',
    homeName: home.team?.name ?? home.team?.teamName ?? 'Home',
    awayAbbrev: away.team?.abbreviation ?? away.team?.teamCode ?? '',
    homeAbbrev: home.team?.abbreviation ?? home.team?.teamCode ?? '',
    awayScore: away.score ?? 0,
    homeScore: home.score ?? 0,
    inning: linescore.currentInning ?? null,
    inningHalf: linescore.inningHalf ?? null,
    outs: linescore.outs ?? null,
    abstractState: status.abstractGameState ?? 'Unknown',
    detailedState: status.detailedState ?? status.abstractGameState ?? 'Unknown',
    startTime: game.gameDate ?? null,
  };
}

/**
 * @param {string} date - YYYY-MM-DD
 * @param {number} [teamId] - MLB team id; schedule returns that team's games only
 * @returns {Promise<import('./format.js').GameSummary[]>}
 */
export async function fetchGamesForDate(date, teamId) {
  const url = new URL(`${MLB_BASE}/schedule`);
  url.searchParams.set('sportId', '1');
  url.searchParams.set('date', date);
  url.searchParams.set('hydrate', 'linescore,team');
  if (teamId != null) {
    url.searchParams.set('teamId', String(teamId));
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const games = data.dates?.[0]?.games ?? [];
  return games.map(normalizeGame);
}

/**
 * @param {string} timeZone
 * @param {number} [teamId]
 * @returns {Promise<import('./format.js').GameSummary[]>}
 */
export async function fetchTodaysGames(timeZone = 'America/New_York', teamId) {
  const date = todayInTimezone(timeZone);
  return fetchGamesForDate(date, teamId);
}

/**
 * Games to poll for channel alerts. Always merges today's and yesterday's
 * schedules so west-coast games still in progress after midnight are tracked.
 * @param {string} [timeZone]
 * @param {number} [teamId]
 * @param {Date} [now]
 * @returns {Promise<import('./format.js').GameSummary[]>}
 */
export async function fetchGamesForPolling(
  timeZone = 'America/New_York',
  teamId,
  now = new Date(),
) {
  const today = todayInTimezone(timeZone, now);
  const yesterday = yesterdayInTimezone(timeZone, now);
  const [todayGames, yesterdayGames] = await Promise.all([
    fetchGamesForDate(today, teamId),
    fetchGamesForDate(yesterday, teamId),
  ]);
  return mergeGamesByPk(yesterdayGames, todayGames);
}

/**
 * @param {number} gamePk
 * @returns {Promise<object>}
 */
export async function fetchLiveFeed(gamePk) {
  const url = `${MLB_LIVE_BASE}/game/${gamePk}/feed/live`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MLB live feed error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The schedule/linescore often updates before play-by-play; retry briefly.
 * @param {number} gamePk
 * @param {{ attempts?: number, delayMs?: number }} [opts]
 */
export async function fetchLiveFeedWithRetry(gamePk, opts = {}) {
  const attempts = opts.attempts ?? Number(process.env.LIVE_FEED_RETRIES ?? 4);
  const delayMs = opts.delayMs ?? Number(process.env.LIVE_FEED_RETRY_MS ?? 800);
  let lastError;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchLiveFeed(gamePk);
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * @param {import('./format.js').GameSummary[]} games
 * @returns {{ live: GameSummary[], preview: GameSummary[], final: GameSummary[] }}
 */
export function groupGames(games) {
  const live = [];
  const preview = [];
  const final = [];

  for (const g of games) {
    if (g.abstractState === 'Live') live.push(g);
    else if (g.abstractState === 'Preview') preview.push(g);
    else if (g.abstractState === 'Final') final.push(g);
  }

  const byStart = (a, b) =>
    (a.startTime ?? '').localeCompare(b.startTime ?? '');

  preview.sort(byStart);
  final.sort(byStart);

  return { live, preview, final };
}

/** CLI: npm run test:mlb */
import { fileURLToPath } from 'node:url';

const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isCli) {
  const tz = process.env.GAME_DAY_TZ ?? 'America/New_York';
  const { parseTeamArg } = await import('./teams.js');
  const { teamId, error } = parseTeamArg(process.argv[2]);
  if (error) {
    console.error(error);
    process.exit(1);
  }

  try {
    const games = await fetchTodaysGames(tz, teamId ?? undefined);
    const { live, preview, final } = groupGames(games);

    const { getTeamAbbrev } = await import('./teams.js');
    const abbrev = teamId ? getTeamAbbrev(teamId) : null;
    const teamLabel = abbrev ? ` (${abbrev})` : '';
    console.log(`MLB games for ${todayInTimezone(tz)} (${tz})${teamLabel}\n`);

    if (games.length === 0) {
      console.log(
        teamId
          ? 'No games scheduled today for that team.'
          : 'No games scheduled today.',
      );
      process.exit(0);
    }

    const print = (label, list) => {
      if (list.length === 0) return;
      console.log(`--- ${label} (${list.length}) ---`);
      for (const g of list) {
        const line = formatGameLine(g);
        console.log(line);
      }
      console.log();
    };

    print('Live', live);
    print('Scheduled', preview);
    print('Final', final);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

function formatGameLine(g) {
  const away = g.awayAbbrev || g.awayName;
  const home = g.homeAbbrev || g.homeName;
  if (g.abstractState === 'Preview') {
    const time = g.startTime
      ? new Date(g.startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: process.env.GAME_DAY_TZ ?? 'America/New_York',
        })
      : 'TBD';
    return `${away} @ ${home} · ${time}`;
  }
  const score = `${away} ${g.awayScore} – ${home} ${g.homeScore}`;
  if (g.abstractState === 'Live') {
    const inning = formatInning(g);
    return `${score} · ${inning} · ${g.detailedState}`;
  }
  return `${score} · Final`;
}

function formatInning(g) {
  if (!g.inning) return g.detailedState;
  const half = g.inningHalf === 'Top' ? 'Top' : g.inningHalf === 'Bottom' ? 'Bot' : '';
  const ord = ordinal(g.inning);
  const outs = g.outs != null ? `, ${g.outs} out${g.outs === 1 ? '' : 's'}` : '';
  return half ? `${half} ${ord}${outs}` : `${ord}${outs}`;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
