import { fetchLiveFeed } from './mlb.js';
import {
  formatScoringContext,
  latestScoringPlayContext,
  scoringPlaysSince,
} from './plays.js';

const gamePk = Number(process.argv[2]);
if (!gamePk) {
  console.error('Usage: npm run test:play -- <gamePk>');
  process.exit(1);
}

const feed = await fetchLiveFeed(gamePk);
const allPlays = feed.liveData?.plays?.allPlays ?? [];
const recent = scoringPlaysSince(allPlays, -1);

console.log(`Game ${gamePk}: ${recent.length} scoring plays\n`);

for (const play of recent.slice(-3)) {
  const result = latestScoringPlayContext(allPlays, (play.about?.atBatIndex ?? 0) - 1);
  if (result) {
    console.log(formatScoringContext(result.context));
    console.log();
  }
}
