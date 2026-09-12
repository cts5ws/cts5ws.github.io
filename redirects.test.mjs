import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const pages = [
  ['index.html', 'https://campcusty.com/nflwinspool/'],
  ['history/index.html', 'https://campcusty.com/nflwinspool/history/'],
];

for (const [file, destination] of pages) {
  const html = await readFile(new URL(file, import.meta.url), 'utf8');

  test(`${file} provides an accessible static fallback`, () => {
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>[^<]+moved[^<]*<\/title>/i);
    assert.match(html, /<main>/);
    assert.match(html, /<h1>[^<]+<\/h1>/);
    assert.ok(html.includes(`<a id="destination" href="${destination}">`));
    assert.match(html, /<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/);
    assert.ok(html.includes(`<link rel="canonical" href="${destination}">`));
  });

  for (const [search, hash] of [
    ['', ''],
    ['?season=2025&method=snake', ''],
    ['', '#season-explorer'],
    ['?name=A%26B&name=C+Doe', '#career%20standings'],
    ['?next=https://example.com/&x=%23', '#https://example.com/'],
  ]) {
    test(`${file} replaces browser history while preserving ${search}${hash || ' (no fragment)'}`, () => {
      const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
      assert.equal(scripts.length, 1, 'one self-contained redirect script');
      assert.doesNotMatch(html, /<script[^>]+src=/i);
      const link = { href: destination };
      const replacements = [];
      const location = { search, hash, replace: (url) => replacements.push(url) };
      vm.runInNewContext(scripts[0][1], {
        window: { location },
        document: { getElementById: (id) => {
          assert.equal(id, 'destination');
          return link;
        } },
      });
      assert.deepEqual(replacements, [destination + search + hash]);
      assert.equal(link.href, destination + search + hash);
    });
  }
}
