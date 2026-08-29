import { buildCareerStats, deriveSeason, summarizeMethods } from './history-analytics.mjs';

const METHOD_LABELS = Object.freeze({ simmons: 'Simmons', 'el-dorado': 'El Dorado' });

export function buildHistoryViewModel(historyData) {
  const methodSummary = summarizeMethods(historyData);
  const participantById = new Map(historyData.participants.map((participant) => [participant.id, participant]));
  const teamIds = historyData.teams.map(({ id }) => id);
  const seasons = [...historyData.seasons]
    .sort((left, right) => left.nflYear - right.nflYear || left.id.localeCompare(right.id))
    .map((season) => buildSeasonModel(season, teamIds, participantById));
  return {
    participants: historyData.participants.map(({ id, displayName }) => ({ id, displayName })),
    seasons,
    defaultSeasonId: seasons.at(-1)?.id ?? '',
    winnerSlots: buildWinnerSlots(seasons),
    lateBoardSummary: buildLateBoardSummary(seasons),
    methods: Object.keys(METHOD_LABELS).map((id) => ({ id, label: METHOD_LABELS[id], ...methodSummary[id] })),
    careers: buildCareerStats(historyData),
  };
}

export function renderHistoryApp(model, options = {}) {
  const method = Object.hasOwn(METHOD_LABELS, options.method) ? options.method : 'all';
  const requestedIndex = model.seasons.findIndex(({ id }) => id === options.seasonId);
  const defaultIndex = model.seasons.findIndex(({ id }) => id === model.defaultSeasonId);
  const selectedSeasonIndex = requestedIndex >= 0
    ? requestedIndex
    : defaultIndex >= 0 ? defaultIndex : model.seasons.length - 1;
  const selectedSeason = model.seasons[selectedSeasonIndex];
  const includedSeasons = method === 'all' ? model.seasons : model.seasons.filter((season) => season.method === method);
  const slots = buildWinnerSlots(includedSeasons);
  return [
    renderSummary(model, includedSeasons, method),
    renderTimeline(includedSeasons),
    renderWinnerSlots(slots, method, model.winnerSlots),
    renderLateBoard(includedSeasons),
    renderMethods(model.methods),
    renderCareers(model.careers),
    renderExplorer(model.seasons, selectedSeason, selectedSeasonIndex),
  ].join('\n');
}

export function renderErrorPanel(error) {
  const details = error instanceof AggregateError ? error.errors : [];
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return `<section class="error-panel" role="alert" aria-labelledby="history-error-title">
    <h2 id="history-error-title">History unavailable</h2>
    <p>The historical data could not be validated, so no partial standings or analysis were shown.</p>
    <p><strong>Reason:</strong> ${escapeHtml(message)}</p>
    ${details.length === 0 ? '' : `<ul>${details.map((detail) => `<li>${escapeHtml(detail instanceof Error ? detail.message : detail)}</li>`).join('')}</ul>`}
  </section>`;
}

function buildSeasonModel(season, teamIds, participantById) {
  const derived = deriveSeason(season, teamIds);
  const selectionByParticipant = groupBy(season.selections, ({ participantId }) => participantId);
  const standings = derived.participants.map((participant) => ({
    participantId: participant.participantId,
    displayName: participantById.get(participant.participantId)?.displayName ?? participant.participantId,
    startingSlot: participant.startingSlot,
    rawPoolScore: participant.rawPoolScore,
    equivalentScore: participant.equivalentScore,
    rank: participant.rank,
    champion: participant.champion,
    teams: [...(selectionByParticipant.get(participant.participantId) ?? [])]
      .sort((left, right) => left.pick - right.pick)
      .map((selection) => teamModel(season, selection)),
  })).sort((left, right) => left.rank - right.rank || left.startingSlot - right.startingSlot);
  const picks = [...season.selections].sort((left, right) => left.pick - right.pick).map((selection) => ({
    ...teamModel(season, selection),
    participantId: selection.participantId,
    participantName: participantById.get(selection.participantId)?.displayName ?? selection.participantId,
  }));
  const undraftedTeams = derived.undraftedTeamIds.map((teamId) => teamModel(season, { teamId }));
  return {
    id: season.id,
    label: season.label,
    nflYear: season.nflYear,
    method: season.method,
    methodLabel: METHOD_LABELS[season.method] ?? season.method,
    notes: season.notes,
    standings,
    champions: standings.filter(({ champion }) => champion).map((champion) => ({ ...champion, winningScore: champion.rawPoolScore })),
    picks,
    undraftedTeams,
    latePicks: picks.filter(({ pick }) => pick >= 28),
  };
}

