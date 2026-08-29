'use strict';
/* THE REPRESENTATIVE PLANS — one compact table per athlete, so the plans can
   be read as plans rather than as counts. Audit tooling; writes to
   test/audit/out/ and is not part of the app. */
const fs = require('fs');
const path = require('path');
const { auditCase } = require('./planAudit.js');

const VOLUMES = [1, 3, 5, 10, 20, 30, 40, 50, 70, 100];
const DISTS = ['5k', '10k', 'half', 'full'];
const WEEKS = 12, SCHEDULE = 'd5';

function pad(s, n){ s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s, n){ s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function planTable(c){
  const L = [];
  L.push('  wk phase        target  actual   long   easy/d  quality   long%  qual%   note');
  c.weeks.forEach(w => {
    const easyS = w.sessions.filter(s => s.type === 'easy' && s.km > 0);
    const perEasy = easyS.length ? easyS[0].km : 0;
    const flags = [];
    const longS = w.sessions.find(s => s.type === 'long');
    if (longS && longS.segments){
      const neg = longS.segments.find(g => g.km != null && g.km < 0);
      const zero = longS.segments.find(g => g.kind === 'work' && g.km === 0);
      if (neg) flags.push('EASY ' + neg.km + 'km');
      else if (zero) flags.push('EASY 0km');
    }
    if (longS && longS.km === 0 && !w.isRace) flags.push('LONG RUN = 0km');
    if (longS && longS.km > 0 && easyS.length && longS.km < perEasy) flags.push('long<easy');
    if (w.isCutback) flags.push('cutback');
    if (w.isTaper) flags.push('taper');
    if (w.isRace) flags.push('RACE');
    L.push('  ' + lpad(w.week, 2) + ' ' + pad(w.phase, 12) +
      lpad(w.targetVolume, 6) + lpad(w.actualVolume, 8) +
      lpad(longS ? longS.km : '-', 7) + lpad(perEasy, 9) + lpad(w.qualityKm, 9) +
      lpad(w.longFraction != null ? (w.longFraction * 100).toFixed(0) + '%' : '-', 7) +
      lpad(w.qualityFraction != null ? (w.qualityFraction * 100).toFixed(0) + '%' : '-', 7) +
      '   ' + flags.join(', '));
  });
  return L.join('\n');
}

function run(){
  const L = [];
  L.push('REPRESENTATIVE GENERATED PLANS');
  L.push('12-week block, 5 running days (Tue/Wed/Thu/Sat/Sun), long run Sunday, no prior history.');
  L.push('target = the weekly volume the generator intended; actual = the sum of the days it built.');
  L.push('');
  DISTS.forEach(d => {
    VOLUMES.forEach(v => {
      const c = auditCase({ distanceKey: d, volume: v, weeks: WEEKS, scheduleKey: SCHEDULE });
      L.push('='.repeat(100));
      L.push(d.toUpperCase() + '   stated current volume ' + v + ' km/week   ' +
             '(peak target ' + c.peakVolume + ', long cap ' + c.profile.longCapKm + ')');
      L.push('='.repeat(100));
      L.push(planTable(c));
      const w3 = c.weeks.find(x => x.week === 3);
      const long3 = w3 && w3.sessions.find(s => s.type === 'long');
      if (long3 && long3.segments)
        L.push('  week 3 long run as the athlete reads it: "' +
               long3.title + '" — ' + long3.segments.map(g =>
                 g.intensity + ' ' + (g.km != null ? g.km + 'km' : '?')).join(' + '));
      L.push('');
    });
  });
  const dest = path.join(__dirname, 'out', 'representative-plans.txt');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, L.join('\n'));
  return dest;
}
if (require.main === module) console.log('written to ' + run());
module.exports = { run, planTable };
