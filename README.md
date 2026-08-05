# Slack MLB Live Scores

Slack bot that posts compact MLB score alerts to a channel when runs score or games end. Uses the free [MLB Stats API](https://statsapi.mlb.com) (no API key) and [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode) so you do not need a public HTTPS URL.

## Features

- **Live channel alerts** — posts when the score changes (batter, pitcher, who scored). Multiple runs in one poll interval each get their own post.
- **Finals** — one-line Final alert; walk-offs and game-ending outs when the feed provides them.
- **Postponements** — shows as Postponed (with reason) instead of a fake Final 0–0.
- **Hold until complete** — waits for an at-bat to finish before posting (e.g. wild pitch during a walk), so you get one settled alert instead of two half-baked ones.
- **Highlight clips** — when MLB publishes a clip for a scoring play, replies in that alert’s thread with the video URL.
- **Schedule-driven polling** — polls fast while games are scheduled or live, slower when the slate is idle.

Optional: a `/scores` slash command for today’s board (see below).

## Prerequisites

- Node.js 20+
- A Slack workspace (free plan is fine)
- A dedicated channel for score alerts

## Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. **Socket Mode** → Enable → create an **App-Level Token** with `connections:write` → copy as `SLACK_APP_TOKEN` (`xapp-...`).
3. **OAuth & Permissions** → **Bot Token Scopes**: `chat:write` (add `commands` only if you want `/scores`).
4. **Install to Workspace** → copy **Bot User OAuth Token** as `SLACK_BOT_TOKEN` (`xoxb-...`).
5. Create channel `#mlb-scores`, run `/invite @YourAppName`.
6. Open channel details → copy **Channel ID** → `SLACK_SCORES_CHANNEL_ID`.

### Optional: `/scores` slash command

If you want an on-demand scoreboard:

1. **Slash Commands** → add `/scores` (create this **after** Socket Mode is enabled so Slack does not require a Request URL).
2. Usage hint: `[team]` (e.g. `NYY`).
3. Ensure the bot has the `commands` OAuth scope and reinstall if you added it later.

```
/scores          # all games today
/scores NYY      # one team (3-letter abbrev)
/scores help     # abbreviation cheat sheet (ephemeral)
```

Athletics use `ATH` (alias `OAK`). Channel auto-updates always cover **all** MLB games; the team filter applies only to this command.

## Local setup

```bash
cd slack-mlb-scores
cp .env.example .env   # or create .env from the table below
# Edit .env with your tokens and channel ID
npm install
npm run test:mlb   # print today's board without Slack
npm start          # run bot (keep terminal open)
```

Invite the bot to your scores channel; alerts post there automatically while the process is running.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | Yes | App-level token (`xapp-...`) with `connections:write` |
| `SLACK_SCORES_CHANNEL_ID` | Yes | Channel ID for change-triggered posts |
| `POLL_INTERVAL_MS` | No | Active poll interval when any game is Preview/Live (default `120000` = 2 min). Use `60000` for faster play detail catch-up. |
| `POLL_IDLE_INTERVAL_MS` | No | Idle poll interval when the slate is all Final or empty (default `600000` = 10 min). Still checks the schedule so a new slate is noticed. |
| `LIVE_FEED_RETRIES` | No | Retries when loading play-by-play after a score change (default `4`) |
| `LIVE_FEED_RETRY_MS` | No | Delay between live feed retries in ms (default `800`) |
| `PLAY_DETAIL_MAX_RETRIES` | No | Poll cycles to backfill missing play details or incomplete at-bats (default `8`) |
| `VIDEO_HIGHLIGHT_MAX_RETRIES` | No | Poll cycles to wait for a highlight clip (default `20`) |
| `GAME_DAY_TZ` | No | Timezone for "today" / "yesterday" date boundaries (default `America/New_York`) |


## Project layout

```
src/
  index.js       # Bolt app entry (+ optional /scores)
  mlb.js         # MLB Stats API client
  teams.js       # MLB team IDs + slash-command parsing
  format.js      # Slack message formatting
  state.js       # Change detection + pending queues
  poller.js      # Interval polling + channel posts
  plays.js       # Live feed scoring play parsing
  highlights.js  # Highlight clip lookup by playId
```

## Limitations

- MLB Stats API is unofficial and may change without notice.
- In-memory state resets on restart; the bot will not re-post current scores until the next change.
- Highlight clips often lag the live feed by several minutes; the bot retries in-thread when they appear.
- Final alerts include the **last scoring play** (walk-off) or the **game-ending out** (groundout, strikeout, etc.) when the game ends without a run on that play.