function teamModel(season, selection) {
  const record = season.records[selection.teamId];
  return {
    ...(selection.pick === undefined ? {} : { pick: selection.pick }),
    teamId: selection.teamId,
    abbreviation: record.abbreviation,
    displayName: record.displayName,
    wins: record.wins,
    losses: record.losses,
    ties: record.ties,
  };
}

function buildWinnerSlots(seasons) {
  return Array.from({ length: 10 }, (_, index) => {
    const slot = index + 1;
    const results = seasons.flatMap(({ id, label, standings }) => standings
      .filter(({ startingSlot }) => startingSlot === slot)
      .map((standing) => ({ seasonId: id, seasonLabel: label, ...standing })));
    return {
      slot,
      sampleCount: results.length,
      rawAverage: mean(results.map(({ rawPoolScore }) => rawPoolScore)),
      equivalentAverage: mean(results.map(({ equivalentScore }) => equivalentScore)),
      titles: results.filter(({ champion }) => champion),
    };
  });
}

function renderSummary(model, includedSeasons, method) {
  const titleCount = includedSeasons.reduce((total, season) => total + season.champions.length, 0);
  const filterLabel = method === 'all' ? 'All methods' : METHOD_LABELS[method];
  return `<section id="history-summary" aria-labelledby="history-summary-title">
    <p class="eyebrow">At a glance</p><h2 id="history-summary-title">${model.seasons.length} completed pools, one shared record</h2>
    <div class="summary-grid"><p><strong>${includedSeasons.length}</strong><span>completed seasons shown</span></p><p><strong>${titleCount}</strong><span>titles shown</span></p><p><strong>${model.participants.length}</strong><span>all-time participants</span></p></div>
    <div class="filter-bar" aria-label="Filter historical analyses by draft method"><span>Draft method</span>${methodButton('all', 'All', method)}${methodButton('simmons', 'Simmons', method)}${methodButton('el-dorado', 'El Dorado', method)}<span class="filter-status">Showing ${escapeHtml(filterLabel)}</span></div>
  </section>`;
}

function methodButton(value, label, selected) {
  return `<button type="button" data-method-filter="${value}" aria-pressed="${value === selected}">${label}</button>`;
}

function renderTimeline(seasons) {
  const seasonCards = seasons.map(renderSeasonCard);
  const insertionIndex = seasons.findIndex(({ nflYear }) => nflYear > 2020);
  const gap = `<article class="season-card no-pool" data-no-pool="2020"><p class="eyebrow">2020–21</p><h3>No pool</h3><p>This intentional gap is part of the timeline; no completed pool data exists for this season.</p></article>`;
  if (insertionIndex < 0) seasonCards.push(gap);
  else seasonCards.splice(insertionIndex, 0, gap);
  return `<section id="history-timeline" aria-labelledby="history-timeline-title"><p class="eyebrow">Season by season</p><h2 id="history-timeline-title">Championship timeline</h2><p>Titles and standings use each team’s raw regular-season win total.</p><div class="timeline">${seasonCards.join('')}</div></section>`;
}

function renderSeasonCard(season) {
  return `<article class="season-card" data-season-card="${escapeHtml(season.id)}"><p class="eyebrow">${escapeHtml(season.label)}</p><h3>${escapeHtml(season.methodLabel)} method</h3>${season.champions.map((champion) => `<div data-champion="${escapeHtml(champion.participantId)}"><p><strong>Champion${season.champions.length > 1 ? ' (tie)' : ''}:</strong> ${escapeHtml(champion.displayName)}</p><p><strong>Winning score:</strong> ${champion.winningScore} raw wins · <strong>Starting slot:</strong> ${champion.startingSlot}</p><p><strong>Team picks and records:</strong></p><ul>${champion.teams.map((team) => `<li>Pick ${team.pick}: ${renderTeam(team)}</li>`).join('')}</ul></div>`).join('')}</article>`;
}

