import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { HISTORY_DATA } from './history-data.mjs';

class FakeControl {
  constructor(owner, { method, pressed, value } = {}) {
    this.owner = owner;
    this.dataset = method === undefined ? {} : { methodFilter: method };
    this.pressed = pressed;
    this.value = value;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  click() {
    this.listeners.get('click')?.({ currentTarget: this });
  }

  change(value) {
    this.value = value;
    this.listeners.get('change')?.({ currentTarget: this });
  }

  focus() {
    this.owner.activeElement = this;
  }
}

class FakeContent {
  constructor(owner) {
    this.owner = owner;
    this.html = '';
  }

  set innerHTML(html) {
    this.html = String(html);
    this.buttons = [...this.html.matchAll(/<button[^>]*data-method-filter="([^"]+)"[^>]*aria-pressed="(true|false)"/g)]
      .map((match) => new FakeControl(this.owner, { method: match[1], pressed: match[2] }));
    const selected = this.html.match(/<option value="([^"]+)" selected>/)?.[1];
    this.select = this.html.includes('id="season-select"') ? new FakeControl(this.owner, { value: selected }) : null;
  }

  get innerHTML() {
    return this.html;
  }

  querySelectorAll(selector) {
    return selector === '[data-method-filter]' ? this.buttons : [];
  }

  querySelector(selector) {
    return selector === '#season-select' ? this.select : null;
  }
}

class FakeRoot {
  constructor(html = '') {
    this.activeElement = null;
    this.innerHTML = html;
  }

  set innerHTML(html) {
    this.html = String(html);
    if (this.html.includes('data-history-content')) {
      this.content = new FakeContent(this);
      this.live = { textContent: '' };
    } else {
      this.content = null;
      this.live = null;
    }
  }

  get innerHTML() {
    return this.content ? this.html.replace('</div>', `${this.content.innerHTML}</div>`) : this.html;
  }

  get buttons() {
    return this.content?.buttons ?? [];
  }

  get select() {
    return this.content?.select ?? null;
  }

  querySelector(selector) {
    if (selector === '[data-history-content]') return this.content;
    if (selector === '[data-history-live]') return this.live;
    return null;
  }
}

test('buildHistoryViewModel exposes every completed season and canonical participant names', async () => {
  const { buildHistoryViewModel } = await import('./history-render.mjs');
  const model = buildHistoryViewModel(HISTORY_DATA);

  assert.deepEqual(model.seasons.map(({ id }) => id), ['2019', '2021', '2022', '2023', '2024', '2025']);
  assert.equal(model.participants.length, 12);
  assert.equal(
    model.participants.find(({ id }) => id === 'mike-stormo').displayName,
    'Stormo',
  );
});

test('buildHistoryViewModel validates metadata and duplicate IDs before sorting or mapping', async () => {
  const { buildHistoryViewModel } = await import('./history-render.mjs');
  const malformed = structuredClone(HISTORY_DATA);
  malformed.seasons[0].nflYear = '<b>bad year</b>';
  assert.throws(() => buildHistoryViewModel(malformed), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors.join('\n'), /season\.nflYear must be a four-digit integer/);
    return true;
  });

  const duplicate = structuredClone(HISTORY_DATA);
  duplicate.seasons[1].id = duplicate.seasons[0].id;
  assert.throws(() => buildHistoryViewModel(duplicate), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.errors.join('\n'), /unique season IDs/);
    return true;
  });
});

