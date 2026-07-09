/**
 * @typedef {{ id: number, name: string, abbrev: string, aliases?: string[] }} TeamEntry
 */

/** @type {TeamEntry[]} */
const TEAMS = [
  { id: 108, name: 'Los Angeles Angels', abbrev: 'LAA' },
  { id: 109, name: 'Arizona Diamondbacks', abbrev: 'ARI', aliases: ['AZ'] },
  { id: 110, name: 'Baltimore Orioles', abbrev: 'BAL' },
  { id: 111, name: 'Boston Red Sox', abbrev: 'BOS' },
  { id: 112, name: 'Chicago Cubs', abbrev: 'CHC' },
  { id: 113, name: 'Cincinnati Reds', abbrev: 'CIN' },
  { id: 114, name: 'Cleveland Guardians', abbrev: 'CLE' },
  { id: 115, name: 'Colorado Rockies', abbrev: 'COL' },
  { id: 116, name: 'Detroit Tigers', abbrev: 'DET' },
  { id: 117, name: 'Houston Astros', abbrev: 'HOU' },
  { id: 118, name: 'Kansas City Royals', abbrev: 'KC', aliases: ['KCR', 'KAN'] },
  { id: 119, name: 'Los Angeles Dodgers', abbrev: 'LAD', aliases: ['LAN'] },
  { id: 120, name: 'Washington Nationals', abbrev: 'WSH', aliases: ['WSN', 'WAS'] },
  { id: 121, name: 'New York Mets', abbrev: 'NYM' },
  { id: 133, name: 'Athletics', abbrev: 'ATH', aliases: ['OAK'] },
  { id: 134, name: 'Pittsburgh Pirates', abbrev: 'PIT' },
  { id: 135, name: 'San Diego Padres', abbrev: 'SD', aliases: ['SDP'] },
  { id: 136, name: 'Seattle Mariners', abbrev: 'SEA' },
  { id: 137, name: 'San Francisco Giants', abbrev: 'SF', aliases: ['SFG'] },
  { id: 138, name: 'St. Louis Cardinals', abbrev: 'STL' },
  { id: 139, name: 'Tampa Bay Rays', abbrev: 'TB', aliases: ['TBR', 'TAM'] },
  { id: 140, name: 'Texas Rangers', abbrev: 'TEX' },
  { id: 141, name: 'Toronto Blue Jays', abbrev: 'TOR' },
  { id: 142, name: 'Minnesota Twins', abbrev: 'MIN' },
  { id: 143, name: 'Philadelphia Phillies', abbrev: 'PHI' },
  { id: 144, name: 'Atlanta Braves', abbrev: 'ATL' },
  { id: 145, name: 'Chicago White Sox', abbrev: 'CWS', aliases: ['CHW'] },
  { id: 146, name: 'Miami Marlins', abbrev: 'MIA' },
  { id: 147, name: 'New York Yankees', abbrev: 'NYY' },
  { id: 158, name: 'Milwaukee Brewers', abbrev: 'MIL' },
];

/** @type {Record<number, TeamEntry>} */
const BY_ID = Object.fromEntries(TEAMS.map((t) => [t.id, t]));

/** @type {Record<string, TeamEntry>} */
const BY_ABBREV = {};
for (const team of TEAMS) {
  BY_ABBREV[team.abbrev] = team;
  for (const alias of team.aliases ?? []) {
    BY_ABBREV[alias] = team;
  }
}

/**
 * @param {number} teamId
 * @returns {string|null}
 */
export function getTeamName(teamId) {
  return BY_ID[teamId]?.name ?? null;
}

/**
 * @param {number} teamId
 * @returns {string|null}
 */
export function getTeamAbbrev(teamId) {
  return BY_ID[teamId]?.abbrev ?? null;
}

/**
 * @param {string} abbrev
 * @returns {TeamEntry|null}
 */
export function resolveTeamAbbrev(abbrev) {
  const key = abbrev.trim().toUpperCase();
  return BY_ABBREV[key] ?? null;
}

/**
 * Parse slash-command or CLI text into a team id, help flag, or null (all teams).
 * @param {string} [text]
 * @returns {{ teamId: number|null, teamAbbrev: string|null, wantsHelp: boolean, error: string|null }}
 */
export function parseTeamArg(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return { teamId: null, teamAbbrev: null, wantsHelp: false, error: null };
  }

  if (/^(help|teams)$/i.test(trimmed)) {
    return { teamId: null, teamAbbrev: null, wantsHelp: true, error: null };
  }

  const match = trimmed.match(/^(?:team[:\s]*)?([A-Za-z]{2,4})$/i);
  if (!match) {
    return {
      teamId: null,
      teamAbbrev: null,
      wantsHelp: false,
      error:
        'Use `/scores` for all games, `/scores NYY` for one team (3-letter abbrev), or `/scores help` for the list.',
    };
  }

  const team = resolveTeamAbbrev(match[1]);
  if (!team) {
    return {
      teamId: null,
      teamAbbrev: null,
      wantsHelp: false,
      error: `Unknown team \`${match[1].toUpperCase()}\`. Try \`/scores help\` for abbreviations.`,
    };
  }

  return {
    teamId: team.id,
    teamAbbrev: team.abbrev,
    wantsHelp: false,
    error: null,
  };
}

/**
 * Slack mrkdwn list of team abbreviations for /scores help.
 * @returns {string}
 */
export function formatTeamAbbrevHelp() {
  const rows = [...TEAMS]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => `• \`${t.abbrev}\` — ${t.name}`);

  return [
    '*MLB team abbreviations* (use `/scores <abbrev>`)',
    '',
    ...rows,
    '',
    '_Examples:_ `/scores NYY` · `/scores BOS` · `/scores LAD`',
  ].join('\n');
}

/** @deprecated use formatTeamAbbrevHelp */
export const formatTeamIdHelp = formatTeamAbbrevHelp;
