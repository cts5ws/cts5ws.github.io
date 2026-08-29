import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DRAFT_METHODS,
  buildCareerStats,
  calculatePickRegrets,
  deriveSeason,
  equivalentWins,
  rankScores,
  replayPerfectDraft,
  summarizeChampions,
  summarizeLateBoard,
  summarizeMethods,
  summarizePickPositions,
  validateSeason,
} from './history-analytics.mjs';
import { HISTORY_DATA } from './history-data.mjs';

const TEAM_IDS = Array.from({ length: 32 }, (_, index) => `team-${String(index + 1).padStart(2, '0')}`);

const PARTICIPANTS = Array.from({ length: 10 }, (_, index) => ({
  id: `participant-${index + 1}`,
  label: `Participant ${index + 1}`,
}));

const PARTICIPANT_IDS = PARTICIPANTS.map(({ id }) => id);

function createSeason(overrides = {}) {
  const method = overrides.method ?? 'simmons';
  const selections = DRAFT_METHODS[method].flatMap((picks, slotIndex) =>
    picks.map((pick) => ({
      pick,
      participantId: PARTICIPANTS[slotIndex].id,
      sourceParticipantLabel: PARTICIPANTS[slotIndex].label,
      teamId: TEAM_IDS[pick - 1],
      sourceTeamLabel: `Team ${pick}`,
    })),
  );
  const records = Object.fromEntries(TEAM_IDS.map((teamId, index) => [teamId, {
    abbreviation: `T${String(index + 1).padStart(2, '0')}`,
    displayName: `Team ${index + 1}`,
    wins: index === 0 ? 8 : index === 1 ? 7 : 0,
    losses: index === 0 ? 8 : index === 1 ? 9 : 17,
    ties: 0,
  }]));

  return {
    id: '2025',
    label: '2025 Season',
    nflYear: 2025,
    method,
    selections,
    records,
    ...overrides,
  };
}

function createHistory(seasons, participants = PARTICIPANTS) {
  return {
    participants,
    teams: TEAM_IDS.map((id, index) => ({
      id,
      currentAbbreviation: `T${String(index + 1).padStart(2, '0')}`,
      currentName: `Team ${index + 1}`,
    })),
    seasons,
  };
}

function setRecordWins(season, teamId, wins, games = 17) {
  season.records[teamId] = {
    ...season.records[teamId],
    wins,
    losses: games - wins,
    ties: 0,
  };
}

function assertAggregateValidationError(operation, pattern, messagePattern = /Invalid season/) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, messagePattern);
    assert.match(error.errors.join('\n'), pattern);
    return true;
  });
}