test('the view model exposes complete actual season, slot, late-board, method, and career data', async () => {
  const { buildHistoryViewModel } = await import('./history-render.mjs');
  const model = buildHistoryViewModel(HISTORY_DATA);

  assert.equal(model.defaultSeasonId, '2025');
  assert.deepEqual(model.winnerSlots.map(({ slot }) => slot), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(model.winnerSlots.find(({ slot }) => slot === 6).titles.length, 3);
  assert.deepEqual(model.methods.map(({ id, sampleCount }) => [id, sampleCount]), [
    ['simmons', 2],
    ['el-dorado', 4],
  ]);
  assert.equal(model.careers.length, 12);

  for (const season of model.seasons) {
    assert.ok(season.champions.length >= 1, season.id);
    assert.equal(season.standings.length, 10, season.id);
    assert.equal(season.picks.length, 30, season.id);
    assert.equal(season.undraftedTeams.length, 2, season.id);
    for (const champion of season.champions) {
      assert.equal(champion.teams.length, 3, `${season.id} ${champion.displayName}`);
      assert.equal(typeof champion.winningScore, 'number');
      assert.equal(typeof champion.startingSlot, 'number');
    }
  }
});

test('renderHistoryApp renders sections in order, the no-pool gap, and complete champion details', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const html = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA), { method: 'all', seasonId: '2025' });
  const sectionIds = [
    'history-summary',
    'history-timeline',
    'history-winner-slot',
    'history-late-picks',
    'history-methods',
    'history-careers',
    'history-explorer',
  ];

  let priorIndex = -1;
  for (const id of sectionIds) {
    const nextIndex = html.indexOf(`id="${id}"`);
    assert.ok(nextIndex > priorIndex, `${id} follows the prior section`);
    priorIndex = nextIndex;
  }
  assert.match(html, /2020–21/);
  assert.match(html, /No pool/);
  assert.equal((html.match(/data-season-card=/g) ?? []).length, 6);
  assert.equal((html.match(/data-champion=/g) ?? []).length, 6);
  assert.match(html, /Starting slot/);
  assert.match(html, /Winning score/);
  assert.match(html, /Team picks and records/);
});

test('public champion and career labels use Stormo for the merged participant identity', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const html = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA));
  const season2022 = html.slice(html.indexOf('data-season-card="2022"'), html.indexOf('data-season-card="2023"'));
  const careers = html.slice(html.indexOf('id="history-careers"'), html.indexOf('id="history-explorer"'));

  assert.match(season2022, /<strong>Champion:<\/strong> Stormo/);
  assert.match(careers, /data-career-row="mike-stormo"[^]*>Stormo<\/th>/);
  assert.doesNotMatch(html, /Mike \/ Stormo/);
});

test('team records do not repeat wins while analytical raw-win measures remain explicit', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const html = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA));

  assert.doesNotMatch(html, /\d+–\d+(?:–\d+)?\s*(?:·|,)\s*\d+\s+raw wins/i);
  assert.match(html, /<strong>Winning score:<\/strong> \d+ raw wins/);
  assert.match(html, /<title>Slot \d+: [\d.]+ average raw wins<\/title>/);
  assert.match(html, /picks 28–30 averaged <strong>5\.3 raw wins<\/strong>/i);
  assert.match(html, /<th scope="col">Raw wins<\/th>/);
});

test('method controls and winner-slot chart expose accessible state, labels, and title markers', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const model = buildHistoryViewModel(HISTORY_DATA);
  const html = renderHistoryApp(model, { method: 'el-dorado', seasonId: '2025' });

  assert.match(html, /data-method-filter="all" aria-pressed="false"/);
  assert.match(html, /data-method-filter="simmons" aria-pressed="false"/);
  assert.match(html, /data-method-filter="el-dorado" aria-pressed="true"/);
  assert.match(html, /<svg[^>]+role="img"[^>]+aria-label="[^"]+"/);
  assert.equal((html.match(/data-slot-column=/g) ?? []).length, 10);
  const allHtml = renderHistoryApp(model, { method: 'all', seasonId: '2025' });
  const slotSix = allHtml.slice(allHtml.indexOf('data-slot-column="6"'), allHtml.indexOf('data-slot-column="7"'));
  assert.equal((slotSix.match(/data-title-marker=/g) ?? []).length, 3);
  for (let slot = 1; slot <= 10; slot += 1) {
    assert.match(html, new RegExp(`<th[^>]*>Slot ${slot}<\\/th>`));
  }
});

