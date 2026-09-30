/**
 * @typedef {object} ScoringPlayContext
 * @property {string} batter
 * @property {string} pitcher
 * @property {string} event
 * @property {string[]} scorers
 * @property {string} [description]
 * @property {number} [rbi]
 */

/**
 * Mid-PA or at-bat scoring moment (wild pitch, passed ball, hit, etc.).
 * @typedef {object} ScoringMoment
 * @property {object} play
 * @property {number} atBatIndex
 * @property {number} playIndex
 * @property {boolean} isActionScoring
 * @property {string} event
 * @property {string} eventType
 * @property {string[]} scorers
 * @property {string} [description]
 * @property {number|null} awayScore
 * @property {number|null} homeScore
 * @property {string} batter
 * @property {string} pitcher
 * @property {number} rbi
 */

/**
 * @typedef {object} PlayAlertContext
 * @property {string} text
 * @property {'scoring'|'ending'|'walkoff'} kind
 * @property {number} atBatIndex
 * @property {number} [playIndex]
 */

/** Runner/action event types that score without the batter's plate-appearance result. */
const NON_BATTER_SCORING_TYPES = new Set([
  'wild_pitch',
  'passed_ball',
  'balk',
  'stolen_base',
  'stolen_base_home',
  'other_advance',
  'defensive_indiff',
  'error',
  'pickoff_error_1b',
  'pickoff_error_2b',
  'pickoff_error_3b',
  'runner_interference',
]);

/**
 * @param {string} [eventType]
 * @returns {boolean}
 */
export function isNonBatterScoringEventType(eventType) {
  return Boolean(eventType && NON_BATTER_SCORING_TYPES.has(eventType));
}

/**
 * @param {import('./format.js').GameSummary} game
 * @param {object} play
 * @returns {boolean}
 */
export function isWalkOffPlay(play, game) {
  if (!play || !isScoringPlay(play)) return false;
  if (game.homeScore <= game.awayScore) return false;

  const inning = play.about?.inning ?? game.inning ?? 0;
  const isBottom =
    play.about?.halfInning === 'bottom' || play.about?.isTopInning === false;
  if (!isBottom || inning < 9) return false;

  const homeAfter = play.result?.homeScore;
  const awayAfter = play.result?.awayScore;
  if (
    typeof homeAfter === 'number' &&
    typeof awayAfter === 'number' &&
    homeAfter <= awayAfter
  ) {
    return false;
  }

  return true;
}

/**
 * @param {object} play
 * @returns {boolean}
 */
export function isScoringPlay(play) {
  if (play?.about?.isScoringPlay || (play?.result?.rbi ?? 0) > 0) return true;
  return (play?.runners ?? []).some((r) => r.details?.isScoringEvent);
}

/**
 * False while an at-bat is still open (e.g. wild pitch before the walk finishes).
 * @param {object} [play]
 * @returns {boolean}
 */
export function isPlayComplete(play) {
  if (!play) return false;
  if (play.about?.isComplete === true) return true;
  if (play.about?.isComplete === false) return false;
  const event = play.result?.event ?? play.result?.eventType;
  return Boolean(event);
}

/**
 * Split an at-bat into scoring moments (e.g. wild pitch mid-PA, then a hit).
 * @param {object} play
 * @returns {ScoringMoment[]}
 */
