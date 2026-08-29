export const DRAFT_METHODS = deepFreeze({
  simmons: [
    [1, 20, 26], [2, 16, 29], [3, 13, 30], [4, 18, 25], [5, 15, 27],
    [6, 19, 22], [7, 11, 28], [8, 17, 21], [9, 14, 23], [10, 12, 24],
  ],
  'el-dorado': [
    [1, 28, 30], [2, 21, 24], [3, 18, 22], [4, 17, 20], [5, 15, 23],
    [6, 14, 26], [7, 11, 29], [8, 16, 19], [9, 13, 25], [10, 12, 27],
  ],
});

const EXPECTED_PICK_COUNT = 30;
const EXPECTED_TEAM_COUNT = 32;
const EXPECTED_TEAMS_PER_PARTICIPANT = 3;
const NFL_SEASON_GAMES = 17;

export function equivalentWins({ wins, losses, ties }) {
  const games = wins + losses + ties;
  return games === 0 ? 0 : (wins / games) * NFL_SEASON_GAMES;
}

export function rankScores(scores) {
  const ranksByScore = new Map();
  [...new Set(scores)].sort((left, right) => right - left).forEach((score, index) => {
    ranksByScore.set(score, scores.filter((candidate) => candidate > score).length + 1);
  });
  return scores.map((score) => ranksByScore.get(score));
}

export function validateSeason(season, teamIds, participantIds) {
  const errors = [];
  const selections = Array.isArray(season?.selections) ? season.selections : [];
  const records = season?.records && typeof season.records === 'object' ? season.records : {};
  const method = season?.method;
  const methodSlots = typeof method === 'string' && Object.hasOwn(DRAFT_METHODS, method)
    ? DRAFT_METHODS[method]
    : undefined;
  const isTeamIdsArray = Array.isArray(teamIds);
  const uniqueTeamIds = new Set(isTeamIdsArray ? teamIds : []);
  const hasParticipantUniverse = participantIds !== undefined;
  const isParticipantIdsArray = Array.isArray(participantIds);
  const uniqueParticipantIds = new Set(isParticipantIdsArray ? participantIds : []);

  if (!isNonemptyId(season?.id)) errors.push('season.id must be a nonempty string.');
  if (!isNonemptyId(season?.label)) errors.push('season.label must be a nonempty string.');
  if (!Number.isInteger(season?.nflYear) || season.nflYear < 1000 || season.nflYear > 9999) {
    errors.push('season.nflYear must be a four-digit integer.');
  }

  if (!isTeamIdsArray || uniqueTeamIds.size !== EXPECTED_TEAM_COUNT || teamIds.length !== EXPECTED_TEAM_COUNT) {
    errors.push(`teamIds must list ${EXPECTED_TEAM_COUNT} unique team IDs.`);
  }

  if (hasParticipantUniverse
      && (!isParticipantIdsArray || uniqueParticipantIds.size !== participantIds.length)) {
    errors.push('participantIds must be an array of unique participant IDs.');
  }

  if (!methodSlots) {
    errors.push(`Unknown draft method: ${String(season?.method)}.`);
  }

  const picks = new Map();
  const draftedTeams = new Map();
  const participantSelections = new Map();

  for (const selection of selections) {
    const { pick, participantId, teamId } = selection ?? {};
    if (picks.has(pick)) {
      errors.push(`Duplicate draft pick: ${pick}.`);
    } else {
      picks.set(pick, selection);
    }

    if (draftedTeams.has(teamId)) {
      errors.push(`Duplicate drafted team: ${teamId}.`);
    } else {
      draftedTeams.set(teamId, selection);
    }

    if (!uniqueTeamIds.has(teamId)) {
      errors.push(`Drafted team is not in teamIds: ${teamId}.`);
    }

    if (hasParticipantUniverse && isParticipantIdsArray && !uniqueParticipantIds.has(participantId)) {
      errors.push(`Draft participant is not in participantIds: ${participantId}.`);
    }

    if (!participantSelections.has(participantId)) participantSelections.set(participantId, []);
    participantSelections.get(participantId).push(selection);
  }

  const hasExactPickCoverage = selections.length === EXPECTED_PICK_COUNT
    && picks.size === EXPECTED_PICK_COUNT
    && [...picks.keys()].every((pick) => Number.isInteger(pick) && pick >= 1 && pick <= EXPECTED_PICK_COUNT);
  if (!hasExactPickCoverage) {
    errors.push(`Draft picks must cover every pick from 1 through ${EXPECTED_PICK_COUNT} exactly once.`);
  }

  for (const [participantId, participantDrafts] of participantSelections) {
    if (participantDrafts.length !== EXPECTED_TEAMS_PER_PARTICIPANT) {
      errors.push(`Participant ${participantId} has ${participantDrafts.length} drafted teams; expected ${EXPECTED_TEAMS_PER_PARTICIPANT}.`);
    }
  }

  if (methodSlots) {
    for (const [participantId, participantDrafts] of participantSelections) {
      const participantPicks = participantDrafts.map(({ pick }) => pick).sort((left, right) => left - right);
      const matchesSlot = methodSlots.some((slotPicks) => sameNumbers(participantPicks, slotPicks));
      if (!matchesSlot) {
        errors.push(`Participant ${participantId} does not match the ${season.method} slot pattern.`);
      }
    }
  }

  for (const teamId of uniqueTeamIds) {
    if (!Object.hasOwn(records, teamId)) {
      errors.push(`Missing record for team: ${teamId}.`);
      continue;
    }

    const { wins, losses, ties } = records[teamId] ?? {};
    const values = [wins, losses, ties];
    if (!values.every((value) => Number.isFinite(value) && Number.isInteger(value) && value >= 0)) {
      errors.push(`Invalid record for team: ${teamId}; wins, losses, and ties must be finite nonnegative integers.`);
      continue;
    }

    const games = wins + losses + ties;
    if (games < 1 || games > NFL_SEASON_GAMES) {
      errors.push(`Invalid record for team: ${teamId}; total games must be between 1 and ${NFL_SEASON_GAMES}.`);
    }
  }
  for (const teamId of Object.keys(records)) {
    if (!uniqueTeamIds.has(teamId)) {
      errors.push(`Record exists for a team outside teamIds: ${teamId}.`);
    }
  }

  return errors;
}

