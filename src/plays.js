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
 * @typedef {object} PlayAlertContext
 * @property {string} text
 * @property {'scoring'|'ending'|'walkoff'} kind
 * @property {number} atBatIndex
 */

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
  const plays = findScoringPlaysInGap(
    allPlays,
    sinceIndex,
    null,
    null,
    awayScore,
    homeScore,
  );
  return plays.at(-1) ?? null;
}

/**
 * All scoring plays between the last seen at-bat and the current scoreboard.
 * Used so multiple runs in one poll interval each get their own alert.
 *
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
  const recent = allPlays
    .filter((p) => {
      const idx = p.about?.atBatIndex ?? -1;
      return idx > sinceIndex && isScoringPlay(p);
    })
    .sort(
      (a, b) => (a.about?.atBatIndex ?? 0) - (b.about?.atBatIndex ?? 0),
    );

  const inGap = recent.filter((p) => {
    const a = p.result?.awayScore;
    const h = p.result?.homeScore;
    if (typeof a !== 'number' || typeof h !== 'number') return true;

    if (typeof prevAway === 'number' && typeof prevHome === 'number') {
      if (a < prevAway || h < prevHome) return false;
      if (a === prevAway && h === prevHome) return false;
    }

    if (a > currAway || h > currHome) return false;
    return true;
  });

  if (inGap.length) return inGap;

  const exact = recent.filter(
    (p) =>
      p.result?.awayScore === currAway && p.result?.homeScore === currHome,
  );
  if (exact.length) return [exact.at(-1)];

  if (recent.length) return [recent.at(-1)];

  const fallback = allPlays.filter(
    (p) =>
      isScoringPlay(p) &&
      p.result?.awayScore === currAway &&
      p.result?.homeScore === currHome,
  );
  const last = fallback.at(-1);
  return last ? [last] : [];
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
    (p) =>
      (p.about?.atBatIndex ?? -1) > minAtBatIndex &&
      (p.about?.isScoringPlay || (p.result?.rbi ?? 0) > 0),
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

  const scorers = [
    ...new Set(
      (play.runners ?? [])
        .filter((r) => r.details?.isScoringEvent)
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
 * @param {ScoringPlayContext} ctx
 * @returns {string}
 */
export function formatScoringContext(ctx) {
  const hitLine = `${ctx.batter} (${ctx.event}) off ${ctx.pitcher}`;

  let runLine;
  if (ctx.scorers.length === 1) {
    runLine = `${ctx.scorers[0]} scores`;
  } else if (ctx.scorers.length > 1) {
    runLine = `${ctx.scorers.join(', ')} score`;
  } else if (ctx.rbi > 0) {
    runLine = `${ctx.rbi} RBI`;
  } else if (ctx.description) {
    const scorePart = ctx.description.split('.').find((s) => /scores?/i.test(s));
    runLine = scorePart?.trim() ?? ctx.description;
  } else {
    runLine = 'Run scored';
  }

  return `${hitLine} · ${runLine}`;
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
 * @property {number} awayScore
 * @property {number} homeScore
 * @property {number|null} [inning]
 * @property {string|null} [inningHalf]
 */

/**
 * Build one alert per scoring play in the poll gap (plus ending context on final).
 * @param {object[]} allPlays
 * @param {{
 *   scoreChanged: boolean,
 *   isFinalTransition: boolean,
 *   sinceIndex: number,
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
    game,
    prevAwayScore,
    prevHomeScore,
  },
) {
  /** @type {PlayAlertWithScore[]} */
  const alerts = [];

  if (scoreChanged) {
    const plays = findScoringPlaysInGap(
      allPlays,
      sinceIndex,
      prevAwayScore ?? null,
      prevHomeScore ?? null,
      game.awayScore,
      game.homeScore,
    );

    for (const play of plays) {
      const latest = scoringPlayToAlert(play);
      if (!latest) continue;

      const awayScore =
        typeof play.result?.awayScore === 'number'
          ? play.result.awayScore
          : game.awayScore;
      const homeScore =
        typeof play.result?.homeScore === 'number'
          ? play.result.homeScore
          : game.homeScore;

      let kind = 'scoring';
      if (
        isFinalTransition &&
        play === plays.at(-1) &&
        isWalkOffPlay(play, { ...game, awayScore, homeScore })
      ) {
        kind = 'walkoff';
      }

      alerts.push({
        text: formatScoringContext(latest.context),
        kind,
        atBatIndex: latest.atBatIndex,
        awayScore,
        homeScore,
        inning: play.about?.inning ?? null,
        inningHalf: halfInningLabel(play),
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
      const ctx = parseScoringPlay(lastPlay);
      if (ctx) {
        // Replace trailing scoring alert for the same at-bat, or append.
        const walkoff = {
          text: formatScoringContext(ctx),
          kind: /** @type {const} */ ('walkoff'),
          atBatIndex: lastPlay.about?.atBatIndex ?? -1,
          awayScore: game.awayScore,
          homeScore: game.homeScore,
          inning: lastPlay.about?.inning ?? game.inning,
          inningHalf: halfInningLabel(lastPlay) ?? game.inningHalf,
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
          awayScore: game.awayScore,
          homeScore: game.homeScore,
          inning: lastPlay?.about?.inning ?? game.inning,
          inningHalf: halfInningLabel(lastPlay) ?? game.inningHalf,
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