export function extractScoringMoments(play) {
  if (!play || !isScoringPlay(play)) return [];

  /** @type {Map<number, object[]>} */
  const runnersByIndex = new Map();
  for (const r of play.runners ?? []) {
    if (!r.details?.isScoringEvent) continue;
    const idx = r.details.playIndex;
    if (typeof idx !== 'number') continue;
    if (!runnersByIndex.has(idx)) runnersByIndex.set(idx, []);
    runnersByIndex.get(idx).push(r);
  }

  for (const e of play.playEvents ?? []) {
    if (
      e.details?.isScoringPlay &&
      typeof e.index === 'number' &&
      !runnersByIndex.has(e.index)
    ) {
      runnersByIndex.set(e.index, []);
    }
  }

  const batter = play.matchup?.batter?.fullName ?? 'Unknown batter';
  const pitcher = play.matchup?.pitcher?.fullName ?? 'Unknown pitcher';
  const atBatIndex = play.about?.atBatIndex ?? -1;

  /** @type {ScoringMoment[]} */
  const moments = [];

  for (const playIndex of [...runnersByIndex.keys()].sort((a, b) => a - b)) {
    const runners = runnersByIndex.get(playIndex) ?? [];
    const playEvent =
      (play.playEvents ?? []).find((e) => e.index === playIndex) ??
      play.playEvents?.[playIndex];

    const eventType =
      playEvent?.details?.eventType ??
      runners[0]?.details?.eventType ??
      play.result?.eventType ??
      '';
    const event =
      playEvent?.details?.event ??
      runners[0]?.details?.event ??
      play.result?.event ??
      eventType ??
      'play';

    const isActionScoring =
      (playEvent?.type === 'action' &&
        (playEvent?.details?.isScoringPlay ||
          isNonBatterScoringEventType(eventType))) ||
      isNonBatterScoringEventType(eventType);

    const scorers = [
      ...new Set(
        runners
          .map((r) => r.details?.runner?.fullName)
          .filter(Boolean),
      ),
    ];

    let awayScore = playEvent?.details?.awayScore ?? null;
    let homeScore = playEvent?.details?.homeScore ?? null;
    if (typeof awayScore !== 'number' || typeof homeScore !== 'number') {
      awayScore = play.result?.awayScore ?? null;
      homeScore = play.result?.homeScore ?? null;
    }

    moments.push({
      play,
      atBatIndex,
      playIndex,
      isActionScoring,
      event: event || 'play',
      eventType: eventType || '',
      scorers,
      description: isActionScoring
        ? playEvent?.details?.description
        : play.result?.description,
      awayScore,
      homeScore,
      batter,
      pitcher,
      rbi: isActionScoring ? 0 : (play.result?.rbi ?? 0),
    });
  }

  if (moments.length === 0) {
    const context = parseScoringPlay(play);
    if (!context) return [];
    moments.push({
      play,
      atBatIndex,
      playIndex: -1,
      isActionScoring: false,
      event: context.event,
      eventType: play.result?.eventType ?? '',
      scorers: context.scorers,
      description: context.description,
      awayScore: play.result?.awayScore ?? null,
      homeScore: play.result?.homeScore ?? null,
      batter: context.batter,
      pitcher: context.pitcher,
      rbi: context.rbi ?? 0,
    });
  }

  return moments;
}

/**
 * @param {ScoringMoment} moment
 * @param {number} sinceAtBat
 * @param {number} sinceEvent
 * @returns {boolean}
 */
function isMomentAfterCursor(moment, sinceAtBat, sinceEvent) {
  if (moment.atBatIndex > sinceAtBat) return true;
  if (moment.atBatIndex < sinceAtBat) return false;
  return moment.playIndex > sinceEvent;
}

/**
 * @param {ScoringMoment} moment
 * @param {number|null} prevAway
 * @param {number|null} prevHome
 * @param {number} currAway
 * @param {number} currHome
 * @returns {boolean}
 */
function momentScoreInGap(moment, prevAway, prevHome, currAway, currHome) {
  const a = moment.awayScore;
  const h = moment.homeScore;
  if (typeof a !== 'number' || typeof h !== 'number') return true;

  if (typeof prevAway === 'number' && typeof prevHome === 'number') {
    if (a < prevAway || h < prevHome) return false;
    if (a === prevAway && h === prevHome) return false;
  }

  if (a > currAway || h > currHome) return false;
  return true;
}

/**
 * Find the scoring play that produced the current scoreboard line.
 * @param {object[]} allPlays
 * @param {number} awayScore
 * @param {number} homeScore
 * @param {number} sinceIndex
 * @returns {object|null}
 */
export function findScoringPlayForScore(
  allPlays,
  awayScore,
  homeScore,
  sinceIndex,
) {
  const moments = findScoringMomentsInGap(
    allPlays,
    sinceIndex,
    -1,
    null,
    null,
    awayScore,
    homeScore,
  );
  return moments.at(-1)?.play ?? null;
}