function renderWinnerSlots(slots, method, fullHistorySlots) {
  const maxAverage = Math.max(1, ...slots.map(({ rawAverage }) => rawAverage ?? 0));
  const leadingTitleSlot = fullHistorySlots.reduce((leading, slot) => (
    leading === null || slot.titles.length > leading.titles.length ? slot : leading
  ), null);
  const titleClaim = leadingTitleSlot && leadingTitleSlot.titles.length > 0
    ? `Across the full history, slot ${leadingTitleSlot.slot} has ${leadingTitleSlot.titles.length} title${leadingTitleSlot.titles.length === 1 ? '' : 's'}.`
    : 'The full history has no title markers.';
  const svgGroups = slots.map((slot, index) => {
    const x = 22 + (index * 52);
    const height = Math.round(((slot.rawAverage ?? 0) / maxAverage) * 112);
    const y = 148 - height;
    const markers = slot.titles.map((title, markerIndex) => `<circle data-title-marker="${escapeHtml(title.seasonId)}" cx="${x + 15}" cy="${y + 14 + (markerIndex * 14)}" r="4"><title>${escapeHtml(title.displayName)}, ${escapeHtml(title.seasonLabel)} title</title></circle>`).join('');
    return `<g data-slot-column="${slot.slot}"><rect x="${x}" y="${y}" width="30" height="${height}"><title>Slot ${slot.slot}: ${formatNumber(slot.rawAverage)} average raw wins</title></rect>${markers}<text x="${x + 15}" y="168" text-anchor="middle">${slot.slot}</text><text x="${x + 15}" y="${Math.max(12, y - 3)}" text-anchor="middle">${formatNumber(slot.rawAverage)}</text></g>`;
  }).join('');
  return `<section id="history-winner-slot" aria-labelledby="history-winner-slot-title"><p class="eyebrow">Starting position</p><h2 id="history-winner-slot-title">Winner-slot analysis</h2><p>Bars show average raw pool score by starting slot for ${method === 'all' ? 'all completed seasons' : `${METHOD_LABELS[method]} seasons`}. Dots mark titles in the filtered chart. ${titleClaim}</p><div class="chart-scroll"><svg class="chart chart--slot" viewBox="0 0 570 180" role="img" aria-label="Average raw pool score and title markers for draft slots one through ten">${svgGroups}</svg></div><div class="table-scroll"><table class="chart-table"><caption>Table equivalent of the winner-slot chart</caption><thead><tr>${slots.map(({ slot }) => `<th scope="col">Slot ${slot}</th>`).join('')}</tr></thead><tbody><tr>${slots.map(({ rawAverage }) => `<td>${formatNumber(rawAverage)} avg. wins</td>`).join('')}</tr><tr>${slots.map(({ titles }) => `<td>${titles.length} title${titles.length === 1 ? '' : 's'}</td>`).join('')}</tr></tbody></table></div></section>`;
}

function renderLateBoard(seasons) {
  const summary = buildLateBoardSummary(seasons);
  const seasonLabel = `${summary.seasonCount}-season`;
  return `<section id="history-late-picks" aria-labelledby="history-late-picks-title"><p class="eyebrow">End of the board</p><h2 id="history-late-picks-title">Late picks and undrafted teams</h2><p>Each season shows picks 28–30 beside the two teams left undrafted. Raw wins remain the result that counted.</p><aside class="late-takeaway" data-late-takeaway aria-label="Late-board small-sample takeaway"><p class="eyebrow">Small-sample takeaway</p><p>In this small ${seasonLabel} sample, picks 28–30 averaged <strong>${formatNumber(summary.lateRawMean)} raw wins</strong>, while the two undrafted teams averaged <strong>${formatNumber(summary.undraftedRawMean)} raw wins</strong>. This describes these completed seasons; it does not establish a draft-position effect.</p></aside><div class="late-grid">${seasons.map(renderLateSeason).join('')}</div></section>`;
}