test('winner-slot title markers stay inside their bars and clear of direct average labels', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const html = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA));
  const groups = [...html.matchAll(/<g data-slot-column="(\d+)">([\s\S]*?)<\/g>/g)];
  let markerCount = 0;

  for (const [, slot, content] of groups) {
    const rect = content.match(/<rect[^>]*\by="([^"]+)"[^>]*\bheight="([^"]+)"/);
    const labels = [...content.matchAll(/<text[^>]*\by="([^"]+)"[^>]*>([^<]+)<\/text>/g)];
    const markers = [...content.matchAll(/<circle[^>]*data-title-marker="([^"]+)"[^>]*\bcy="([^"]+)"[^>]*>[\s\S]*?<title>[^<]+<\/title><\/circle>/g)];
    if (markers.length === 0) continue;

    assert.ok(rect, `slot ${slot} has a bar`);
    assert.ok(labels.length >= 2, `slot ${slot} has slot and average labels`);
    const barTop = Number(rect[1]);
    const barBottom = barTop + Number(rect[2]);
    const averageLabelY = Number(labels.at(-1)[1]);
    const markerYs = markers.map((marker) => Number(marker[2]));
    markerCount += markerYs.length;

    for (const markerY of markerYs) {
      assert.ok(markerY >= barTop + 6, `slot ${slot} marker clears the top edge of its bar`);
      assert.ok(markerY <= barBottom - 6, `slot ${slot} marker clears the bottom edge of its bar`);
      assert.ok(markerY - averageLabelY >= 12, `slot ${slot} marker clears its average label`);
    }
    for (let index = 1; index < markerYs.length; index += 1) {
      assert.ok(markerYs[index] - markerYs[index - 1] >= 10, `slot ${slot} title markers are separated`);
    }
  }

  assert.equal(markerCount, 6);
});

test('late-board analysis contains picks 28–30 and two undrafted teams for each included season', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const html = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA));
  const lateSection = html.slice(
    html.indexOf('id="history-late-picks"'),
    html.indexOf('id="history-methods"'),
  );

  assert.equal((lateSection.match(/data-late-season=/g) ?? []).length, 6);
  assert.equal((lateSection.match(/data-late-pick="28"/g) ?? []).length, 6);
  assert.equal((lateSection.match(/data-late-pick="29"/g) ?? []).length, 6);
  assert.equal((lateSection.match(/data-late-pick="30"/g) ?? []).length, 6);
  assert.equal((lateSection.match(/data-undrafted-team=/g) ?? []).length, 12);
});

test('late-board view model and takeaway retain exact full-history means', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const model = buildHistoryViewModel(HISTORY_DATA);
  const html = renderHistoryApp(model);
  const lateSection = html.slice(html.indexOf('id="history-late-picks"'), html.indexOf('id="history-methods"'));

  assert.deepEqual(model.lateBoardSummary, {
    seasonCount: 6,
    latePickCount: 18,
    undraftedCount: 12,
    lateRawMean: 96 / 18,
    undraftedRawMean: 66 / 12,
  });
  assert.match(lateSection, /data-late-takeaway/);
  assert.match(lateSection, /small 6-season sample/i);
  assert.match(lateSection, /picks 28–30 averaged <strong>5\.3 raw wins<\/strong>/i);
  assert.match(lateSection, /undrafted teams averaged <strong>5\.5 raw wins<\/strong>/i);
});

test('late-board takeaway recomputes from seasons included by the method filter', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const model = buildHistoryViewModel(HISTORY_DATA);
  const simmons = renderHistoryApp(model, { method: 'simmons' });
  const elDorado = renderHistoryApp(model, { method: 'el-dorado' });

  assert.match(simmons, /small 2-season sample[^]*picks 28–30 averaged <strong>3\.2 raw wins<\/strong>[^]*undrafted teams averaged <strong>5\.3 raw wins<\/strong>/i);
  assert.match(elDorado, /small 4-season sample[^]*picks 28–30 averaged <strong>6\.4 raw wins<\/strong>[^]*undrafted teams averaged <strong>5\.6 raw wins<\/strong>/i);
});

