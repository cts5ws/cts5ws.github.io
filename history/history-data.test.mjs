import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { deriveSeason, validateSeason } from './history-analytics.mjs';
import { HISTORY_DATA } from './history-data.mjs';

const PARTICIPANT_IDS = [
  'austin', 'cole', 'cody', 'jake', 'john', 'jon',
  'mike-stormo', 'nathan', 'ossman', 'rohit', 'rudy', 'ryan',
];

const TEAM_IDS = [
  'ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle',
  'dal', 'den', 'det', 'gb', 'hou', 'ind', 'jax', 'kc',
  'lac', 'lar', 'lv', 'mia', 'min', 'ne', 'no', 'nyg',
  'nyj', 'phi', 'pit', 'sea', 'sf', 'tb', 'ten', 'wsh',
];

const EXPECTED_SEASONS = [
  ['2019', '2019–20', 2019, 'simmons'],
  ['2021', '2021–22', 2021, 'el-dorado'],
  ['2022', '2022–23', 2022, 'el-dorado'],
  ['2023', '2023–24', 2023, 'el-dorado'],
  ['2024', '2024–25', 2024, 'el-dorado'],
  ['2025', '2025–26', 2025, 'simmons'],
];

const EXPECTED_CHAMPIONS = {
  2019: { participantId: 'austin', rawPoolScore: 30, startingSlot: 6 },
  2021: { participantId: 'rudy', rawPoolScore: 31, startingSlot: 2 },
  2022: { participantId: 'mike-stormo', rawPoolScore: 35, startingSlot: 3 },
  2023: { participantId: 'rudy', rawPoolScore: 31, startingSlot: 8 },
  2024: { participantId: 'jon', rawPoolScore: 38, startingSlot: 6 },
  2025: { participantId: 'cole', rawPoolScore: 34, startingSlot: 6 },
};

const EXPECTED_WORKBOOK_HASHES = {
  2019: '5c432591bfb79e61ea6f57daba8a039e523dbfa08099e1bee13ecc00f4655ba2',
  2021: '18e1e4b04e0384d16f47cc6aa773ed253fabdb061d348a0fdb0625d1f6414fbe',
  2022: '0c1ef956fbfe56a11b6a73bbd1e66650580899a3a81747f6ca23104ca46decc2',
  2023: 'c5b2a886b134d21d445f70108a7dc78f65ce7f4e49babd688b8dbad4a53e638a',
  2024: 'f188942a0c3f5c7922b6bdf9a72ee0d77a79085580d64b554e8aafe32ffdbaa4',
  2025: '84a3811fff04790a658fc96ba49d13d2ecacd9bebe1262c68288ba85a0d311f1',
};

const EXPECTED_SOURCE_ROW_DIGESTS = {
  2019: '7b7aa7a1f2002405a5900c64d57d718a118b56ceedb208faff17d44094d17a4c',
  2021: '55af40ad5b6f7f1a5f22d6f2c9141e05225dd89811b9557474edaa7ef812f565',
  2022: '33df86785fa3c5a38bf1f957de527d03b015b4bc0d752e04d4a6c1d585db55b4',
  2023: '997479b0441180b70b5a3a636cdfcc5efe9b860bc08b720f6af734a440463ee7',
  2024: '4a8b41adb4017f9e7fb518b6ec9afb8fc2041d812a0ce8dc0cb6e7e83f4eff9e',
  2025: '821ce8f2b0e23ef877aea97b69a0f4a4ece1e1ca55c3e37b4b7f78acd37d4e61',
};

const EXPECTED_RECORD_DIGESTS = {
  2019: '601704374c92cfc383d5299931429e9dbe0aba10122d3f7130f2594e7d1298f9',
  2021: '1be55105d7d28861341a828515ca5a215a12ac478a3af01420b325df5938edb9',
  2022: 'ff7414d76332ed67e43eb75abff3e43e2d4f5458bddce776fa834a7976c2c403',
  2023: '67f9e5ff258d383e9249333ca09127d8a5b0282729924c9a34804a670734833c',
  2024: '11e2deb18fac181d2ef868bf7fa52a746a8db22f5382fb933a431516f3becb79',
  2025: 'c40f9682124769ed775b93677ce66dbb3a5f79bfd253d623095f6a849df89d8e',
};

const EXPECTED_NORMALIZED_SELECTION_DIGESTS = {
  2019: 'c66ca5ef408ac6c927cccd35e7a51bc4cdaff9865dc04b725cf1829242a95554',
  2021: 'bab8d42f0685daf2634f490054203fc4d738ed6f0a102ef77f0746724f7e0ea9',
  2022: 'd84b43b4681b6fe2a3392d64ab6f66f9f5bf9dd101ea5cf76b3df9bc023669af',
  2023: 'c34257cf8e11f136d5032d90b9c4564c392fbd6922357738142ea23089c733eb',
  2024: '06ea72f7a766fa9a52bd78048cfbba54a0f302eff723acf9c5a7adc87d108a3a',
  2025: '5d6ee6e5d65d4645a4aceb4c200b20e75609daecfb1d93eba8e0344370395f14',
};

