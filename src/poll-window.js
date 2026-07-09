import { hourInTimezone } from './mlb.js';

const TZ = () => process.env.GAME_DAY_TZ ?? 'America/New_York';
const START_HOUR = () => Number(process.env.POLL_START_HOUR ?? 11);
const END_HOUR = () => Number(process.env.POLL_END_HOUR ?? 2);

/**
 * Whether current time is inside the MLB polling window (ET by default).
 *
 * Window is [POLL_START_HOUR, POLL_END_HOUR) in GAME_DAY_TZ.
 * If end <= start, the window crosses midnight (e.g. 11 → 2 means 11:00–01:59).
 *
 * POLL_END_HOUR=0 means stop at midnight (no 12:00–00:59 leg). Use 2 or 3 for
 * after-midnight coverage. POLL_END_HOUR=24 is treated as end of day.
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isWithinPollWindow(now = new Date()) {
  const tz = TZ();
  const hour = hourInTimezone(tz, now);
  let start = START_HOUR();
  let end = END_HOUR();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return true;
  }

  if (end === 24) end = 0;

  if (start <= end) {
    if (end === 0) {
      return hour >= start;
    }
    return hour >= start && hour < end;
  }

  // Crosses midnight, e.g. 11 → 2 covers 11:00–01:59
  if (end === 0) {
    return hour >= start;
  }
  return hour >= start || hour < end;
}

/**
 * @returns {string}
 */
export function describePollWindow() {
  const start = START_HOUR();
  const end = END_HOUR();
  const endNote =
    end === 0
      ? '(stops at midnight; use POLL_END_HOUR=2 or 3 for after-midnight)'
      : start > end
        ? `(includes after-midnight until ${end}:00)`
        : '';
  return `${start}:00–${end}:00 ${TZ()} ${endNote}`.trim();
}