test('method cards distinguish actual evidence from counterfactual hindsight without a fairness claim', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const html = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA));
  const section = html.slice(html.indexOf('id="history-methods"'), html.indexOf('id="history-careers"'));

  assert.equal((section.match(/data-method-card=/g) ?? []).length, 2);
  assert.match(section, /Simmons[^]*2 seasons/);
  assert.match(section, /El Dorado[^]*4 seasons/);
  assert.equal((section.match(/Actual results/g) ?? []).length, 2);
  assert.equal((section.match(/Perfect-replay counterfactual/g) ?? []).length, 2);
  assert.match(section, /does not establish that either method is fairer/i);
});

test('career table has metric headings and one canonical row for every participant', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const html = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA));
  const section = html.slice(html.indexOf('id="history-careers"'), html.indexOf('id="history-explorer"'));

  for (const heading of ['Participant', 'Titles', 'Seasons', 'Average finish', 'Best season', 'Best team', 'Average regret']) {
    assert.match(section, new RegExp(`>${heading}<`));
  }
  assert.equal((section.match(/data-career-row=/g) ?? []).length, 12);
  const renderedNames = [...section.matchAll(/data-career-row="[^"]+"><th[^>]*scope="row"[^>]*>([^<]+)<\/th>/g)]
    .map((match) => match[1]).sort();
  const canonicalNames = HISTORY_DATA.participants.map(({ displayName }) => displayName).sort();
  assert.deepEqual(renderedNames, canonicalNames);

  const aliasedData = structuredClone(HISTORY_DATA);
  for (const season of aliasedData.seasons) {
    for (const selection of season.selections) selection.sourceParticipantLabel = `RAW-SOURCE-ALIAS-${selection.pick}`;
  }
  const aliasedHtml = renderHistoryApp(buildHistoryViewModel(aliasedData));
  assert.doesNotMatch(aliasedHtml, /RAW-SOURCE-ALIAS-/);
  assert.match(aliasedHtml, />Stormo</);
});

test('pure view-model and renderer APIs are deterministic and do not mutate their inputs', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const data = structuredClone(HISTORY_DATA);
  const dataBefore = structuredClone(data);

  const firstModel = buildHistoryViewModel(data);
  const secondModel = buildHistoryViewModel(data);
  assert.deepEqual(firstModel, secondModel);
  assert.deepEqual(data, dataBefore);

  const modelBefore = structuredClone(firstModel);
  const options = { method: 'el-dorado', seasonId: '2022' };
  assert.equal(renderHistoryApp(firstModel, options), renderHistoryApp(firstModel, options));
  assert.deepEqual(firstModel, modelBefore);
  assert.deepEqual(options, { method: 'el-dorado', seasonId: '2022' });
});

test('season explorer defaults to 2025 and can select another season with complete standings and teams', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const model = buildHistoryViewModel(HISTORY_DATA);
  const defaultHtml = renderHistoryApp(model);
  const selectedHtml = renderHistoryApp(model, { seasonId: '2019' });
  const defaultExplorer = defaultHtml.slice(defaultHtml.indexOf('id="history-explorer"'));
  const selectedExplorer = selectedHtml.slice(selectedHtml.indexOf('id="history-explorer"'));

  assert.match(defaultExplorer, /<option value="2025" selected>/);
  assert.match(defaultExplorer, /2025–26 final standings/);
  assert.match(selectedExplorer, /<option value="2019" selected>/);
  assert.match(selectedExplorer, /2019–20 final standings/);
  assert.equal((selectedExplorer.match(/data-standing-row=/g) ?? []).length, 10);
  assert.equal((selectedExplorer.match(/data-explorer-pick=/g) ?? []).length, 30);
  assert.equal((selectedExplorer.match(/data-explorer-undrafted=/g) ?? []).length, 2);
});

test('season explorer selects exactly one option for a manually constructed duplicate-ID model', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const model = buildHistoryViewModel(HISTORY_DATA);
  const duplicateModel = { ...model, seasons: [...model.seasons, model.seasons[0]] };
  const html = renderHistoryApp(duplicateModel, { seasonId: '2019' });
  const explorer = html.slice(html.indexOf('id="history-explorer"'));

  assert.equal((explorer.match(/<option[^>]+ selected>/g) ?? []).length, 1);
});

