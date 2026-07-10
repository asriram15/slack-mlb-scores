# Slack MLB Live Scores

Slack app that shows today's MLB scoreboard on demand (`/scores`) and posts compact updates to a channel when scores or game state change.

Uses the free [MLB Stats API](https://statsapi.mlb.com) (no API key) and [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode) so you do not need a public HTTPS URL.

## Features

- **`/scores`** — full scoreboard for today (live, scheduled, final)
- **`/scores <abbrev>`** — today’s games for one team (3-letter abbrev, e.g. `NYY`, `BOS`)
- **`/scores help`** — list all team abbreviations (only you see this reply)
- **Channel updates** — posts on **score changes** only (plus a one-line alert when a game goes final); includes batter, pitcher, and who scored from MLB live play-by-play. Multiple runs in one poll interval each get their own post (with the score after that play). No inning-only posts.
- **Schedule-driven polling** — polls fast while any game is scheduled or live, and slower when the slate is finished, so idle hours and the offseason cost fewer API calls

## Prerequisites

- Node.js 20+
- A Slack workspace (free plan is fine)
- A dedicated channel for score alerts

## Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**.
2. **Socket Mode** → Enable → create an **App-Level Token** with `connections:write` → copy as `SLACK_APP_TOKEN` (`xapp-...`).
3. **OAuth & Permissions** → **Bot Token Scopes**: `chat:write`, `commands`.
4. **Install to Workspace** → copy **Bot User OAuth Token** as `SLACK_BOT_TOKEN` (`xoxb-...`).
5. **Slash Commands** → add `/scores`. Create this **after** Socket Mode is enabled so Slack does not require a Request URL.
6. Create channel `#mlb-scores`, run `/invite @YourAppName`.
7. Open channel details → copy **Channel ID** → `SLACK_SCORES_CHANNEL_ID`.

## Local setup

```bash
cd slack-mlb-scores
cp .env.example .env
# Edit .env with your tokens and channel ID
npm install
npm run test:mlb   # print today's board without Slack
npm start          # run bot (keep terminal open)
```

In Slack, run `/scores` in any channel where the app is installed.

### Team filter

Pass a **3-letter team abbreviation** after the command:

```
/scores          # all games today
/scores NYY      # New York Yankees only
/scores help     # abbreviation cheat sheet (ephemeral)
```

Common abbrevs: `BOS`, `LAD`, `NYM`, `NYY`, `SEA`, `ATL`. Athletics use `ATH` (alias `OAK`).

Update the slash command **usage hint** in Slack app settings to: `[team]` (e.g. `NYY`).

Channel auto-updates still cover **all** MLB games; team filter applies only to `/scores`.

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
| `PLAY_DETAIL_MAX_RETRIES` | No | Poll cycles to backfill missing play details (default `8`) |
| `GAME_DAY_TZ` | No | Timezone for "today" / "yesterday" date boundaries (default `America/New_York`) |

## Hosting

Socket Mode connects **outbound** to Slack. Your server does **not** need a public web port open—only SSH for you to manage it.

### Oracle Cloud Always Free ($0 / 24×7) — recommended

Oracle’s [Always Free tier](https://www.oracle.com/cloud/free/) includes an **Ampere ARM VM** that can run this bot year-round at no cost.

#### 1. Create the VM

1. Sign up at [cloud.oracle.com](https://cloud.oracle.com) (credit card required for verification; stay in Always Free shapes to avoid charges).
2. **Compute → Instances → Create instance**.
3. **Name:** `mlb-scores`
4. **Image:** Ubuntu 22.04 or 24.04 (aarch64).
5. **Shape:** `VM.Standard.A1.Flex` — **1 OCPU, 6 GB RAM** is plenty.
6. **Networking:** assign a **public IPv4** address.
7. **SSH key:** paste your Mac’s public key (`cat ~/.ssh/id_ed25519.pub` or `id_rsa.pub`). Generate one with `ssh-keygen -t ed25519` if needed.
8. Create the instance.

If A1 capacity is unavailable in your home region, try another (e.g. Phoenix, Ashburn, San Jose).

#### 2. Open only SSH (inbound)

**Networking → Virtual cloud networks → your VCN → Security Lists → Default Security List**

- **Ingress:** allow TCP **22** from your IP (or `0.0.0.0/0` if you accept the risk).
- **No** inbound rules for 80/443—the bot does not listen for HTTP.

Egress (outbound) is open by default; Slack and MLB API need that.

#### 3. Copy the project to the VM

From your Mac (replace `VM_IP` and user `ubuntu`):

```bash
# one-time: sync project (re-run after you change code)
rsync -avz --exclude node_modules --exclude .env \
  ~/slack-mlb-scores/ ubuntu@VM_IP:~/slack-mlb-scores/
```

Or push to a private GitHub repo and `git clone` on the VM.

#### 4. Install Node and run with pm2

SSH in:

```bash
ssh ubuntu@VM_IP
```

On the VM:

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

cd ~/slack-mlb-scores
npm install --omit=dev

cp .env.example .env
nano .env   # paste SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SCORES_CHANNEL_ID

npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
# run the command pm2 prints if it asks you to copy one more sudo line
```

Check logs:

```bash
pm2 logs mlb-scores
pm2 status
```

You should see `Slack MLB Scores bot is running (Socket Mode)` and `[poller] started`.

#### 5. Deploy updates later

From your Mac:

```bash
rsync -avz --exclude node_modules --exclude .env \
  ~/slack-mlb-scores/ ubuntu@VM_IP:~/slack-mlb-scores/
ssh ubuntu@VM_IP 'cd ~/slack-mlb-scores && npm install --omit=dev && pm2 restart mlb-scores'
```

#### Oracle tips

- **Cost:** keep the shape at **A1 Flex** within Always Free limits; do not add block storage or paid load balancers unless you intend to pay.
- **Idle reclamation:** Oracle may reclaim rarely used free VMs; light polling keeps the instance active.
- **Secrets:** never commit `.env`; it stays only on the VM.

### Local (fastest to try)

Run `npm start` on a machine that stays awake during games. Use `pm2` if you want auto-restart on the same Mac.

### Fly.io (~$0–5/mo)

Requires [flyctl](https://fly.io/docs/hands-on/install-flyctl/).

```bash
cd slack-mlb-scores
fly launch --no-deploy
fly secrets set SLACK_BOT_TOKEN=xoxb-... SLACK_APP_TOKEN=xapp-... SLACK_SCORES_CHANNEL_ID=C...
fly deploy
```

The included `Dockerfile` runs a single Node process.

### Not recommended

**Render free tier** sleeps idle services, which disconnects Socket Mode and misses score updates.

## Project layout

```
src/
  index.js   # Bolt app entry
  mlb.js     # MLB Stats API client
  teams.js   # MLB team IDs + /scores argument parsing
  format.js  # Slack Block Kit messages
  state.js   # Change detection fingerprints
  poller.js  # Interval polling + channel posts
  plays.js   # Live feed scoring play parsing
```

## Limitations

- MLB Stats API is unofficial and may change without notice.
- In-memory state resets on restart; the bot will not re-post current scores until the next change.
- Final alerts include the **last scoring play** (walk-off) or the **game-ending out** (groundout, strikeout, etc.) when the game ends without a run on that play.