export function deriveSeason(season, teamIds) {
  assertValidSeason(season, teamIds);

  const selectionsByParticipant = new Map();
  for (const selection of season.selections) {
    if (!selectionsByParticipant.has(selection.participantId)) {
      selectionsByParticipant.set(selection.participantId, []);
    }
    selectionsByParticipant.get(selection.participantId).push(selection);
  }

  const participants = [...selectionsByParticipant.entries()]
    .map(([participantId, selections]) => {
      const orderedSelections = [...selections].sort((left, right) => left.pick - right.pick);
      const picks = orderedSelections.map(({ pick }) => pick);
      const startingSlot = DRAFT_METHODS[season.method].findIndex((slotPicks) => sameNumbers(picks, slotPicks)) + 1;
      const rawPoolScore = orderedSelections.reduce(
        (total, { teamId }) => total + season.records[teamId].wins,
        0,
      );
      const equivalentScore = orderedSelections.reduce(
        (total, { teamId }) => total + equivalentWins(season.records[teamId]),
        0,
      );

      return {
        participantId,
        participantLabel: orderedSelections[0].sourceParticipantLabel,
        startingSlot,
        picks,
        teamIds: orderedSelections.map(({ teamId }) => teamId),
        rawPoolScore,
        equivalentScore,
      };
    })
    .sort((left, right) => left.startingSlot - right.startingSlot);
  const ranks = rankScores(participants.map(({ rawPoolScore }) => rawPoolScore));

  return {
    id: season.id,
    label: season.label,
    nflYear: season.nflYear,
    method: season.method,
    participants: participants.map((participant, index) => ({
      ...participant,
      rank: ranks[index],
      champion: ranks[index] === 1,
    })),
    undraftedTeamIds: teamIds.filter((teamId) => !season.selections.some((selection) => selection.teamId === teamId)),
  };
}