test('all untrusted text is HTML-escaped in content and attributes', async () => {
  const { buildHistoryViewModel, renderHistoryApp, renderErrorPanel } = await import('./history-render.mjs');
  const malicious = `<tag attr="x">Tom & O'Brien</tag>`;
  const data = structuredClone(HISTORY_DATA);
  data.participants[0].displayName = malicious;
  data.seasons[0].label = malicious;
  data.seasons[0].records.ari.displayName = malicious;
  data.seasons[0].records.ari.abbreviation = malicious;
  const html = renderHistoryApp(buildHistoryViewModel(data), { seasonId: '2019' });
  const errorHtml = renderErrorPanel(new Error(malicious));
  const escaped = '&lt;tag attr=&quot;x&quot;&gt;Tom &amp; O&#39;Brien&lt;/tag&gt;';

  assert.ok(html.includes(escaped));
  assert.ok(errorHtml.includes(escaped));
  assert.doesNotMatch(html, /<tag attr=/);
  assert.doesNotMatch(errorHtml, /<tag attr=/);
  assert.equal((errorHtml.match(/role="alert"/g) ?? []).length, 1);

  const manualModel = buildHistoryViewModel(HISTORY_DATA);
  manualModel.careers[0].bestRawSeason.nflYear = malicious;
  const manualHtml = renderHistoryApp(manualModel);
  assert.ok(manualHtml.includes(escaped));
  assert.doesNotMatch(manualHtml, /<tag attr=/);
});

test('summary and full-history winner-slot claims are derived from the supplied model', async () => {
  const { buildHistoryViewModel, renderHistoryApp } = await import('./history-render.mjs');
  const model = buildHistoryViewModel(HISTORY_DATA);
  const fixture = {
    ...model,
    seasons: model.seasons.slice(0, 2),
    winnerSlots: model.winnerSlots.map((slot) => ({
      ...slot,
      titles: slot.slot === 4 ? [{ seasonId: 'fixture' }] : [],
    })),
  };
  const html = renderHistoryApp(fixture);

  assert.match(html, /2 completed pools/);
  assert.match(html, /Across the full history, slot 4 has 1 title\./);
  assert.doesNotMatch(html, /Six completed pools|slot 6 has three titles/);
});