/**
 * Scoring moments between the last seen cursor and the current scoreboard.
 * Mid-PA actions (wild pitch, etc.) are separate from the at-bat result.
 *
 * @param {object[]} allPlays
 * @param {number} sinceAtBat
 * @param {number} sinceEvent
 * @param {number|null} prevAway
 * @param {number|null} prevHome
 * @param {number} currAway
 * @param {number} currHome
 * @returns {ScoringMoment[]}
 */
export function findScoringMomentsInGap(
  allPlays,
  sinceAtBat,
  sinceEvent,
  prevAway,
  prevHome,
  currAway,
  currHome,
) {
  const recent = allPlays
    .filter(isScoringPlay)
    .flatMap((p) => extractScoringMoments(p))
    .filter((m) => isMomentAfterCursor(m, sinceAtBat, sinceEvent))
    .sort(
      (a, b) =>
        a.atBatIndex - b.atBatIndex || a.playIndex - b.playIndex,
    );

  const inGap = recent.filter((m) =>
    momentScoreInGap(m, prevAway, prevHome, currAway, currHome),
  );
  if (inGap.length) return inGap;

  const exact = recent.filter(
    (m) => m.awayScore === currAway && m.homeScore === currHome,
  );
  if (exact.length) return [exact.at(-1)];

  if (recent.length) return [recent.at(-1)];

  const fallback = allPlays
    .filter(isScoringPlay)
    .flatMap((p) => extractScoringMoments(p))
    .filter((m) => m.awayScore === currAway && m.homeScore === currHome);
  const last = fallback.at(-1);
  return last ? [last] : [];
}

/**
 * All scoring at-bats between the last seen at-bat and the current scoreboard.
 * @param {object[]} allPlays
 * @param {number} sinceIndex
 * @param {number|null} prevAway
 * @param {number|null} prevHome
 * @param {number} currAway
 * @param {number} currHome
 * @returns {object[]}
 */
export function findScoringPlaysInGap(
  allPlays,
  sinceIndex,
  prevAway,
  prevHome,
  currAway,
  currHome,
) {
  const moments = findScoringMomentsInGap(
    allPlays,
    sinceIndex,
    -1,
    prevAway,
    prevHome,
    currAway,
    currHome,
  );
  const seen = new Set();
  /** @type {object[]} */
  const plays = [];
  for (const m of moments) {
    if (seen.has(m.atBatIndex)) continue;
    seen.add(m.atBatIndex);
    plays.push(m.play);
  }
  return plays;
}

/**
 * @param {object} play
 * @returns {{ play: object, context: ScoringPlayContext, atBatIndex: number }|null}
 */
export function scoringPlayToAlert(play) {
  if (!play) return null;
  const context = parseScoringPlay(play);
  if (!context) return null;
  return {
    play,
    context,
    atBatIndex: play.about?.atBatIndex ?? -1,
  };
}

/**
 * @param {object[]} allPlays
 * @returns {object|null}
 */
export function lastPlayInGame(allPlays) {
  return allPlays.at(-1) ?? null;
}

/**
 * @param {object[]} allPlays
 * @param {number} minAtBatIndex - exclusive lower bound
 * @returns {object[]}
 */
export function scoringPlaysSince(allPlays, minAtBatIndex) {
  return allPlays.filter(
    (p) => (p.about?.atBatIndex ?? -1) > minAtBatIndex && isScoringPlay(p),
  );
}

/**
 * @param {object} play - allPlays entry from live feed
 * @returns {ScoringPlayContext|null}
 */
export function parseScoringPlay(play) {
  if (!play) return null;

  const batter = play.matchup?.batter?.fullName;
  const pitcher = play.matchup?.pitcher?.fullName;
  const event = play.result?.event ?? play.result?.eventType;
  const description = play.result?.description;

  // Exclude mid-PA action scorers (wild pitch, etc.); those are separate moments.
  const scorers = [
    ...new Set(
      (play.runners ?? [])
        .filter((r) => r.details?.isScoringEvent)
        .filter((r) => !isNonBatterScoringEventType(r.details?.eventType))
        .map((r) => r.details?.runner?.fullName)
        .filter(Boolean),
    ),
  ];

  if (!batter && !description) return null;

  return {
    batter: batter ?? 'Unknown batter',
    pitcher: pitcher ?? 'Unknown pitcher',
    event: event ?? 'play',
    scorers,
    description,
    rbi: play.result?.rbi ?? 0,
  };
}

