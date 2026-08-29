import { validateSeason } from './history-analytics.mjs';
import { HISTORY_DATA } from './history-data.mjs';
import { buildHistoryViewModel, renderErrorPanel, renderHistoryApp } from './history-render.mjs';

const METHOD_ANNOUNCEMENTS = Object.freeze({
  all: 'Showing all draft methods.',
  simmons: 'Showing Simmons seasons.',
  'el-dorado': 'Showing El Dorado seasons.',
});
const APP_SHELL = '<div data-history-content></div><p class="visually-hidden" data-history-live aria-live="polite" aria-atomic="true"></p>';

export function startHistoryApp({
  root,
  historyData = HISTORY_DATA,
  validate = validateSeason,
  build = buildHistoryViewModel,
  renderApp = renderHistoryApp,
  renderError = renderErrorPanel,
}) {
  const showError = (error) => {
    root.innerHTML = renderError(error);
  };

  try {
    const teamIds = historyData.teams.map(({ id }) => id);
    const participantIds = historyData.participants.map(({ id }) => id);
    const errors = [];
    for (const season of historyData.seasons) {
      const seasonId = season?.id ?? '(unknown)';
      for (const message of validate(season, teamIds, participantIds)) {
        errors.push(`Season ${seasonId}: ${message}`);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Historical season validation failed');
    }

    const model = build(historyData);
    const state = { method: 'all', seasonId: model.defaultSeasonId };
    let content = null;
    let liveRegion = null;

    const render = ({ focusMethod = null, focusSeason = false, announcement = '' } = {}) => {
      const html = renderApp(model, state);
      if (content === null) {
        root.innerHTML = APP_SHELL;
        content = root.querySelector('[data-history-content]');
        liveRegion = root.querySelector('[data-history-live]');
        if (!content || !liveRegion) throw new Error('History application mount failed.');
      }
      content.innerHTML = html;
      for (const button of content.querySelectorAll('[data-method-filter]')) {
        button.addEventListener('click', () => {
          state.method = button.dataset.methodFilter;
          try {
            render({
              focusMethod: state.method,
              announcement: METHOD_ANNOUNCEMENTS[state.method] ?? 'History filter updated.',
            });
          } catch (error) {
            showError(error);
          }
        });
      }
      content.querySelector('#season-select')?.addEventListener('change', (event) => {
        state.seasonId = event.currentTarget.value;
        try {
          const seasonLabel = model.seasons.find(({ id }) => id === state.seasonId)?.label ?? state.seasonId;
          render({ focusSeason: true, announcement: `Showing season ${seasonLabel}.` });
        } catch (error) {
          showError(error);
        }
      });
      if (focusMethod !== null) {
        [...content.querySelectorAll('[data-method-filter]')]
          .find((button) => button.dataset.methodFilter === focusMethod)?.focus();
      } else if (focusSeason) {
        content.querySelector('#season-select')?.focus();
      }
      if (announcement) liveRegion.textContent = announcement;
    };

    render();
    return { ok: true, render, state: { ...state } };
  } catch (error) {
    showError(error);
    return { ok: false };
  }
}

if (typeof document !== 'undefined') {
  const root = document.querySelector('#history-app');
  if (root) startHistoryApp({ root });
}
