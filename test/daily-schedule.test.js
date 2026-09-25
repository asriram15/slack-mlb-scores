import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePostTime,
  shouldPostDailySchedule,
} from '../src/daily-schedule.js';
import {
  buildDailyScheduleBlocks,
  formatDailyScheduleGame,
  formatSeriesRecord,
} from '../src/format.js';
import { normalizeGame } from '../src/mlb.js';

test('daily schedule becomes due at the configured timezone time only once', () => {
  const common = {
    timeZone: 'America/New_York',
    postTime: '09:00',
    lastPostedDate: null,
  };
  assert.equal(
    shouldPostDailySchedule({
      ...common,
      now: new Date('2025-10-27T12:59:00Z'),
    }),
    false,
  );
  assert.equal(
    shouldPostDailySchedule({
      ...common,
      now: new Date('2025-10-27T13:00:00Z'),
    }),
    true,
  );
  assert.equal(
    shouldPostDailySchedule({
      ...common,
      now: new Date('2025-10-27T15:00:00Z'),
      lastPostedDate: '2025-10-27',
    }),
    false,
  );
});

test('post time validation rejects ambiguous values', () => {
  assert.deepEqual(parsePostTime('09:30'), { hour: 9, minute: 30 });
  assert.throws(() => parsePostTime('9:30'), /must be HH:MM/);
  assert.throws(() => parsePostTime('24:00'), /must be HH:MM/);
});

test('2015 ALDS Game 5 includes probable pitchers and pregame series record', () => {
  process.env.GAME_DAY_TZ = 'America/New_York';
  const game = normalizeGame({
    gamePk: 446255,
    gameType: 'D',
    gameDate: '2015-10-14T20:00:00Z',
    seriesDescription: 'AL Division Series',
    seriesGameNumber: 5,
    gamesInSeries: 5,
    teams: {
      away: {
        team: { id: 140, name: 'Texas Rangers', abbreviation: 'TEX' },
        probablePitcher: { fullName: 'Cole Hamels' },
        leagueRecord: { wins: 2, losses: 2 },
      },
      home: {
        team: { id: 141, name: 'Toronto Blue Jays', abbreviation: 'TOR' },
        probablePitcher: { fullName: 'Marcus Stroman' },
        leagueRecord: { wins: 2, losses: 2 },
      },
    },
    status: {
      abstractGameState: 'Preview',
      detailedState: 'Scheduled',
    },
  });

  assert.equal(formatSeriesRecord(game), 'Series tied 2–2');
  const text = formatDailyScheduleGame(game);
  assert.match(text, /\*TEX\* @ \*TOR\* · 4:00 PM EDT/);
  assert.match(text, /Cole Hamels vs\. Marcus Stroman/);
  assert.match(text, /AL Division Series · Game 5 · Series tied 2–2/);

  const blocks = buildDailyScheduleBlocks([game], '2015-10-14');
  assert.equal(blocks.length, 2);
  assert.equal(
    blocks[0].text.text,
    "Today's MLB Schedule — Wednesday, October 14",
  );
});

test('regular season records are not presented as series records', () => {
  const game = {
    gameType: 'R',
    awayAbbrev: 'NYY',
    homeAbbrev: 'BOS',
    awaySeriesWins: 80,
    homeSeriesWins: 75,
    seriesDescription: 'Regular Season',
  };
  assert.equal(formatSeriesRecord(game), '');
});