function buildLateBoardSummary(seasons) {
  const lateWins = seasons.flatMap(({ latePicks }) => latePicks.map(({ wins }) => wins));
  const undraftedWins = seasons.flatMap(({ undraftedTeams }) => undraftedTeams.map(({ wins }) => wins));
  return {
    seasonCount: seasons.length,
    latePickCount: lateWins.length,
    undraftedCount: undraftedWins.length,
    lateRawMean: mean(lateWins),
    undraftedRawMean: mean(undraftedWins),
  };
}

function renderLateSeason(season) {
  const entries = [...season.latePicks.map((team) => ({ ...team, label: `Pick ${team.pick}`, attribute: `data-late-pick="${team.pick}"` })), ...season.undraftedTeams.map((team, index) => ({ ...team, label: `Undrafted ${index + 1}`, attribute: `data-undrafted-team="${escapeHtml(team.teamId)}"` }))];
  const svg = entries.map((entry, index) => {
    const x = 18 + (index * 102);
    const height = entry.wins * 6;
    return `<g><rect x="${x}" y="${120 - height}" width="72" height="${height}"></rect><text x="${x + 36}" y="136" text-anchor="middle">${escapeHtml(entry.label.replace('Undrafted', 'U'))}</text><text x="${x + 36}" y="${Math.max(12, 114 - height)}" text-anchor="middle">${entry.wins} W</text></g>`;
  }).join('');
  return `<article data-late-season="${escapeHtml(season.id)}"><h3>${escapeHtml(season.label)}</h3><div class="chart-scroll"><svg class="chart chart--pick-value" viewBox="0 0 530 145" role="img" aria-label="${escapeHtml(`${season.label} picks 28 through 30 and undrafted teams by raw wins`)}">${svg}</svg></div><div class="table-scroll"><table data-responsive-table><caption>${escapeHtml(season.label)} late-board values</caption><thead><tr><th scope="col">Board position</th><th scope="col">Team</th><th scope="col">Record</th></tr></thead><tbody>${entries.map((entry) => `<tr ${entry.attribute}><th scope="row" data-label="Board position">${escapeHtml(entry.label)}</th><td data-label="Team">${renderTeamIdentity(entry)}</td><td data-label="Record">${recordText(entry)}</td></tr>`).join('')}</tbody></table></div></article>`;
}

function renderMethods(methods) {
  return `<section id="history-methods" aria-labelledby="history-methods-title"><p class="eyebrow">Draft formats</p><h2 id="history-methods-title">Method comparison</h2><p>These are small historical samples. The contrast describes this pool’s results and does not establish that either method is fairer.</p><div class="method-grid">${methods.map(renderMethodCard).join('')}</div></section>`;
}

function renderMethodCard(method) {
  const actualBest = bestSlot(method.actual.slots);
  const replayBest = bestSlot(method.perfectHindsight.slots);
  return `<article data-method-card="${escapeHtml(method.id)}"><h3>${escapeHtml(method.label)}</h3><p><strong>${method.sampleCount} seasons</strong> in the completed sample.</p><div class="result-kind"><h4>Actual results</h4><p>Champion slots: ${method.championSlots.length ? method.championSlots.join(', ') : 'none'}. Highest average equivalent score: slot ${actualBest.startingSlot}, ${formatNumber(actualBest.equivalentAverage)}.</p><p>Late picks: ${formatNumber(method.actual.lateBoard.late.equivalentMean)} equivalent wins on average (${method.actual.lateBoard.late.sampleCount} picks).</p></div><div class="result-kind counterfactual"><h4>Perfect-replay counterfactual</h4><p>With the highest-win remaining team assigned at every pick, slot ${replayBest.startingSlot} has the highest average equivalent score (${formatNumber(replayBest.equivalentAverage)}).</p><p>This is hindsight, not an alternate observed season.</p></div></article>`;
}