/**
 * @param {string} [event]
 * @returns {boolean}
 */
function isHomeRunEvent(event) {
  if (!event) return false;
  return /home\s*run/i.test(event) || event === 'home_run' || event === 'hr';
}

/**
 * Embed RBI count in the HR label so the batter isn't repeated as a scorer.
 * @param {number} rbi
 * @param {number} scorerCount
 * @returns {string}
 */
function homeRunEventLabel(rbi, scorerCount) {
  const runs = rbi > 0 ? rbi : scorerCount > 0 ? scorerCount : 1;
  if (runs >= 4) return 'grand slam';
  if (runs === 3) return '3-run Home Run';
  if (runs === 2) return '2-run Home Run';
  return 'solo Home Run';
}

/**
 * @param {string[]} scorers
 * @param {number} [rbi]
 * @param {string} [description]
 * @param {string} [batter]
 * @returns {string}
 */
function formatRunLine(scorers, rbi = 0, description, batter) {
  if (scorers.length === 1) {
    return scorers[0] === batter ? 'scores' : `${scorers[0]} scores`;
  }
  if (scorers.length > 1) return `${scorers.join(', ')} score`;
  if (rbi > 0) return `${rbi} RBI`;
  if (description) {
    const scorePart = description.split('.').find((s) => /scores?/i.test(s));
    return scorePart?.trim() ?? description;
  }
  return 'Run scored';
}

/**
 * @param {ScoringPlayContext} ctx
 * @returns {string}
 */
export function formatScoringContext(ctx) {
  // HRs: RBI count in the event label; list other scorers only (not the batter).
  if (isHomeRunEvent(ctx.event)) {
    const label = homeRunEventLabel(ctx.rbi ?? 0, ctx.scorers.length);
    const hitLine = `${ctx.batter} (${label}) off ${ctx.pitcher}`;
    const otherScorers = ctx.scorers.filter((name) => name !== ctx.batter);
    if (otherScorers.length === 0) return hitLine;
    const runLine =
      otherScorers.length === 1
        ? `${otherScorers[0]} scores`
        : `${otherScorers.join(', ')} score`;
    return `${hitLine} · ${runLine}`;
  }

  const hitLine = `${ctx.batter} (${ctx.event}) off ${ctx.pitcher}`;
  return `${hitLine} · ${formatRunLine(
    ctx.scorers,
    ctx.rbi,
    ctx.description,
    ctx.batter,
  )}`;
}

/**
 * @param {ScoringMoment} moment
 * @returns {string}
 */
export function formatScoringMoment(moment) {
  if (moment.isActionScoring) {
    if (moment.description) {
      return moment.description
        .replace(/\bby pitcher\b/gi, 'by')
        .replace(/\.\s*$/, '')
        .replace(/\.\s+/g, ' · ');
    }
    const label = moment.event || 'Play';
    return `${label} by ${moment.pitcher} · ${formatRunLine(moment.scorers)}`;
  }

  return formatScoringContext({
    batter: moment.batter,
    pitcher: moment.pitcher,
    event: moment.event,
    scorers: moment.scorers,
    description: moment.description,
    rbi: moment.rbi,
  });
}

/**
 * @param {string} [description]
 * @returns {string|null}
 */
export function fieldingSummaryFromDescription(description) {
  if (!description) return null;

  const assist = description.match(
    /(?:,\s*)?(?:(?:\w+\s+)?baseman|shortstop|pitcher|catcher)\s+([^,]+?)\s+to\s+(?:(?:\w+\s+)?baseman|shortstop|pitcher|catcher)\s+([^.]+)/i,
  );
  if (assist) {
    return `${assist[1].trim()} to ${assist[2].trim()}`;
  }

  const flyout = description.match(/to\s+(?:(?:\w+\s+)?fielder)\s+([^.]+)/i);
  if (flyout) {
    return `out to ${flyout[1].trim()}`;
  }

  const popout = description.match(/caught by\s+([^.]+)/i);
  if (popout) {
    return `caught by ${popout[1].trim()}`;
  }

  return null;
}

