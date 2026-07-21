/**
 * @typedef {object} GameSummary
 * @property {number} gamePk
 * @property {number|null} awayId
 * @property {number|null} homeId
 * @property {string} awayName
 * @property {string} homeName
 * @property {string} awayAbbrev
 * @property {string} homeAbbrev
 * @property {number} awayScore
 * @property {number} homeScore
 * @property {number|null} inning
 * @property {string|null} inningHalf
 * @property {number|null} outs
 * @property {string} abstractState
 * @property {string} detailedState
 * @property {string|null} [statusReason]
 * @property {string|null} [codedState]
 * @property {string|null} startTime
 */

/**
 * Postponed/cancelled games are abstract Final at 0–0; treat them separately.
 * @param {GameSummary} g
 * @returns {boolean}
 */
export function isNonResultFinal(g) {
  const detailed = (g.detailedState ?? '').toLowerCase();
  const coded = (g.codedState ?? '').toUpperCase();
  return (
    coded === 'D' ||
    coded === 'C' ||
    detailed.startsWith('postponed') ||
    detailed.startsWith('cancelled') ||
    detailed.startsWith('canceled')
  );
}

/**
 * @param {GameSummary} g
 * @returns {string} e.g. "Postponed (Rain)"
 */
export function formatNonResultStatus(g) {
  const label = g.detailedState || 'Postponed';
  return g.statusReason ? `${label} (${g.statusReason})` : label;
}

const TZ = () => process.env.GAME_DAY_TZ ?? 'America/New_York';

/**
 * @param {GameSummary} g
 * @returns {string}
 */
export function gameFingerprint(g) {
  return [
    g.awayScore,
    g.homeScore,
    g.inning ?? '',
    g.inningHalf ?? '',
    g.abstractState,
    g.detailedState,
  ].join('|');
}

/**
 * @param {GameSummary} g
 * @returns {string} away abbrev/name for display
 */
function awayLabel(g) {
  return g.awayAbbrev || g.awayName;
}

/**
 * @param {GameSummary} g
 * @returns {string} home abbrev/name for display
 */
function homeLabel(g) {
  return g.homeAbbrev || g.homeName;
}

/**
 * @param {number} n
 * @returns {string}
 */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * @param {GameSummary} g
 * @returns {string}
 */
export function formatInningText(g, { includeOuts = true } = {}) {
  if (g.abstractState !== 'Live' || !g.inning) {
    return g.detailedState;
  }
  const half =
    g.inningHalf === 'Top' ? 'Top' : g.inningHalf === 'Bottom' ? 'Bot' : '';
  const ord = ordinal(g.inning);
  const showOuts =
    includeOuts &&
    g.outs != null &&
    g.outs >= 0 &&
    g.outs < 3;
  const outs = showOuts
    ? `, ${g.outs} out${g.outs === 1 ? '' : 's'}`
    : '';
  return half ? `${half} ${ord}${outs}` : `${ord}${outs}`;
}

/**
 * @param {GameSummary} g
 * @returns {string}
 */
export function formatGameMrkdwn(g) {
  const away = awayLabel(g);
  const home = homeLabel(g);

  if (g.abstractState === 'Preview') {
    const time = g.startTime
      ? new Date(g.startTime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: TZ(),
        })
      : 'TBD';
    return `*${away}* @ *${home}* · ${time}`;
  }

  if (isNonResultFinal(g)) {
    return `*${away}* @ *${home}* · *${formatNonResultStatus(g)}*`;
  }

  const score = `*${away}* ${g.awayScore} – *${home}* ${g.homeScore}`;

  if (g.abstractState === 'Live') {
    return `${score} · ${formatInningText(g)}`;
  }

  if (g.abstractState === 'Final') {
    return `${score} · *Final*`;
  }

  return `${score} · ${g.detailedState}`;
}