function assertAllNumbersFinite(value, path = 'result') {
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${path} must be finite, received ${value}`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assertAllNumbersFinite(child, `${path}.${key}`);
  }
}

test('DRAFT_METHODS contains the exact normalized Simmons and El Dorado slot assignments', () => {
  assert.deepEqual(DRAFT_METHODS, {
    simmons: [
      [1, 20, 26], [2, 16, 29], [3, 13, 30], [4, 18, 25], [5, 15, 27],
      [6, 19, 22], [7, 11, 28], [8, 17, 21], [9, 14, 23], [10, 12, 24],
    ],
    'el-dorado': [
      [1, 28, 30], [2, 21, 24], [3, 18, 22], [4, 17, 20], [5, 15, 23],
      [6, 14, 26], [7, 11, 29], [8, 16, 19], [9, 13, 25], [10, 12, 27],
    ],
  });
});

test('DRAFT_METHODS is deeply immutable', () => {
  const originalMethod = DRAFT_METHODS.simmons;
  const originalPick = originalMethod[0][0];

  try {
    assert.throws(() => {
      DRAFT_METHODS.simmons = [];
    }, TypeError);
    assert.throws(() => {
      DRAFT_METHODS.simmons.push([31, 32, 33]);
    }, TypeError);
    assert.throws(() => {
      DRAFT_METHODS.simmons[0][0] = 99;
    }, TypeError);
  } finally {
    if (DRAFT_METHODS.simmons !== originalMethod) DRAFT_METHODS.simmons = originalMethod;
    if (originalMethod[0][0] !== originalPick) originalMethod[0][0] = originalPick;
  }
});

test('rankScores uses competition ranking for tied scores', () => {
  assert.deepEqual(rankScores([30, 28, 28]), [1, 2, 2]);
});

test('equivalentWins preserves fractional ties without rounding', () => {
  assert.equal(equivalentWins({ wins: 8, losses: 8, ties: 0 }), 8.5);
  assert.equal(equivalentWins({ wins: 8, losses: 7, ties: 1 }), 8.5);
});

test('deriveSeason ranks and selects champions by raw pool score, not equivalent score', () => {
  const season = createSeason();
  season.records['team-02'] = {
    ...season.records['team-02'],
    wins: 7,
    losses: 0,
    ties: 0,
  };

  const [first, second] = deriveSeason(season, TEAM_IDS).participants;
  assert.deepEqual(
    [first.rawPoolScore, first.equivalentScore, first.rank, first.champion],
    [8, 8.5, 1, true],
  );
  assert.deepEqual(
    [second.rawPoolScore, second.equivalentScore, second.rank, second.champion],
    [7, 17, 2, false],
  );
});

test('deriveSeason derives slots, scores, ranks, champions, and undrafted teams', () => {
  const season = createSeason();
  const derived = deriveSeason(season, TEAM_IDS);

  assert.equal(derived.participants.length, 10);
  assert.deepEqual(derived.participants.map(({ participantId, startingSlot, picks, rawPoolScore, equivalentScore, rank, champion }) => ({
    participantId,
    startingSlot,
    picks,
    rawPoolScore,
    equivalentScore,
    rank,
    champion,
  })), [
    { participantId: 'participant-1', startingSlot: 1, picks: [1, 20, 26], rawPoolScore: 8, equivalentScore: 8.5, rank: 1, champion: true },
    { participantId: 'participant-2', startingSlot: 2, picks: [2, 16, 29], rawPoolScore: 7, equivalentScore: 7.4375, rank: 2, champion: false },
    { participantId: 'participant-3', startingSlot: 3, picks: [3, 13, 30], rawPoolScore: 0, equivalentScore: 0, rank: 3, champion: false },
    { participantId: 'participant-4', startingSlot: 4, picks: [4, 18, 25], rawPoolScore: 0, equivalentScore: 0, rank: 3, champion: false },
    { participantId: 'participant-5', startingSlot: 5, picks: [5, 15, 27], rawPoolScore: 0, equivalentScore: 0, rank: 3, champion: false },
    { participantId: 'participant-6', startingSlot: 6, picks: [6, 19, 22], rawPoolScore: 0, equivalentScore: 0, rank: 3, champion: false },
    { participantId: 'participant-7', startingSlot: 7, picks: [7, 11, 28], rawPoolScore: 0, equivalentScore: 0, rank: 3, champion: false },
    { participantId: 'participant-8', startingSlot: 8, picks: [8, 17, 21], rawPoolScore: 0, equivalentScore: 0, rank: 3, champion: false },
    { participantId: 'participant-9', startingSlot: 9, picks: [9, 14, 23], rawPoolScore: 0, equivalentScore: 0, rank: 3, champion: false },
    { participantId: 'participant-10', startingSlot: 10, picks: [10, 12, 24], rawPoolScore: 0, equivalentScore: 0, rank: 3, champion: false },
  ]);
  assert.deepEqual(derived.undraftedTeamIds, ['team-31', 'team-32']);
  assert.deepEqual(season, createSeason(), 'derivation does not mutate its inputs');
});

test('validateSeason accepts a complete valid season', () => {
  assert.deepEqual(validateSeason(createSeason(), TEAM_IDS), []);
  assert.deepEqual(validateSeason(createSeason(), TEAM_IDS, PARTICIPANT_IDS), []);
});

test('validateSeason rejects malformed season identity metadata with actionable errors', () => {
  const invalid = createSeason({ id: '  ', label: '', nflYear: '<b>2025</b>' });
  const errors = validateSeason(invalid, TEAM_IDS).join('\n');

  assert.match(errors, /season\.id must be a nonempty string/);
  assert.match(errors, /season\.label must be a nonempty string/);
  assert.match(errors, /season\.nflYear must be a four-digit integer/);

  const outOfShape = createSeason({ nflYear: 999 });
  assert.match(validateSeason(outOfShape, TEAM_IDS).join('\n'), /season\.nflYear must be a four-digit integer/);
});

test('validateSeason rejects selections outside the optional participant universe', () => {
  const season = createSeason();
  season.selections[0] = { ...season.selections[0], participantId: 'unknown-participant' };

  assert.match(
    validateSeason(season, TEAM_IDS, PARTICIPANT_IDS).join('\n'),
    /Draft participant is not in participantIds: unknown-participant/,
  );
});

test('validateSeason rejects invalid optional participant-universe arrays', () => {
  assert.match(
    validateSeason(createSeason(), TEAM_IDS, 'participant-1').join('\n'),
    /participantIds must be an array of unique participant IDs/,
  );
  assert.match(
    validateSeason(createSeason(), TEAM_IDS, [...PARTICIPANT_IDS, 'participant-1']).join('\n'),
    /participantIds must be an array of unique participant IDs/,
  );
});

test('validateSeason reports duplicate picks and duplicate drafted teams', () => {
  const season = createSeason();
  season.selections[1] = { ...season.selections[1], pick: 1, teamId: 'team-01' };

  assert.match(validateSeason(season, TEAM_IDS).join('\n'), /Duplicate draft pick: 1/);
  assert.match(validateSeason(season, TEAM_IDS).join('\n'), /Duplicate drafted team: team-01/);
});

test('validateSeason reports missing records', () => {
  const season = createSeason();
  delete season.records['team-01'];

  assert.match(validateSeason(season, TEAM_IDS).join('\n'), /Missing record for team: team-01/);
});

test('validateSeason reports invalid team-specific record values and game totals', () => {
  const season = createSeason();
  season.records['team-01'] = { ...season.records['team-01'], wins: '8' };
  season.records['team-02'] = { ...season.records['team-02'], losses: Number.NaN };
  season.records['team-03'] = { ...season.records['team-03'], ties: Infinity };
  season.records['team-04'] = { ...season.records['team-04'], wins: -1 };
  season.records['team-05'] = { ...season.records['team-05'], losses: 1.5 };
  season.records['team-06'] = { ...season.records['team-06'], wins: 10, losses: 8, ties: 0 };

  const errors = validateSeason(season, TEAM_IDS).join('\n');
  for (const teamId of ['team-01', 'team-02', 'team-03', 'team-04', 'team-05']) {
    assert.match(errors, new RegExp(`Invalid record for team: ${teamId}; wins, losses, and ties must be finite nonnegative integers`));
  }
  assert.match(errors, /Invalid record for team: team-06; total games must be between 1 and 17/);
});

test('validateSeason reports a wrong method pattern', () => {
  const season = createSeason();
  [season.selections[0].participantId, season.selections[3].participantId] = [
    season.selections[3].participantId,
    season.selections[0].participantId,
  ];

  assert.match(validateSeason(season, TEAM_IDS).join('\n'), /does not match the simmons slot pattern/);
});

test('validateSeason safely rejects prototype-colliding method IDs', () => {
  for (const method of ['toString', 'constructor', '__proto__']) {
    const season = createSeason();
    season.method = method;

    let errors;
    assert.doesNotThrow(() => {
      errors = validateSeason(season, TEAM_IDS);
    });
    assert.match(errors.join('\n'), new RegExp(`Unknown draft method: ${method}`));
  }
});

test('validateSeason reports participant team counts other than three', () => {
  const season = createSeason();
  season.selections[0] = { ...season.selections[0], participantId: 'participant-2' };

  assert.match(validateSeason(season, TEAM_IDS).join('\n'), /Participant participant-1 has 2 drafted teams; expected 3/);
  assert.match(validateSeason(season, TEAM_IDS).join('\n'), /Participant participant-2 has 4 drafted teams; expected 3/);
});

test('validateSeason reports incomplete pick coverage', () => {
  const season = createSeason();
  season.selections[0] = { ...season.selections[0], pick: 31 };

  assert.match(validateSeason(season, TEAM_IDS).join('\n'), /Draft picks must cover every pick from 1 through 30 exactly once/);
});

test('validateSeason reports team-universe inconsistencies', () => {
  const season = createSeason();
  const badTeamIds = [...TEAM_IDS.slice(0, 31), 'team-31'];
  season.selections[0] = { ...season.selections[0], teamId: 'unknown-team' };
  season.records['unknown-team'] = { ...season.records['team-01'] };

  const errors = validateSeason(season, badTeamIds).join('\n');
  assert.match(errors, /teamIds must list 32 unique team IDs/);
  assert.match(errors, /Drafted team is not in teamIds: unknown-team/);
  assert.match(errors, /Record exists for a team outside teamIds: unknown-team/);
});

test('deriveSeason throws an AggregateError when validation fails', () => {
  const season = createSeason();
  season.method = 'Unknown';

  assert.throws(() => deriveSeason(season, TEAM_IDS), AggregateError);
});

test('calculatePickRegrets uses the actual prior picks and retains every tied best team', () => {
  const season = createSeason();
  const pick1 = season.selections.find(({ pick }) => pick === 1);
  const pick2 = season.selections.find(({ pick }) => pick === 2);
  [pick1.teamId, pick2.teamId] = [pick2.teamId, pick1.teamId];
  setRecordWins(season, 'team-32', 8);
  const snapshot = structuredClone(season);

  const result = calculatePickRegrets(season);

  assert.equal(result.perspective, 'one-change-hindsight');
  assert.equal(result.seasonId, '2025');
  assert.equal(result.picks.length, 30);
  assert.deepEqual(result.picks[0], {
    pick: 1,
    participantId: 'participant-1',
    selectedTeamId: 'team-02',
    selectedWins: 7,
    bestAvailableWins: 8,
    bestAvailableTeamIds: ['team-01', 'team-32'],
    regret: 1,
  });
  assert.deepEqual(result.picks[1].bestAvailableTeamIds, ['team-01', 'team-32']);
  assert.deepEqual(season, snapshot);
});

test('per-season advanced APIs reject malformed record universes and non-finite records', () => {
  for (const operation of [calculatePickRegrets, replayPerfectDraft]) {
    const nonFinite = createSeason();
    nonFinite.records['team-01'] = { ...nonFinite.records['team-01'], wins: Infinity };
    assertAggregateValidationError(
      () => operation(nonFinite),
      /Invalid record for team: team-01/,
    );

    const incomplete = createSeason();
    delete incomplete.records['team-32'];
    assertAggregateValidationError(
      () => operation(incomplete),
      /teamIds must list 32 unique team IDs/,
    );
  }
});

test('replayPerfectDraft chooses the highest-win remaining team with stable team-ID ties', () => {
  const season = createSeason();
  const pick1 = season.selections.find(({ pick }) => pick === 1);
  const pick2 = season.selections.find(({ pick }) => pick === 2);
  [pick1.teamId, pick2.teamId] = [pick2.teamId, pick1.teamId];
  setRecordWins(season, 'team-32', 8);

  const result = replayPerfectDraft(season);

  assert.equal(result.perspective, 'perfect-hindsight');
  assert.deepEqual(result.selections.slice(0, 3).map(({ pick, participantId, actualTeamId, teamId, rawWins }) => ({
    pick, participantId, actualTeamId, teamId, rawWins,
  })), [
    { pick: 1, participantId: 'participant-1', actualTeamId: 'team-02', teamId: 'team-01', rawWins: 8 },
    { pick: 2, participantId: 'participant-2', actualTeamId: 'team-01', teamId: 'team-32', rawWins: 8 },
    { pick: 3, participantId: 'participant-3', actualTeamId: 'team-03', teamId: 'team-02', rawWins: 7 },
  ]);
  assert.equal(new Set(result.selections.map(({ teamId }) => teamId)).size, 30);
  assert.deepEqual(result.undraftedTeamIds, ['team-30', 'team-31']);
  assert.equal(result.undraftedTeamIds.length, 2);
  assert.deepEqual(result.participants.map(({ startingSlot }) => startingSlot), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('perfect replay stays separate from actual results', () => {
  const season = createSeason();
  const pick1 = season.selections.find(({ pick }) => pick === 1);
  const pick2 = season.selections.find(({ pick }) => pick === 2);
  [pick1.teamId, pick2.teamId] = [pick2.teamId, pick1.teamId];
  const snapshot = structuredClone(season);

  const actual = deriveSeason(season, TEAM_IDS);
  const replay = replayPerfectDraft(season);

  assert.equal(replay.perspective, 'perfect-hindsight');
  assert.equal(actual.participants[0].teamIds[0], 'team-02');
  assert.equal(replay.participants[0].teamIds[0], 'team-01');
  assert.deepEqual(season, snapshot);
});

test('summarizeChampions returns chronological actual champions with raw scores, slots, and methods', () => {
  const result = summarizeChampions(HISTORY_DATA);

  assert.equal(result.perspective, 'actual-results');
  assert.deepEqual(result.seasons.map(({ nflYear, method }) => [nflYear, method]), [
    [2019, 'simmons'],
    [2021, 'el-dorado'],
    [2022, 'el-dorado'],
    [2023, 'el-dorado'],
    [2024, 'el-dorado'],
    [2025, 'simmons'],
  ]);
  assert.deepEqual(result.seasons.at(-1).champions, [{
    participantId: 'cole',
    participantLabel: 'Cole',
    rawPoolScore: 34,
    startingSlot: 6,
  }]);
});

test('history-wide advanced APIs reject non-finite records through one validation boundary', () => {
  const operations = [
    summarizeChampions,
    summarizePickPositions,
    summarizeLateBoard,
    buildCareerStats,
    summarizeMethods,
  ];

  for (const operation of operations) {
    const season = createSeason();
    season.records['team-01'] = { ...season.records['team-01'], losses: Number.NaN };
    const history = createHistory([season]);
    assertAggregateValidationError(
      () => operation(history),
      /Invalid record for team: team-01/,
    );
  }
});

test('every history-wide API rejects duplicate season IDs through the central boundary', () => {
  const operations = [
    summarizeChampions,
    summarizePickPositions,
    summarizeLateBoard,
    buildCareerStats,
    summarizeMethods,
  ];
  const history = createHistory([
    createSeason(),
    createSeason({ id: '2025', label: 'Duplicate ID', nflYear: 2026 }),
  ]);

  for (const operation of operations) {
    assertAggregateValidationError(
      () => operation(history),
      /historyData\.seasons must have unique season IDs: 2025/,
      /Invalid history data/,
    );
  }
});

test('history-wide advanced APIs validate selections against declared participant IDs', () => {
  const operations = [
    summarizeChampions,
    summarizePickPositions,
    summarizeLateBoard,
    buildCareerStats,
    summarizeMethods,
  ];

  for (const operation of operations) {
    const season = createSeason();
    for (const selection of season.selections) {
      if (selection.participantId === 'participant-1') selection.participantId = 'undeclared';
    }
    const history = createHistory([season]);
    assertAggregateValidationError(
      () => operation(history),
      /Draft participant is not in participantIds: undeclared/,
    );
  }
});

test('history-wide advanced APIs reject invalid declared universes even with no seasons', () => {
  const operations = [
    summarizeChampions,
    summarizePickPositions,
    summarizeLateBoard,
    buildCareerStats,
    summarizeMethods,
  ];
  const incompleteTeams = createHistory([]);
  incompleteTeams.teams = incompleteTeams.teams.slice(0, 31);
  const duplicateParticipants = createHistory([], [
    ...PARTICIPANTS,
    { id: PARTICIPANTS[0].id, displayName: 'Duplicate ID' },
  ]);

  for (const operation of operations) {
    assertAggregateValidationError(
      () => operation(incompleteTeams),
      /teams must list exactly 32 unique nonempty team IDs/,
      /Invalid history data/,
    );
    assertAggregateValidationError(
      () => operation(duplicateParticipants),
      /participants must list unique nonempty participant IDs/,
      /Invalid history data/,
    );
  }
});

test('summarizePickPositions keeps raw and equivalent season values explicit without rounding', () => {
  const result = summarizePickPositions(HISTORY_DATA);

  assert.equal(result.picks.length, 30);
  for (const pick of result.picks) {
    assert.equal(pick.sampleCount, 6);
    assert.equal(pick.rawValues.length, 6);
    assert.equal(pick.equivalentValues.length, 6);
    assert.deepEqual(pick.rawValues.map(({ seasonId }) => seasonId), ['2019', '2021', '2022', '2023', '2024', '2025']);
  }
  const pick1 = result.picks[0];
  assert.equal(pick1.rawAverage, pick1.rawValues.reduce((sum, { value }) => sum + value, 0) / 6);
  assert.equal(
    pick1.equivalentAverage,
    pick1.equivalentValues.reduce((sum, { value }) => sum + value, 0) / 6,
  );
  assert.ok(pick1.equivalentValues.some(({ value }, index) => value !== pick1.rawValues[index].value));
});

test('summarizeLateBoard reports all late and undrafted values and uses a strict notable-miss comparison', () => {
  const season = createSeason();
  for (const pick of [28, 29, 30]) {
    const { teamId } = season.selections.find((selection) => selection.pick === pick);
    setRecordWins(season, teamId, 2);
  }
  setRecordWins(season, 'team-31', 2);
  setRecordWins(season, 'team-32', 3);

  const result = summarizeLateBoard(createHistory([season]));
  const seasonResult = result.seasons[0];

  assert.deepEqual(seasonResult.latePicks.map(({ pick, rawWins, equivalentWins: normalized }) => [pick, rawWins, normalized]), [
    [28, 2, 2], [29, 2, 2], [30, 2, 2],
  ]);
  assert.deepEqual(seasonResult.undraftedTeams.map(({ teamId, rawWins, equivalentWins: normalized }) => [teamId, rawWins, normalized]), [
    ['team-31', 2, 2], ['team-32', 3, 3],
  ]);
  assert.deepEqual(seasonResult.notableMissTeamIds, ['team-32']);
  assert.deepEqual(result.overall, {
    late: { sampleCount: 3, rawMean: 2, equivalentMean: 2 },
    undrafted: { sampleCount: 2, rawMean: 2.5, equivalentMean: 2.5 },
  });
});

test('buildCareerStats includes declared nonparticipants with deterministic null averages', () => {
  const declared = [
    ...PARTICIPANTS,
    { id: 'participant-11', displayName: 'Zed' },
    { id: 'participant-12', displayName: 'Amy' },
  ];
  const result = buildCareerStats(createHistory([createSeason()], declared));

  assert.equal(result.length, 12);
  assert.deepEqual(result.slice(-2), [
    {
      participantId: 'participant-12', displayName: 'Amy', titles: 0, seasonsPlayed: 0,
      averageFinish: null, averageEquivalentPoolScore: null, bestRawSeason: null,
      bestSelection: null, averageHindsightRegret: null,
    },
    {
      participantId: 'participant-11', displayName: 'Zed', titles: 0, seasonsPlayed: 0,
      averageFinish: null, averageEquivalentPoolScore: null, bestRawSeason: null,
      bestSelection: null, averageHindsightRegret: null,
    },
  ]);
});

test('buildCareerStats merges Mike and Stormo by ID while keeping Rudy and Rohit distinct', () => {
  const result = buildCareerStats(HISTORY_DATA);
  const byId = Object.fromEntries(result.map((career) => [career.participantId, career]));
  const mikeSeasonIds = HISTORY_DATA.seasons
    .filter(({ selections }) => selections.some(({ participantId }) => participantId === 'mike-stormo'))
    .map(({ id }) => id);
  const mikeEquivalentScores = HISTORY_DATA.seasons
    .map((season) => deriveSeason(season, HISTORY_DATA.teams.map(({ id }) => id)))
    .flatMap((season) => season.participants.filter(({ participantId }) => participantId === 'mike-stormo'))
    .map(({ equivalentScore }) => equivalentScore);

  assert.equal(Object.keys(byId).length, 12);
  assert.equal(byId['mike-stormo'].displayName, 'Stormo');
  assert.equal(byId['mike-stormo'].seasonsPlayed, mikeSeasonIds.length);
  assert.equal(
    byId['mike-stormo'].averageEquivalentPoolScore,
    mikeEquivalentScores.reduce((sum, value) => sum + value, 0) / mikeEquivalentScores.length,
  );
  assert.equal(byId.rudy.titles, 2);
  assert.notEqual(byId.rudy.participantId, byId.rohit.participantId);
  assert.equal(byId.rohit.titles, 0);
});

test('buildCareerStats uses participant ID as the final deterministic sort key', () => {
  const declared = [
    ...PARTICIPANTS,
    { id: 'zeta', displayName: 'Duplicate' },
    { id: 'alpha', displayName: 'Duplicate' },
  ];

  const result = buildCareerStats(createHistory([createSeason()], declared));

  assert.deepEqual(result.slice(-2).map(({ participantId }) => participantId), ['alpha', 'zeta']);
});

test('buildCareerStats sorts titles before finish, then finish among equal title counts', () => {
  const result = buildCareerStats(HISTORY_DATA);
  const positions = Object.fromEntries(result.map(({ participantId }, index) => [participantId, index]));

  assert.ok(positions.rudy < positions.austin, 'two titles outrank one despite the worse average finish');
  assert.ok(positions.austin < positions.cole, 'average finish breaks equal one-title careers');
});

test('summarizeMethods separates actual and perfect hindsight and uses population variance', () => {
  const first = createSeason({ id: '2024', label: '2024 Season', nflYear: 2024 });
  const second = createSeason({ id: '2025', label: '2025 Season', nflYear: 2025 });
  setRecordWins(first, 'team-32', 9);
  setRecordWins(second, 'team-01', 16);

  const result = summarizeMethods(createHistory([first, second]));
  const simmons = result.simmons;
  const actualSlot1 = simmons.actual.slots[0];

  assert.equal(simmons.sampleCount, 2);
  assert.deepEqual(actualSlot1.equivalentValues, [8.5, 16]);
  assert.equal(actualSlot1.equivalentAverage, 12.25);
  assert.equal(actualSlot1.equivalentVariance, 14.0625);
  assert.equal(actualSlot1.rawAverage, 12);
  assert.deepEqual(simmons.perfectHindsight.slots[0], {
    startingSlot: 1,
    sampleCount: 2,
    rawValues: [9, 16],
    equivalentValues: [9, 16],
    rawAverage: 12.5,
    equivalentAverage: 12.5,
    equivalentVariance: 12.25,
  });
  assert.deepEqual(simmons.perfectHindsight.slots[1], {
    startingSlot: 2,
    sampleCount: 2,
    rawValues: [8, 7],
    equivalentValues: [8.5, 7.4375],
    rawAverage: 7.5,
    equivalentAverage: 7.96875,
    equivalentVariance: 0.2822265625,
  });
  assert.deepEqual(simmons.actual.lateBoard, {
    late: { sampleCount: 6, rawMean: 0, equivalentMean: 0 },
    undrafted: { sampleCount: 4, rawMean: 2.25, equivalentMean: 2.25 },
  });
  assert.deepEqual(simmons.perfectHindsight.lateBoard, {
    late: { sampleCount: 6, rawMean: 0, equivalentMean: 0 },
    undrafted: { sampleCount: 4, rawMean: 0, equivalentMean: 0 },
  });
  assert.notDeepEqual(actualSlot1.rawValues, simmons.perfectHindsight.slots[0].rawValues);
  assert.notDeepEqual(simmons.actual.lateBoard, simmons.perfectHindsight.lateBoard);
  assert.notStrictEqual(simmons.actual, simmons.perfectHindsight);
  assert.deepEqual(simmons.championSlots, [1, 1]);

  const elDorado = result['el-dorado'];
  assert.equal(elDorado.sampleCount, 0);
  assert.deepEqual(elDorado.actual.slots[0], {
    startingSlot: 1,
    sampleCount: 0,
    rawValues: [],
    equivalentValues: [],
    rawAverage: null,
    equivalentAverage: null,
    equivalentVariance: null,
  });
  assert.deepEqual(elDorado.perfectHindsight.lateBoard, {
    late: { sampleCount: 0, rawMean: null, equivalentMean: null },
    undrafted: { sampleCount: 0, rawMean: null, equivalentMean: null },
  });
});

test('real-data advanced analytics preserve historical raw anchors and method samples', () => {
  const lateBoard = summarizeLateBoard(HISTORY_DATA);
  const methods = summarizeMethods(HISTORY_DATA);

  assert.equal(lateBoard.overall.late.rawMean, 96 / 18);
  assert.equal(lateBoard.overall.undrafted.rawMean, 66 / 12);
  assert.equal(methods.simmons.sampleCount, 2);
  assert.equal(methods['el-dorado'].sampleCount, 4);
  assert.equal(methods['el-dorado'].actual.slots[0].rawAverage, 25);
  assert.equal(methods['el-dorado'].championSlots.filter((slot) => slot === 1).length, 0);
  assert.equal(
    Object.values(methods).flatMap(({ championSlots }) => championSlots).filter((slot) => slot === 6).length,
    3,
  );
  assert.equal(lateBoard.seasons.length, 6);
  for (const season of lateBoard.seasons) {
    assert.equal(season.latePicks.length, 3);
    assert.equal(season.undraftedTeams.length, 2);
  }
});

test('advanced analytics return serializable objects without mutating history data', () => {
  const before = JSON.stringify(HISTORY_DATA);
  const results = [
    calculatePickRegrets(HISTORY_DATA.seasons[0]),
    replayPerfectDraft(HISTORY_DATA.seasons[0]),
    summarizeChampions(HISTORY_DATA),
    summarizePickPositions(HISTORY_DATA),
    summarizeLateBoard(HISTORY_DATA),
    buildCareerStats(HISTORY_DATA),
    summarizeMethods(HISTORY_DATA),
  ];

  for (const result of results) {
    assert.doesNotThrow(() => JSON.stringify(result));
    assertAllNumbersFinite(result);
  }
  assert.equal(JSON.stringify(HISTORY_DATA), before);
});
