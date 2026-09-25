import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildDailyScheduleBlocks } from './format.js';
import { fetchGamesForDate, todayInTimezone } from './mlb.js';

const DEFAULT_POST_TIME = '09:00';
const DEFAULT_CHECK_INTERVAL_MS = 60_000;

/**
 * @param {string} time
 * @returns {{ hour: number, minute: number }}
 */
export function parsePostTime(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) {
    throw new Error(`DAILY_SCHEDULE_TIME must be HH:MM (received "${time}")`);
  }
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * @param {Date} now
 * @param {string} timeZone
 * @returns {{ hour: number, minute: number }}
 */
export function timeInTimezone(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { hour: value('hour'), minute: value('minute') };
}

/**
 * @param {{
 *   now: Date,
 *   timeZone: string,
 *   postTime: string,
 *   lastPostedDate: string|null,
 * }} opts
 * @returns {boolean}
 */
export function shouldPostDailySchedule(opts) {
  const today = todayInTimezone(opts.timeZone, opts.now);
  if (opts.lastPostedDate === today) return false;

  const current = timeInTimezone(opts.now, opts.timeZone);
  const target = parsePostTime(opts.postTime);
  return (
    current.hour > target.hour ||
    (current.hour === target.hour && current.minute >= target.minute)
  );
}

async function readLastPostedDate(stateFile) {
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    return typeof state.lastPostedDate === 'string'
      ? state.lastPostedDate
      : null;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[daily-schedule] state read failed:', err.message);
    }
    return null;
  }
}

async function saveLastPostedDate(stateFile, date) {
  await writeFile(
    stateFile,
    `${JSON.stringify({ lastPostedDate: date }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Post today's slate once the configured morning time has passed.
 * Dates with no games are recorded but do not generate an offseason message.
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @param {{ now?: Date, timeZone?: string, postTime?: string, stateFile?: string }} [opts]
 * @returns {Promise<boolean>} whether a Slack message was posted
 */
export async function postDailyScheduleIfDue(app, channelId, opts = {}) {
  const now = opts.now ?? new Date();
  const timeZone =
    opts.timeZone ?? process.env.GAME_DAY_TZ ?? 'America/New_York';
  const postTime =
    opts.postTime ?? process.env.DAILY_SCHEDULE_TIME ?? DEFAULT_POST_TIME;
  const stateFile = resolve(
    opts.stateFile ??
      process.env.DAILY_SCHEDULE_STATE_FILE ??
      '.daily-schedule-state.json',
  );
  const lastPostedDate = await readLastPostedDate(stateFile);

  if (
    !shouldPostDailySchedule({
      now,
      timeZone,
      postTime,
      lastPostedDate,
    })
  ) {
    return false;
  }

  const date = todayInTimezone(timeZone, now);
  const games = await fetchGamesForDate(date);
  games.sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  if (games.length === 0) {
    await saveLastPostedDate(stateFile, date);
    console.log(`[daily-schedule] no games scheduled for ${date}`);
    return false;
  }

  await app.client.chat.postMessage({
    channel: channelId,
    text: `Today's MLB schedule — ${date}`,
    blocks: buildDailyScheduleBlocks(games, date),
    unfurl_links: false,
  });
  await saveLastPostedDate(stateFile, date);
  console.log(`[daily-schedule] posted ${games.length} games for ${date}`);
  return true;
}

/**
 * @param {import('@slack/bolt').App} app
 * @param {string} channelId
 * @returns {{ stop: () => void }}
 */
export function startDailySchedule(app, channelId) {
  if ((process.env.DAILY_SCHEDULE_ENABLED ?? 'true').toLowerCase() === 'false') {
    console.log('[daily-schedule] disabled');
    return { stop() {} };
  }

  const postTime = process.env.DAILY_SCHEDULE_TIME ?? DEFAULT_POST_TIME;
  parsePostTime(postTime);
  const intervalMs = Number(
    process.env.DAILY_SCHEDULE_CHECK_INTERVAL_MS ??
      DEFAULT_CHECK_INTERVAL_MS,
  );
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      await postDailyScheduleIfDue(app, channelId, { postTime });
    } catch (err) {
      console.error('[daily-schedule] run failed:', err.message);
    } finally {
      running = false;
    }
  };

  console.log(
    `[daily-schedule] started (daily at ${postTime} ${process.env.GAME_DAY_TZ ?? 'America/New_York'})`,
  );
  void run();
  const timer = setInterval(run, intervalMs);
  return { stop: () => clearInterval(timer) };
}