/**
 * @typedef {object} ChangeAlertOpts
 * @property {string} [playContext] - batter/pitcher/scorers line from live feed
 * @property {'scoring'|'ending'|'walkoff'} [playContextKind]
 * @property {boolean} [scoreChanged]
 * @property {boolean} [statusChanged]
 * @property {boolean} [isFinalTransition]
 */

/**
 * Compact update for channel posts on change.
 * @param {GameSummary} g
 * @param {ChangeAlertOpts} [opts]
 * @returns {string}
 */
export function formatChangeAlert(g, opts = {}) {
  const away = awayLabel(g);
  const home = homeLabel(g);

  if (isNonResultFinal(g)) {
    return `${away} @ ${home}\n*${formatNonResultStatus(g)}*`;
  }

  const score = `${away} ${g.awayScore} – ${home} ${g.homeScore}`;
  const lines = [score];

  if (g.abstractState === 'Final') {
    lines.push('*Final*');
  } else if (g.abstractState === 'Live') {
    lines.push(`${formatInningText(g, { includeOuts: false })} · Live`);
  } else {
    lines.push(g.detailedState);
  }

  if (opts.playContext) {
    let prefix = '';
    if (opts.playContextKind === 'walkoff') {
      prefix = 'Walk-off: ';
    } else if (opts.playContextKind === 'ending') {
      prefix = 'Final play: ';
    }
    lines.push(`_${prefix}${opts.playContext}_`);
  }

  return lines.join('\n');
}

/**
 * Follow-up when play details arrive after the score was already posted.
 * @param {GameSummary} g
 * @param {string} playContext
 * @returns {string}
 */
export function formatPlayFollowUp(g, playContext) {
  const away = awayLabel(g);
  const home = homeLabel(g);
  return `${away} ${g.awayScore} – ${home} ${g.homeScore}\n_${playContext}_`;
}

/**
 * @param {{
 *   live: GameSummary[],
 *   preview: GameSummary[],
 *   final: GameSummary[],
 *   postponed?: GameSummary[],
 * }} groups
 * @param {{ teamName?: string|null, teamAbbrev?: string|null, teamId?: number|null }} [opts]
 * @returns {object[]} Slack Block Kit blocks
 */
export function buildScoreboardBlocks(groups, opts = {}) {
  const { live, preview, final, postponed = [] } = groups;
  const total = live.length + preview.length + final.length + postponed.length;
  const teamName = opts.teamName ?? null;
  const teamAbbrev = opts.teamAbbrev ?? null;
  const teamLabel =
    teamAbbrev && teamName
      ? `${teamAbbrev} — ${teamName}`
      : teamName ?? teamAbbrev;
  const emptyText = teamLabel
    ? `No MLB games scheduled today for *${teamLabel}*.`
    : 'No MLB games scheduled today.';

  if (total === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: emptyText,
        },
      },
    ];
  }

  const headerText = teamLabel
    ? `MLB Scoreboard — ${teamLabel}`
    : 'MLB Scoreboard';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: headerText, emoji: false },
    },
  ];

  const addSection = (title, games) => {
    if (games.length === 0) return;
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${title}*`,
      },
    });
    const lines = games.map((g) => formatGameMrkdwn(g)).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: lines },
    });
  };

  addSection('Live', live);
  addSection('Scheduled', preview);
  addSection('Final', final);
  addSection('Postponed', postponed);

  return blocks;
}

/**
 * @param {GameSummary[]} games
 * @param {ReturnType<import('./mlb.js').groupGames>} groups
 * @returns {object[]}
 */
export function buildScoreboardFromGames(games, groups) {
  return buildScoreboardBlocks(groups ?? groupGamesFallback(games));
}

function groupGamesFallback(games) {
  const live = [];
  const preview = [];
  const final = [];
  const postponed = [];
  for (const g of games) {
    if (g.abstractState === 'Live') live.push(g);
    else if (g.abstractState === 'Preview') preview.push(g);
    else if (g.abstractState === 'Final') {
      if (isNonResultFinal(g)) postponed.push(g);
      else final.push(g);
    }
  }
  return { live, preview, final, postponed };
}