/**
 * @param {object} play
 * @returns {string|null}
 */
export function formatEndingPlayContext(play) {
  if (!play) return null;

  const batter = play.matchup?.batter?.fullName ?? 'Unknown batter';
  const pitcher = play.matchup?.pitcher?.fullName ?? 'Unknown pitcher';
  const event = play.result?.event ?? play.result?.eventType ?? 'out';
  const description = play.result?.description;

  const parts = [`${batter} (${event}) off ${pitcher}`];

  const fielding = fieldingSummaryFromDescription(description);
  if (fielding) {
    parts.push(fielding);
  }

  parts.push('Game over');
  return parts.join(' · ');
}

/**
 * @typedef {object} PlayAlertWithScore
 * @property {string} text
 * @property {'scoring'|'ending'|'walkoff'} kind
 * @property {number} atBatIndex
 * @property {number} playIndex
 * @property {number} awayScore
 * @property {number} homeScore
 * @property {number|null} [inning]
 * @property {string|null} [inningHalf]
 * @property {string|null} [playId] - MLB pitch/event id for highlight matching
 */

/**
 * UUID on the decisive pitch/event — used to join MLB highlight clips.
 * @param {object} [play]
 * @param {number} [playIndex]
 * @returns {string|null}
 */
export function extractPlayId(play, playIndex) {
  const events = play?.playEvents;
  if (!Array.isArray(events) || events.length === 0) return null;
  if (typeof playIndex === 'number' && playIndex >= 0) {
    const event = events.find((item) => item?.index === playIndex);
    const id = event?.playId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const id = events[i]?.playId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return null;
}

/**
 * Build one alert per scoring moment in the poll gap (plus ending context on final).
 * @param {object[]} allPlays
 * @param {{
 *   scoreChanged: boolean,
 *   isFinalTransition: boolean,
 *   sinceIndex: number,
 *   sinceEventIndex?: number,
 *   game: import('./format.js').GameSummary,
 *   prevAwayScore?: number,
 *   prevHomeScore?: number,
 * }} opts
 * @returns {PlayAlertWithScore[]}
 */
export function buildPlayAlertContexts(
  allPlays,
  {
    scoreChanged,
    isFinalTransition,
    sinceIndex,
    sinceEventIndex = -1,
    game,
    prevAwayScore,
    prevHomeScore,
  },
) {
  /** @type {PlayAlertWithScore[]} */
  const alerts = [];

  if (scoreChanged) {
    const moments = findScoringMomentsInGap(
      allPlays,
      sinceIndex,
      sinceEventIndex,
      prevAwayScore ?? null,
      prevHomeScore ?? null,
      game.awayScore,
      game.homeScore,
    );

    for (const moment of moments) {
      const awayScore =
        typeof moment.awayScore === 'number'
          ? moment.awayScore
          : game.awayScore;
      const homeScore =
        typeof moment.homeScore === 'number'
          ? moment.homeScore
          : game.homeScore;

      let kind = 'scoring';
      if (
        isFinalTransition &&
        moment === moments.at(-1) &&
        isWalkOffPlay(moment.play, { ...game, awayScore, homeScore })
      ) {
        kind = 'walkoff';
      }

      alerts.push({
        text: formatScoringMoment(moment),
        kind,
        atBatIndex: moment.atBatIndex,
        playIndex: moment.playIndex,
        awayScore,
        homeScore,
        inning: moment.play.about?.inning ?? null,
        inningHalf: halfInningLabel(moment.play),
        playId: extractPlayId(moment.play, moment.playIndex),
      });
    }
  }

  if (isFinalTransition) {
    const lastAlert = alerts.at(-1);
    if (lastAlert?.kind === 'walkoff') {
      return alerts;
    }

    const lastPlay = lastPlayInGame(allPlays);
    if (lastPlay && isWalkOffPlay(lastPlay, game)) {
      const walkoffMoment = extractScoringMoments(lastPlay).at(-1);
      if (walkoffMoment) {
        const walkoff = {
          text: formatScoringMoment(walkoffMoment),
          kind: /** @type {const} */ ('walkoff'),
          atBatIndex: lastPlay.about?.atBatIndex ?? -1,
          playIndex: walkoffMoment.playIndex,
          awayScore: game.awayScore,
          homeScore: game.homeScore,
          inning: lastPlay.about?.inning ?? game.inning,
          inningHalf: halfInningLabel(lastPlay) ?? game.inningHalf,
          playId: extractPlayId(lastPlay, walkoffMoment.playIndex),
        };
        if (lastAlert && lastAlert.atBatIndex === walkoff.atBatIndex) {
          alerts[alerts.length - 1] = walkoff;
        } else if (!scoreChanged || !lastAlert) {
          alerts.push(walkoff);
        } else {
          alerts[alerts.length - 1] = {
            ...lastAlert,
            kind: 'walkoff',
            text: walkoff.text,
            playId: walkoff.playId ?? lastAlert.playId,
          };
        }
        return alerts;
      }
    }

    const ending = formatEndingPlayContext(lastPlay);
    if (ending) {
      if (alerts.length === 0) {
        alerts.push({
          text: ending,
          kind: 'ending',
          atBatIndex: lastPlay?.about?.atBatIndex ?? -1,
          playIndex: -1,
          awayScore: game.awayScore,
          homeScore: game.homeScore,
          inning: lastPlay?.about?.inning ?? game.inning,
          inningHalf: halfInningLabel(lastPlay) ?? game.inningHalf,
          playId: extractPlayId(lastPlay),
        });
      } else {
        // Keep scoring alerts; final banner is applied by the poller on the last post.
      }
    }
  }

  return alerts;
}

/**
 * Build alert text for a score change or game-ending play.
 * @param {object[]} allPlays
 * @param {{
 *   scoreChanged: boolean,
 *   isFinalTransition: boolean,
 *   sinceIndex: number,
 *   sinceEventIndex?: number,
 *   game: import('./format.js').GameSummary,
 *   prevAwayScore?: number,
 *   prevHomeScore?: number,
 * }} opts
 * @returns {PlayAlertContext|null}
 */
export function buildPlayAlertContext(allPlays, opts) {
  const alerts = buildPlayAlertContexts(allPlays, opts);
  const last = alerts.at(-1);
  if (!last) return null;
  return {
    text: last.text,
    kind: last.kind,
    atBatIndex: last.atBatIndex,
    playIndex: last.playIndex,
  };
}

/**
 * @param {object} [play]
 * @returns {string|null}
 */
function halfInningLabel(play) {
  if (!play?.about) return null;
  if (play.about.halfInning === 'top' || play.about.isTopInning === true) {
    return 'Top';
  }
  if (play.about.halfInning === 'bottom' || play.about.isTopInning === false) {
    return 'Bottom';
  }
  return null;
}

/**
 * @param {object[]} allPlays
 * @returns {number}
 */
export function maxAtBatIndex(allPlays) {
  let max = -1;
  for (const p of allPlays) {
    const idx = p.about?.atBatIndex;
    if (typeof idx === 'number' && idx > max) max = idx;
  }
  return max;
}

/**
 * Last scoring play in the full game (for Final alerts when the run was already posted).
 * @param {object[]} allPlays
 * @returns {{ play: object, context: ScoringPlayContext, atBatIndex: number }|null}
 */
export function lastScoringPlayInGame(allPlays) {
  return latestScoringPlayContext(allPlays, -1);
}

/**
 * Pick the latest scoring play since minIndex; falls back to last scoring play in game.
 * @param {object[]} allPlays
 * @param {number} minAtBatIndex
 * @returns {{ play: object, context: ScoringPlayContext, atBatIndex: number }|null}
 */
export function latestScoringPlayContext(allPlays, minAtBatIndex, opts = {}) {
  const { allowFallback = true } = opts;
  const recent = scoringPlaysSince(allPlays, minAtBatIndex);
  const play =
    recent.at(-1) ??
    (allowFallback
      ? allPlays.filter((p) => p.about?.isScoringPlay).at(-1)
      : undefined);

  if (!play) return null;

  const context = parseScoringPlay(play);
  if (!context) return null;

  return {
    play,
    context,
    atBatIndex: play.about?.atBatIndex ?? -1,
  };
}
