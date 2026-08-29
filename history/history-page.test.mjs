import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { HISTORY_DATA } from './history-data.mjs';
import { buildHistoryViewModel, renderHistoryApp } from './history-render.mjs';

const INDEX_URL = new URL('./index.html', import.meta.url);
const CSS_URL = new URL('./history.css', import.meta.url);

async function readPageFiles() {
  const html = await readFile(INDEX_URL, 'utf8');
  const css = await readFile(CSS_URL, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  return { html, css };
}

test('the page loads one local stylesheet and one local module without inline or remote assets', async () => {
  const { html, css } = await readPageFiles();
  const stylesheetLinks = [...html.matchAll(/<link\b([^>]*)>/gi)]
    .map((match) => match[1])
    .filter((attributes) => /\brel=["']stylesheet["']/i.test(attributes));
  const scripts = [...html.matchAll(/<script\b([^>]*)>([^<]*)<\/script>/gi)];

  assert.equal(stylesheetLinks.length, 1);
  assert.match(stylesheetLinks[0], /\bhref=["']\.\/history\.css["']/i);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /\btype=["']module["']/i);
  assert.match(scripts[0][1], /\bsrc=["']\.\/history\.mjs["']/i);
  assert.equal(scripts[0][2].trim(), '');
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<(?:script|link|img|source)\b[^>]*(?:src|href)=["'](?:https?:)?\/\//i);
  assert.doesNotMatch(css, /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i);
});

test('the viewport and keyboard-visible skip link target the main content', async () => {
  const { html, css } = await readPageFiles();
  const viewport = html.match(/<meta\b[^>]*name=["']viewport["'][^>]*>/i)?.[0] ?? '';
  const skipLink = html.match(/<a\b([^>]*class=["'][^"']*skip-link[^"']*["'][^>]*)>([^<]+)<\/a>/i);

  assert.match(viewport, /content=["'][^"']*width=device-width[^"']*initial-scale=1[^"']*["']/i);
  assert.ok(skipLink, 'a textual skip link is present');
  assert.match(skipLink[2], /skip/i);
  const targetId = skipLink[1].match(/href=["']#([^"']+)["']/i)?.[1];
  assert.ok(targetId, 'the skip link has a fragment target');
  const target = html.match(new RegExp(`<[^>]+\\bid=["']${targetId}["'][^>]*>`))?.[0] ?? '';
  assert.match(target, /\btabindex=["']-1["']/i, 'the target can receive focus without entering the normal tab order');
  assert.match(css, /\.skip-link:focus-visible\s*\{[^}]*\btop\s*:\s*(?:var\([^)]*\)|[^-][^;}]*)/is);
});

test('public methodology omits internal recovery details', async () => {
  const { html } = await readPageFiles();

  assert.doesNotMatch(html, /Recovered source fact/i);
  assert.doesNotMatch(html, /2024[^<]*Carolina[^<]*git history/i);
});

test('the visual layer defines the approved palette and layout tokens', async () => {
  const { css } = await readPageFiles();

  for (const token of [
    '--color-navy',
    '--color-paper',
    '--color-field',
    '--color-gold',
    '--color-ink',
    '--color-muted',
    '--space-1',
    '--space-6',
    '--radius-card',
    '--color-focus',
  ]) {
    assert.match(css, new RegExp(`${token}\\s*:`), `${token} is defined`);
  }
});

test('keyboard focus is strongly visible without removing native focus', async () => {
  const { css } = await readPageFiles();
  const focusRules = [...css.matchAll(/([^{}]*:focus-visible[^{}]*)\{([^}]*)\}/gi)];

  assert.ok(focusRules.length > 0, 'at least one :focus-visible rule exists');
  assert.match(focusRules.map((match) => match[2]).join('\n'), /outline\s*:\s*(?:3px|0\.1875rem)\s+solid\s+var\(--color-focus\)/i);
  assert.match(focusRules.map((match) => match[2]).join('\n'), /outline-offset\s*:\s*(?:3px|0\.1875rem)/i);
  assert.doesNotMatch(css, /:focus(?:-visible)?[^{}]*\{[^}]*outline\s*:\s*(?:0|none)\b/is);
});

test('narrow layouts stack wide table rows with explicit labels and do not mask overflow defects', async () => {
  const { css } = await readPageFiles();
  const rendered = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA));
  const responsiveRows = [...rendered.matchAll(/<tr\b[^>]*data-(?:career-row|standing-row|explorer-pick|late-pick|undrafted-team)=["'][^"']+["'][^>]*>([\s\S]*?)<\/tr>/gi)];

  assert.match(css, /@media\s*\([^)]*max-width\s*:[^)]+\)/i);
  assert.match(css, /\[data-responsive-table\][^{]*\{[^}]*display\s*:\s*(?:block|grid)/is);
  assert.match(css, /\[data-label\]::before\s*\{[^}]*content\s*:\s*attr\(data-label\)/is);
  assert.match(css, /\.chart-table\s*\{[^}]*min-width\s*:\s*(?:4[5-9]|5[0-2])rem/is);
  assert.ok(responsiveRows.length > 0, 'responsive data rows are rendered');
  for (const [index, row] of responsiveRows.entries()) {
    const cells = [...row[1].matchAll(/<(?:th|td)\b([^>]*)>/gi)];
    assert.ok(cells.length > 0, `row ${index + 1} has cells`);
    for (const cell of cells) assert.match(cell[1], /\bdata-label=["'][^"']+["']/i);
  }
  assert.doesNotMatch(css, /overflow-x\s*:\s*hidden\b/i);
});

test('timeline, method cards, charts, and team badges have resilient visual hooks', async () => {
  const { css } = await readPageFiles();
  const rendered = renderHistoryApp(buildHistoryViewModel(HISTORY_DATA));

  assert.match(css, /\.timeline\s*\{[^}]*grid-template-columns\s*:\s*repeat\(7\s*,\s*minmax\((?:1[89]|20)rem\s*,\s*1fr\)\)/is);
  assert.match(css, /@media\s*\([^)]*max-width[^)]*\)[\s\S]*?\.timeline\s*\{[^}]*grid-template-columns\s*:\s*1fr/is);
  assert.match(css, /\.method-grid\s*\{[^}]*grid-template-columns\s*:\s*repeat\(/is);
  assert.match(css, /\.counterfactual\s*\{[^}]*(?:border|background)/is);
  assert.match(rendered, /<svg\b[^>]*class=["'][^"']*chart--slot[^"']*["'][^>]*>/i);
  assert.match(rendered, /<svg\b[^>]*class=["'][^"']*chart--pick-value[^"']*["'][^>]*>/i);
  assert.match(rendered, /class=["']team-badge["']/i);
});

test('reduced-motion and print modes preserve readable content and data', async () => {
  const { css } = await readPageFiles();
  const reducedMotion = css.match(/@media\s*\(prefers-reduced-motion\s*:\s*reduce\)\s*\{([\s\S]*?)\n\}/i)?.[1] ?? '';
  const printRules = css.match(/@media\s+print\s*\{([\s\S]*?)\n\}/i)?.[1] ?? '';

  assert.match(reducedMotion, /scroll-behavior\s*:\s*auto/i);
  assert.match(reducedMotion, /transition(?:-duration)?\s*:\s*(?:none|0\.01ms|0s)/i);
  assert.match(printRules, /color\s*:\s*#(?:111(?:111)?|000(?:000)?)/i);
  assert.match(printRules, /background(?:-color)?\s*:\s*#(?:fff(?:fff)?|ffffff)/i);
  assert.match(printRules, /(?:svg|table)/i);
  assert.match(printRules, /\.chart-table\s*\{[^}]*min-width\s*:\s*0/is);
  assert.match(printRules, /\.late-takeaway\s*,/i);
  assert.match(printRules, /\.late-takeaway \.eyebrow\s*,/i);
  assert.doesNotMatch(printRules, /display\s*:\s*none[^}]*?(?:section|table|svg|methodology)/is);
});

test('print fully restores responsive tables to paginating table semantics', async () => {
  const { css } = await readPageFiles();
  const printRules = css.match(/@media\s+print\s*\{([\s\S]*?)\n\}/i)?.[1] ?? '';

  assert.match(printRules, /table\[data-responsive-table\]\s*\{[^}]*display\s*:\s*table[^}]*width\s*:\s*100%/is);
  assert.match(printRules, /\[data-responsive-table\] caption\s*\{[^}]*display\s*:\s*table-caption[^}]*width\s*:\s*auto/is);
  assert.match(printRules, /\[data-responsive-table\] thead\s*\{[^}]*display\s*:\s*table-header-group[^}]*position\s*:\s*static[^}]*width\s*:\s*auto[^}]*overflow\s*:\s*visible/is);
  assert.match(printRules, /\[data-responsive-table\] tbody\s*\{[^}]*display\s*:\s*table-row-group[^}]*width\s*:\s*auto[^}]*grid-template-columns\s*:\s*none[^}]*gap\s*:\s*0/is);
  assert.match(printRules, /\[data-responsive-table\] tr\s*\{[^}]*display\s*:\s*table-row[^}]*width\s*:\s*auto[^}]*overflow\s*:\s*visible/is);
  assert.match(printRules, /\[data-responsive-table\] \[data-label\]\s*\{[^}]*display\s*:\s*table-cell[^}]*width\s*:\s*auto[^}]*grid-template-columns\s*:\s*none[^}]*gap\s*:\s*0/is);
});

test('print uses portrait-friendly grids and paginates long tables between intact rows', async () => {
  const { css } = await readPageFiles();
  const printRules = css.match(/@media\s+print\s*\{([\s\S]*?)\n\}/i)?.[1] ?? '';

  assert.match(printRules, /\.late-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr/is);
  assert.match(printRules, /\.method-grid\s*\{[^}]*grid-template-columns\s*:\s*1fr/is);
  assert.match(printRules, /table\s*\{[^}]*break-inside\s*:\s*auto/is);
  assert.match(printRules, /tr\s*\{[^}]*break-inside\s*:\s*avoid/is);
  assert.match(printRules, /\[data-late-season\]\s*\{[^}]*break-inside\s*:\s*avoid/is);
  assert.match(printRules, /:where\(h1, h2, h3, h4, p, li, td, th\)\s*\{[^}]*overflow-wrap\s*:\s*normal/is);
  assert.doesNotMatch(printRules, /table\s*,[^{}]*\{[^}]*break-inside\s*:\s*avoid/is);
});

test('print hides interactive controls without hiding analytical content', async () => {
  const { css } = await readPageFiles();
  const printRules = css.match(/@media\s+print\s*\{([\s\S]*?)\n\}/i)?.[1] ?? '';

  assert.match(printRules, /\.skip-link\s*,\s*\.filter-bar\s*,\s*\[data-history-live\]\s*,\s*#history-explorer > label\s*,\s*#season-select\s*\{[^}]*display\s*:\s*none/is);
  assert.doesNotMatch(printRules, /(?:section|article|table|svg|\.methodology)\s*\{[^}]*display\s*:\s*none/is);
});