export function calculatePickRegrets(season) {
  assertStandaloneSeason(season);
  const availableTeamIds = new Set(Object.keys(season.records));
  const picks = orderedSelections(season).map((selection) => {
    const candidates = [...availableTeamIds];
    const bestAvailableWins = Math.max(...candidates.map((teamId) => season.records[teamId].wins));
    const bestAvailableTeamIds = candidates
      .filter((teamId) => season.records[teamId].wins === bestAvailableWins)
      .sort(compareIds);
    const selectedWins = season.records[selection.teamId].wins;
    availableTeamIds.delete(selection.teamId);

    return {
      pick: selection.pick,
      participantId: selection.participantId,
      selectedTeamId: selection.teamId,
      selectedWins,
      bestAvailableWins,
      bestAvailableTeamIds,
      regret: bestAvailableWins - selectedWins,
    };
  });

  return {
    perspective: 'one-change-hindsight',
    seasonId: season.id,
    picks,
  };
}

export function replayPerfectDraft(season) {
  assertStandaloneSeason(season);
  const actualSelections = orderedSelections(season);
  const rankedTeams = Object.keys(season.records).sort((left, right) => {
    const winDifference = season.records[right].wins - season.records[left].wins;
    return winDifference || compareIds(left, right);
  });
  const selections = actualSelections.map((selection, index) => ({
    ...selection,
    teamId: rankedTeams[index],
  }));
  const replaySeason = { ...season, selections };
  const derived = deriveSeason(replaySeason, Object.keys(season.records));
  const slotsByParticipantId = new Map(derived.participants.map(
    ({ participantId, startingSlot }) => [participantId, startingSlot],
  ));

  return {
    perspective: 'perfect-hindsight',
    seasonId: season.id,
    selections: selections.map((selection, index) => ({
      pick: selection.pick,
      participantId: selection.participantId,
      startingSlot: slotsByParticipantId.get(selection.participantId),
      actualTeamId: actualSelections[index].teamId,
      teamId: selection.teamId,
      rawWins: season.records[selection.teamId].wins,
      equivalentWins: equivalentWins(season.records[selection.teamId]),
    })),
    participants: derived.participants,
    undraftedTeamIds: derived.undraftedTeamIds.sort(compareIds),
  };
}

export function summarizeChampions(historyData) {
  const { teamIds } = assertValidHistory(historyData);
  return {
    perspective: 'actual-results',
    seasons: orderedSeasons(historyData).map((season) => {
      const derived = deriveSeason(season, teamIds);
      return {
        seasonId: season.id,
        label: season.label,
        nflYear: season.nflYear,
        method: season.method,
        champions: derived.participants
          .filter(({ champion }) => champion)
          .map(({ participantId, participantLabel, rawPoolScore, startingSlot }) => ({
            participantId,
            participantLabel,
            rawPoolScore,
            startingSlot,
          })),
      };
    }),
  };
}

export function summarizePickPositions(historyData) {
  assertValidHistory(historyData);
  const seasons = orderedSeasons(historyData);
  return {
    picks: Array.from({ length: EXPECTED_PICK_COUNT }, (_, index) => {
      const pick = index + 1;
      const values = seasons.map((season) => {
        const selection = season.selections.find((candidate) => candidate.pick === pick);
        const record = season.records[selection.teamId];
        return {
          seasonId: season.id,
          raw: record.wins,
          equivalent: equivalentWins(record),
        };
      });
      const rawValues = values.map(({ seasonId, raw: value }) => ({ seasonId, value }));
      const equivalentValues = values.map(({ seasonId, equivalent: value }) => ({ seasonId, value }));

      return {
        pick,
        rawValues,
        equivalentValues,
        rawAverage: mean(rawValues.map(({ value }) => value)),
        equivalentAverage: mean(equivalentValues.map(({ value }) => value)),
        sampleCount: values.length,
      };
    }),
  };
}

export function summarizeLateBoard(historyData) {
  const { teamIds } = assertValidHistory(historyData);
  const seasons = orderedSeasons(historyData).map((season) => {
    const draftedTeamIds = new Set(season.selections.map(({ teamId }) => teamId));
    const latePicks = orderedSelections(season)
      .filter(({ pick }) => pick >= 28 && pick <= 30)
      .map(({ pick, participantId, teamId }) => teamValue(season, { pick, participantId, teamId }));
    const undraftedTeams = teamIds
      .filter((teamId) => !draftedTeamIds.has(teamId))
      .sort(compareIds)
      .map((teamId) => teamValue(season, { teamId }));
    const minimumLateWins = Math.min(...latePicks.map(({ rawWins }) => rawWins));

    return {
      seasonId: season.id,
      label: season.label,
      nflYear: season.nflYear,
      method: season.method,
      latePicks,
      undraftedTeams,
      notableMissTeamIds: undraftedTeams
        .filter(({ rawWins }) => rawWins > minimumLateWins)
        .map(({ teamId }) => teamId),
    };
  });
  const allLatePicks = seasons.flatMap(({ latePicks }) => latePicks);
  const allUndraftedTeams = seasons.flatMap(({ undraftedTeams }) => undraftedTeams);

  return {
    seasons,
    overall: {
      late: valueMeans(allLatePicks),
      undrafted: valueMeans(allUndraftedTeams),
    },
  };
}

