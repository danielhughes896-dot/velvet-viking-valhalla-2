'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

/* A MERGE THAT LEFT ITS MARKERS SHIPS BROKEN CSS QUIETLY. A stray
   "=======" line in the stylesheet once swallowed the rule after it and
   nothing else noticed. No tracked text file may carry a conflict marker. */
test('no tracked file carries a merge conflict marker', () => {
  const root = path.join(__dirname, '..');
  const files = execSync('git ls-files', { cwd: root }).toString().split('\n')
    .filter(f => /\.(html|js|json|css|md|sql|yml|kt|swift|xml|gradle)$/.test(f) && f !== 'test/noConflictMarkers.test.js');
  const hits = [];
  files.forEach(f => {
    let src; try { src = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { return; }
    src.split('\n').forEach((line, i) => {
      if (/^(<{7}|>{7})( |$)/.test(line) || /^={7}$/.test(line)) hits.push(f + ':' + (i + 1));
    });
  });
  assert.deepEqual(hits, [], 'conflict markers left in: ' + hits.join(', '));
});