function digestRows(rows) {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function sourceRowDigest(selections) {
  const sourceRows = selections.map(({ pick, sourceParticipantLabel, sourceTeamLabel }) =>
    [pick, sourceParticipantLabel, sourceTeamLabel]);
  return digestRows(sourceRows);
}

function recordDigest(records) {
  return digestRows(TEAM_IDS.map((teamId) => {
    const { abbreviation, displayName, wins, losses, ties } = records[teamId];
    return [teamId, abbreviation, displayName, wins, losses, ties];
  }));
}

function normalizedSelectionDigest(selections) {
  return digestRows(selections.map(({
    pick, participantId, sourceParticipantLabel, teamId, sourceTeamLabel,
  }) => [pick, participantId, sourceParticipantLabel, teamId, sourceTeamLabel]));
}

test('history data exposes the exact participant, team, and season universes', () => {
  assert.equal(HISTORY_DATA.participants.length, 12);
  assert.deepEqual(HISTORY_DATA.participants.map(({ id }) => id), PARTICIPANT_IDS);
  assert.equal(HISTORY_DATA.teams.length, 32);
  assert.deepEqual(HISTORY_DATA.teams.map(({ id }) => id), TEAM_IDS);
  assert.deepEqual(
    HISTORY_DATA.seasons.map(({ id, label, nflYear, method }) => [id, label, nflYear, method]),
    EXPECTED_SEASONS,
  );
});

test('history data is deeply immutable', () => {
  const participant = HISTORY_DATA.participants.find(({ id }) => id === 'mike-stormo');
  const season = HISTORY_DATA.seasons.find(({ nflYear }) => nflYear === 2024);
  const selection = season.selections.find(({ pick }) => pick === 30);
  const record = season.records.car;
  const originalFacts = {
    aliasCount: participant.aliases.length,
    label: season.label,
    teamId: selection.teamId,
    wins: record.wins,
    notes: season.notes,
  };

  for (const value of [
    HISTORY_DATA,
    HISTORY_DATA.participants,
    participant,
    participant.aliases,
    HISTORY_DATA.seasons,
    season,
    season.workbook,
    season.selections,
    selection,
    season.records,
    record,
    season.notes,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }

  assert.throws(() => HISTORY_DATA.seasons.push(season), TypeError);
  assert.throws(() => participant.aliases.push('Stormo!'), TypeError);
  assert.throws(() => { season.label = 'changed'; }, TypeError);
  assert.throws(() => { selection.teamId = 'den'; }, TypeError);
  assert.throws(() => { record.wins = 99; }, TypeError);
  assert.throws(() => { season.notes = 'changed'; }, TypeError);
  assert.deepEqual({
    aliasCount: participant.aliases.length,
    label: season.label,
    teamId: selection.teamId,
    wins: record.wins,
    notes: season.notes,
  }, originalFacts);
});

test('all six seasons satisfy the analytics schema', () => {
  for (const season of HISTORY_DATA.seasons) {
    assert.deepEqual(validateSeason(season, TEAM_IDS, PARTICIPANT_IDS), [], `season ${season.id}`);
    assert.equal(Object.keys(season.records).length, 32, `season ${season.id} record count`);
  }
});

test('workbook provenance and official record URLs are complete', () => {
  for (const season of HISTORY_DATA.seasons) {
    assert.match(season.workbook.sha256, /^[a-f0-9]{64}$/);
    assert.equal(season.workbook.sha256, EXPECTED_WORKBOOK_HASHES[season.nflYear]);
    assert.equal(
      season.recordSourceUrl,
      `https://www.nfl.com/standings/league/${season.nflYear}/REG`,
    );
  }
});

test('selection source labels exactly match the source workbook rows', () => {
  for (const season of HISTORY_DATA.seasons) {
    assert.equal(
      sourceRowDigest(season.selections),
      EXPECTED_SOURCE_ROW_DIGESTS[season.nflYear],
      `season ${season.id}`,
    );
  }
});

test('source-row digests detect a one-character source-label mutation', () => {
  const selections = HISTORY_DATA.seasons[0].selections.map((selection) => ({ ...selection }));
  const originalDigest = sourceRowDigest(selections);
  selections[0].sourceTeamLabel += '!';
  assert.notEqual(sourceRowDigest(selections), originalDigest);
});

test('season record facts exactly match the independently verified standings', () => {
  for (const season of HISTORY_DATA.seasons) {
    assert.equal(
      recordDigest(season.records),
      EXPECTED_RECORD_DIGESTS[season.nflYear],
      `season ${season.id}`,
    );
  }
});

test('record digests detect a one-field record mutation', () => {
  const records = HISTORY_DATA.seasons[0].records;
  const mutatedRecords = {
    ...records,
    ari: { ...records.ari, wins: records.ari.wins + 1 },
  };
  assert.notEqual(recordDigest(mutatedRecords), recordDigest(records));
});

test('normalized selections exactly match the independently mapped workbook rows', () => {
  for (const season of HISTORY_DATA.seasons) {
    assert.equal(
      normalizedSelectionDigest(season.selections),
      EXPECTED_NORMALIZED_SELECTION_DIGESTS[season.nflYear],
      `season ${season.id}`,
    );
  }
});

test('normalized-selection digests detect a one-ID mapping mutation', () => {
  const selections = HISTORY_DATA.seasons[0].selections.map((selection) => ({ ...selection }));
  const originalDigest = normalizedSelectionDigest(selections);
  selections[0].teamId = 'ari';
  assert.notEqual(normalizedSelectionDigest(selections), originalDigest);
});

test('derived champions, scores, and draft slots match the historical results', () => {
  for (const season of HISTORY_DATA.seasons) {
    const champions = deriveSeason(season, TEAM_IDS).participants.filter(({ champion }) => champion);
    assert.equal(champions.length, 1, `season ${season.id} has one champion`);
    const { participantId, rawPoolScore, startingSlot } = champions[0];
    assert.deepEqual(
      { participantId, rawPoolScore, startingSlot },
      EXPECTED_CHAMPIONS[season.nflYear],
      `season ${season.id}`,
    );
  }
});

test('the blank 2024 pick 30 is recovered without fabricating a source label', () => {
  const season = HISTORY_DATA.seasons.find(({ nflYear }) => nflYear === 2024);
  const selection = season.selections.find(({ pick }) => pick === 30);
  assert.deepEqual(
    { participantId: selection.participantId, teamId: selection.teamId, sourceTeamLabel: selection.sourceTeamLabel },
    { participantId: 'ryan', teamId: 'car', sourceTeamLabel: '' },
  );
  assert.deepEqual(deriveSeason(season, TEAM_IDS).undraftedTeamIds, ['den', 'ne']);
  assert.equal(
    season.notes,
    'The 2024 workbook cell C31 is blank; pick 30 Carolina was recovered from git commit 79c661f, which assigns CAR to Ryan. Denver and New England were undrafted.',
  );
});

test('ambiguous participant and team labels normalize to the intended stable IDs', () => {
  const participantById = Object.fromEntries(HISTORY_DATA.participants.map((participant) => [participant.id, participant]));
  assert.equal(participantById['mike-stormo'].displayName, 'Stormo');
  for (const alias of ['MIKE', 'Mike', 'Stormo']) {
    assert.ok(participantById['mike-stormo'].aliases.includes(alias), alias);
  }
  assert.notEqual(participantById.rudy.id, participantById.rohit.id);
  assert.notEqual(participantById.austin.id, participantById.john.id);

  const allSelections = HISTORY_DATA.seasons.flatMap(({ selections }) => selections);
  assert.ok(allSelections.some(({ sourceParticipantLabel, participantId }) =>
    sourceParticipantLabel === 'Ryan (binch)' && participantId === 'ryan'));
  assert.ok(allSelections.some(({ sourceTeamLabel, teamId }) =>
    sourceTeamLabel === 'CHARdinals' && teamId === 'ari'));
});

test('selection source labels preserve every source cell, with one documented blank', () => {
  for (const season of HISTORY_DATA.seasons) {
    for (const selection of season.selections) {
      assert.equal(typeof selection.sourceParticipantLabel, 'string');
      assert.notEqual(selection.sourceParticipantLabel, '');
      assert.equal(typeof selection.sourceTeamLabel, 'string');
      if (selection.sourceTeamLabel === '') {
        assert.deepEqual([season.nflYear, selection.pick], [2024, 30]);
      }
    }
  }
});

test('historical record labels preserve franchise names and abbreviations by season', () => {
  const season2019 = HISTORY_DATA.seasons.find(({ nflYear }) => nflYear === 2019);
  const season2021 = HISTORY_DATA.seasons.find(({ nflYear }) => nflYear === 2021);
  const season2022 = HISTORY_DATA.seasons.find(({ nflYear }) => nflYear === 2022);
  assert.equal(season2019.records.lv.abbreviation, 'OAK');
  assert.equal(season2019.records.lv.displayName, 'Oakland Raiders');
  assert.equal(season2019.records.wsh.displayName, 'Washington Redskins');
  assert.equal(season2021.records.wsh.displayName, 'Washington Football Team');
  assert.equal(season2022.records.wsh.displayName, 'Washington Commanders');
});