export function buildCareerStats(historyData) {
  const { teamIds } = assertValidHistory(historyData);
  const careers = new Map(historyData.participants.map((participant) => [participant.id, {
    participantId: participant.id,
    displayName: participant.displayName ?? participant.label ?? participant.id,
    titles: 0,
    seasons: [],
    selections: [],
    regrets: [],
  }]));

  for (const season of orderedSeasons(historyData)) {
    const derived = deriveSeason(season, teamIds);
    const regretsByPick = new Map(calculatePickRegrets(season).picks.map((pick) => [pick.pick, pick]));
    for (const participant of derived.participants) {
      const career = careers.get(participant.participantId);
      career.titles += participant.champion ? 1 : 0;
      career.seasons.push({
        seasonId: season.id,
        nflYear: season.nflYear,
        rawPoolScore: participant.rawPoolScore,
        equivalentPoolScore: participant.equivalentScore,
        rank: participant.rank,
      });
      for (const selection of orderedSelections(season).filter(
        ({ participantId }) => participantId === participant.participantId,
      )) {
        const record = season.records[selection.teamId];
        career.selections.push({
          seasonId: season.id,
          nflYear: season.nflYear,
          pick: selection.pick,
          teamId: selection.teamId,
          rawWins: record.wins,
          equivalentWins: equivalentWins(record),
        });
        career.regrets.push(regretsByPick.get(selection.pick).regret);
      }
    }
  }

  return [...careers.values()]
    .map((career) => {
      const bestRawSeason = maximumBy(career.seasons, ({ rawPoolScore }) => rawPoolScore);
      const bestSelection = maximumBy(career.selections, ({ rawWins }) => rawWins);
      return {
        participantId: career.participantId,
        displayName: career.displayName,
        titles: career.titles,
        seasonsPlayed: career.seasons.length,
        averageFinish: mean(career.seasons.map(({ rank }) => rank)),
        averageEquivalentPoolScore: mean(
          career.seasons.map(({ equivalentPoolScore }) => equivalentPoolScore),
        ),
        bestRawSeason,
        bestSelection,
        averageHindsightRegret: mean(career.regrets),
      };
    })
    .sort((left, right) => (
      right.titles - left.titles
      || nullableNumber(left.averageFinish) - nullableNumber(right.averageFinish)
      || compareIds(left.displayName, right.displayName)
      || compareIds(left.participantId, right.participantId)
    ));
}

export function summarizeMethods(historyData) {
  const { teamIds } = assertValidHistory(historyData);
  const result = {};

  for (const method of Object.keys(DRAFT_METHODS)) {
    const seasons = orderedSeasons(historyData).filter((season) => season.method === method);
    const actualSeasons = seasons.map((season) => deriveSeason(season, teamIds));
    const replayedDrafts = seasons.map((season) => replayPerfectDraft(season));
    const replaySeasons = seasons.map((season, index) => ({
      ...season,
      selections: replayedDrafts[index].selections.map(({ pick, participantId, teamId }) => {
        const actual = season.selections.find((selection) => selection.pick === pick);
        return { ...actual, participantId, teamId };
      }),
    }));

    result[method] = {
      sampleCount: seasons.length,
      championSlots: actualSeasons.flatMap(({ participants }) => participants
        .filter(({ champion }) => champion)
        .map(({ startingSlot }) => startingSlot)),
      actual: {
        slots: summarizeSlots(actualSeasons),
        lateBoard: summarizeLateBoard({ ...historyData, seasons }).overall,
      },
      perfectHindsight: {
        slots: summarizeSlots(replayedDrafts),
        lateBoard: summarizeLateBoard({ ...historyData, seasons: replaySeasons }).overall,
      },
    };
  }

  return result;
}

