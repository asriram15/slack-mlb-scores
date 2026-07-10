import 'dotenv/config';
import { App } from '@slack/bolt';
import { fetchTodaysGames, groupGames } from './mlb.js';
import { buildScoreboardBlocks } from './format.js';
import { startPoller } from './poller.js';
import {
  formatTeamAbbrevHelp,
  getTeamName,
  parseTeamArg,
} from './teams.js';

const required = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_SCORES_CHANNEL_ID'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env: ${key}`);
    process.exit(1);
  }
}

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const TZ = process.env.GAME_DAY_TZ ?? 'America/New_York';
const SCORES_CHANNEL = process.env.SLACK_SCORES_CHANNEL_ID;

app.command('/scores', async ({ ack, respond, command }) => {
  await ack();

  const { teamId, teamAbbrev, wantsHelp, error } = parseTeamArg(command.text);

  if (wantsHelp) {
    await respond({
      response_type: 'ephemeral',
      text: formatTeamAbbrevHelp(),
    });
    return;
  }

  if (error) {
    await respond({
      response_type: 'ephemeral',
      text: error,
    });
    return;
  }

  try {
    const games = await fetchTodaysGames(TZ, teamId ?? undefined);
    const groups = groupGames(games);
    const teamName = teamId ? getTeamName(teamId) : null;
    const blocks = buildScoreboardBlocks(groups, {
      teamId,
      teamName,
      teamAbbrev,
    });

    const fallback = teamAbbrev
      ? `MLB Scoreboard — ${teamAbbrev}`
      : teamName
        ? `MLB Scoreboard — ${teamName}`
        : 'MLB Scoreboard';

    await respond({
      response_type: 'in_channel',
      blocks,
      text: fallback,
    });
  } catch (err) {
    console.error('[/scores] error:', err.message);
    await respond({
      response_type: 'ephemeral',
      text: `Could not load MLB scores: ${err.message}`,
    });
  }
});

(async () => {
  await app.start();
  console.log('Slack MLB Scores bot is running (Socket Mode)');
  startPoller(app, SCORES_CHANNEL);
})();