function renderCareers(careers) {
  return `<section id="history-careers" aria-labelledby="history-careers-title"><p class="eyebrow">All-time ledger</p><h2 id="history-careers-title">Participant careers</h2><p>Names use the canonical participant identity across source-workbook aliases.</p><div class="table-scroll"><table data-responsive-table><thead><tr><th scope="col">Participant</th><th scope="col">Titles</th><th scope="col">Seasons</th><th scope="col">Average finish</th><th scope="col">Best season</th><th scope="col">Best team</th><th scope="col">Average regret</th></tr></thead><tbody>${careers.map((career) => `<tr data-career-row="${escapeHtml(career.participantId)}"><th scope="row" data-label="Participant">${escapeHtml(career.displayName)}</th><td data-label="Titles">${career.titles}</td><td data-label="Seasons">${career.seasonsPlayed}</td><td data-label="Average finish">${formatNumber(career.averageFinish)}</td><td data-label="Best season">${career.bestRawSeason ? `${escapeHtml(career.bestRawSeason.nflYear)} · ${career.bestRawSeason.rawPoolScore} wins` : '—'}</td><td data-label="Best team">${career.bestSelection ? `<span class="team-badge">${escapeHtml(career.bestSelection.teamId.toUpperCase())}</span>${career.bestSelection.rawWins} wins` : '—'}</td><td data-label="Average regret">${formatNumber(career.averageHindsightRegret)} wins/pick</td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderExplorer(seasons, selectedSeason, selectedSeasonIndex) {
  if (!selectedSeason) return `<section id="history-explorer"><h2>Season explorer</h2><p>No season is available.</p></section>`;
  const options = seasons.map((season, index) => ({ season, index })).reverse();
  return `<section id="history-explorer" aria-labelledby="history-explorer-title"><p class="eyebrow">Every pick</p><h2 id="history-explorer-title">Season explorer</h2><label for="season-select">Completed season</label><select id="season-select">${options.map(({ season, index }) => `<option value="${escapeHtml(season.id)}"${index === selectedSeasonIndex ? ' selected' : ''}>${escapeHtml(season.label)}</option>`).join('')}</select><h3>${escapeHtml(selectedSeason.label)} final standings</h3><div class="table-scroll"><table data-responsive-table><thead><tr><th scope="col">Rank</th><th scope="col">Participant</th><th scope="col">Slot</th><th scope="col">Raw wins</th><th scope="col">17-game equivalent</th></tr></thead><tbody>${selectedSeason.standings.map((standing) => `<tr data-standing-row="${escapeHtml(standing.participantId)}"><td data-label="Rank">${standing.rank}</td><th scope="row" data-label="Participant">${escapeHtml(standing.displayName)}${standing.champion ? ' <span aria-label="champion">★</span>' : ''}</th><td data-label="Slot">${standing.startingSlot}</td><td data-label="Raw wins">${standing.rawPoolScore}</td><td data-label="17-game equivalent">${formatNumber(standing.equivalentScore)}</td></tr>`).join('')}</tbody></table></div><h3>Full draft: picks 1–30</h3><div class="table-scroll"><table data-responsive-table><thead><tr><th scope="col">Pick</th><th scope="col">Participant</th><th scope="col">Team</th><th scope="col">Record</th></tr></thead><tbody>${selectedSeason.picks.map((pick) => `<tr data-explorer-pick="${pick.pick}"><th scope="row" data-label="Pick">${pick.pick}</th><td data-label="Participant">${escapeHtml(pick.participantName)}</td><td data-label="Team">${renderTeamIdentity(pick)}</td><td data-label="Record">${recordText(pick)}</td></tr>`).join('')}</tbody></table></div><h3>Undrafted teams</h3><ul>${selectedSeason.undraftedTeams.map((team) => `<li data-explorer-undrafted="${escapeHtml(team.teamId)}">${renderTeam(team)}</li>`).join('')}</ul></section>`;
}

function renderTeam(team) {
  return `${renderTeamIdentity(team)}, ${recordText(team)}`;
}

function renderTeamIdentity(team) {
  return `<span class="team-badge">${escapeHtml(team.abbreviation)}</span>${escapeHtml(team.displayName)}`;
}

function recordText({ wins, losses, ties }) {
  return `${wins}–${losses}${ties ? `–${ties}` : ''}`;
}

function bestSlot(slots) {
  return slots.reduce((best, slot) => best === null || (slot.equivalentAverage ?? -Infinity) > (best.equivalentAverage ?? -Infinity) ? slot : best, null);
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function formatNumber(value) {
  return value === null || value === undefined ? '—' : Number(value.toFixed(1)).toString();
}

function groupBy(values, keyOf) {
  const groups = new Map();
  for (const value of values) {
    const key = keyOf(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