function summarizeSlots(seasons) {
  return Array.from({ length: 10 }, (_, index) => {
    const startingSlot = index + 1;
    const participants = seasons.map(({ participants }) => participants.find(
      (participant) => participant.startingSlot === startingSlot,
    ));
    const rawValues = participants.map(({ rawPoolScore }) => rawPoolScore);
    const equivalentValues = participants.map(({ equivalentScore }) => equivalentScore);
    return {
      startingSlot,
      sampleCount: participants.length,
      rawValues,
      equivalentValues,
      rawAverage: mean(rawValues),
      equivalentAverage: mean(equivalentValues),
      equivalentVariance: populationVariance(equivalentValues),
    };
  });
}

function assertStandaloneSeason(season) {
  const records = season?.records && typeof season.records === 'object' ? season.records : {};
  assertValidSeason(season, Object.keys(records));
}

function assertValidHistory(historyData) {
  const errors = [];
  const teams = Array.isArray(historyData?.teams) ? historyData.teams : [];
  const participants = Array.isArray(historyData?.participants) ? historyData.participants : [];
  const seasons = Array.isArray(historyData?.seasons) ? historyData.seasons : [];
  const teamIds = teams.map((team) => team?.id);
  const participantIds = participants.map((participant) => participant?.id);
  const seasonIds = seasons.map((season) => season?.id);

  if (!Array.isArray(historyData?.teams)
      || teamIds.length !== EXPECTED_TEAM_COUNT
      || new Set(teamIds).size !== EXPECTED_TEAM_COUNT
      || !teamIds.every(isNonemptyId)) {
    errors.push(`historyData.teams must list exactly ${EXPECTED_TEAM_COUNT} unique nonempty team IDs.`);
  }
  if (!Array.isArray(historyData?.participants)
      || new Set(participantIds).size !== participantIds.length
      || !participantIds.every(isNonemptyId)) {
    errors.push('historyData.participants must list unique nonempty participant IDs.');
  }
  if (!Array.isArray(historyData?.seasons)) {
    errors.push('historyData.seasons must be an array.');
  } else {
    const duplicateSeasonIds = [...new Set(seasonIds.filter((id, index) => (
      isNonemptyId(id) && seasonIds.indexOf(id) !== index
    )))];
    if (duplicateSeasonIds.length > 0) {
      errors.push(`historyData.seasons must have unique season IDs: ${duplicateSeasonIds.join(', ')}.`);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Invalid history data');
  }

  for (const season of seasons) {
    assertValidSeason(season, teamIds, participantIds);
  }
  return { teamIds, participantIds };
}

function assertValidSeason(season, teamIds, participantIds) {
  const errors = validateSeason(season, teamIds, participantIds);
  if (errors.length > 0) {
    throw new AggregateError(errors, `Invalid season ${season?.id ?? '(unknown)'}`);
  }
}

function isNonemptyId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function orderedSelections(season) {
  return [...season.selections].sort((left, right) => left.pick - right.pick);
}

function orderedSeasons(historyData) {
  return [...historyData.seasons].sort((left, right) => (
    left.nflYear - right.nflYear || compareIds(left.id, right.id)
  ));
}

function teamValue(season, { pick, participantId, teamId }) {
  const record = season.records[teamId];
  return {
    ...(pick === undefined ? {} : { pick }),
    ...(participantId === undefined ? {} : { participantId }),
    teamId,
    rawWins: record.wins,
    equivalentWins: equivalentWins(record),
  };
}

function valueMeans(values) {
  return {
    sampleCount: values.length,
    rawMean: mean(values.map(({ rawWins }) => rawWins)),
    equivalentMean: mean(values.map(({ equivalentWins: value }) => value)),
  };
}

function mean(values) {
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function populationVariance(values) {
  const average = mean(values);
  return average === null
    ? null
    : values.reduce((total, value) => total + ((value - average) ** 2), 0) / values.length;
}

function maximumBy(values, valueOf) {
  return values.reduce((maximum, value) => (
    maximum === null || valueOf(value) > valueOf(maximum) ? value : maximum
  ), null);
}

function nullableNumber(value) {
  return value === null ? Number.POSITIVE_INFINITY : value;
}

function compareIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameNumbers(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  }
  return Object.freeze(value);
}