test('index keeps semantic fallback content and uses exactly one local module script', async () => {
  const source = await readFile(new URL('./index.html', import.meta.url), 'utf8');

  assert.match(source, /<a[^>]+href="#main-content"[^>]*>[^<]*Skip/i);
  assert.match(source, /<header[ >]/);
  assert.match(source, /<main[^>]+id="main-content"/);
  assert.match(source, /<footer[ >]/);
  assert.match(source, /raw wins[^]*standings[^]*titles/i);
  assert.match(source, /17-game-equivalent/i);
  assert.match(source, /one-change-per-pick hindsight/i);
  assert.match(source, /globally coherent[^]*stable team ID tiebreak/i);
  assert.match(source, /participant aliases/i);
  assert.doesNotMatch(source, /Recovered source fact/i);
  assert.doesNotMatch(source, /2024[^<]*Carolina[^<]*git history/i);
  assert.doesNotMatch(source, /Six completed seasons/i);
  const scripts = [...source.matchAll(/<script\b([^>]*)>/g)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type="module"/);
  assert.match(scripts[0][1], /src="\.\/history\.mjs"/);
  assert.doesNotMatch(source, /(?:src|href)="https?:\/\//);
});

test('browser entry exposes injected startup, guards automatic browser startup, and has no remote fetch', async () => {
  const source = await readFile(new URL('./history.mjs', import.meta.url), 'utf8');

  assert.match(source, /export function startHistoryApp/);
  assert.match(source, /typeof document !== 'undefined'/);
  assert.match(source, /renderErrorPanel/);
  assert.match(source, /data-method-filter/);
  assert.match(source, /season-select/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test('browser startup validates every season before build and render', async () => {
  const { startHistoryApp } = await import('./history.mjs');
  const root = new FakeRoot();
  const calls = [];

  startHistoryApp({
    root,
    historyData: HISTORY_DATA,
    validate: (season, teamIds, participantIds) => {
      calls.push(`validate:${season.id}`);
      assert.equal(teamIds.length, 32);
      assert.equal(participantIds.length, 12);
      return [];
    },
    build: () => {
      calls.push('build');
      return { defaultSeasonId: '2025' };
    },
    renderApp: () => {
      calls.push('render');
      return '<p>complete</p>';
    },
  });

  assert.deepEqual(calls, [
    'validate:2019', 'validate:2021', 'validate:2022',
    'validate:2023', 'validate:2024', 'validate:2025',
    'build', 'render',
  ]);
  assert.equal(root.content.innerHTML, '<p>complete</p>');
});

test('browser startup converts a null-season validation failure into one error panel with no partial analytics', async () => {
  const { startHistoryApp } = await import('./history.mjs');
  const root = new FakeRoot('<section id="history-summary">partial</section>');
  const historyData = { ...HISTORY_DATA, seasons: [null] };

  assert.doesNotThrow(() => startHistoryApp({ root, historyData }));
  assert.equal((root.innerHTML.match(/role="alert"/g) ?? []).length, 1);
  assert.equal((root.innerHTML.match(/class="error-panel"/g) ?? []).length, 1);
  assert.doesNotMatch(root.innerHTML, /history-summary|history-timeline|data-standing-row/);
  assert.match(root.innerHTML, /Season \(unknown\)/);
});

test('a rerender failure replaces stable content with one error panel and no partial analytics', async () => {
  const { startHistoryApp } = await import('./history.mjs');
  const { renderHistoryApp } = await import('./history-render.mjs');
  const root = new FakeRoot();
  let renderCount = 0;
  startHistoryApp({
    root,
    historyData: HISTORY_DATA,
    renderApp: (...args) => {
      renderCount += 1;
      if (renderCount > 1) throw new Error('rerender failed');
      return renderHistoryApp(...args);
    },
  });

  root.buttons.find(({ dataset }) => dataset.methodFilter === 'simmons').click();
  assert.equal((root.innerHTML.match(/role="alert"/g) ?? []).length, 1);
  assert.doesNotMatch(root.innerHTML, /history-summary|data-history-content|data-history-live/);
  assert.match(root.innerHTML, /rerender failed/);
});

test('browser method controls rerender with updated aria-pressed state', async () => {
  const { startHistoryApp } = await import('./history.mjs');
  const root = new FakeRoot();
  startHistoryApp({ root, historyData: HISTORY_DATA });

  const live = root.live;
  assert.equal(root.activeElement, null, 'initial render does not steal focus');
  assert.equal(root.buttons.find(({ dataset }) => dataset.methodFilter === 'all').pressed, 'true');
  root.buttons.find(({ dataset }) => dataset.methodFilter === 'el-dorado').click();
  assert.equal(root.live, live, 'live region persists across rerender');
  assert.equal(root.buttons.find(({ dataset }) => dataset.methodFilter === 'all').pressed, 'false');
  assert.equal(root.buttons.find(({ dataset }) => dataset.methodFilter === 'el-dorado').pressed, 'true');
  assert.equal(root.activeElement, root.buttons.find(({ dataset }) => dataset.methodFilter === 'el-dorado'));
  assert.equal(root.live.textContent, 'Showing El Dorado seasons.');
  assert.match(root.innerHTML, /Showing El Dorado/);
});

test('browser season control rerenders the selected season', async () => {
  const { startHistoryApp } = await import('./history.mjs');
  const root = new FakeRoot();
  startHistoryApp({ root, historyData: HISTORY_DATA });

  const live = root.live;
  assert.equal(root.select.value, '2025');
  root.select.change('2019');
  assert.equal(root.live, live, 'live region persists across rerender');
  assert.equal(root.select.value, '2019');
  assert.equal(root.activeElement, root.select);
  assert.equal(root.live.textContent, 'Showing season 2019–20.');
  assert.match(root.innerHTML, /<option value="2019" selected>/);
  assert.match(root.innerHTML, /2019–20 final standings/);
});
