'use strict';
/* THE CREST, SIZED FOR THE SCREEN IT IS ACTUALLY SHOWN ON.
 * ===========================================================================
 * assets/velvet-viking-crest.png is 1223x1286 RGBA, 2,100,661 bytes. It is
 * rendered by .medallion-img at width:180px -- so on a 3x phone it is drawn at
 * 540 device pixels, and every pixel beyond that is downloaded and thrown away.
 *
 * THE ORIGINAL IS THE MASTER AND IS NEVER TOUCHED. This writes DELIVERY
 * variants beside it and reports what each costs, so the choice of which one
 * ships is made on measured evidence rather than on a guess about quality.
 *
 * sharp is a one-off authoring tool, not a runtime or test dependency of this
 * project, and is deliberately NOT in package.json -- nothing the app or the
 * suite does requires it. Install it where you like:
 *
 *   npm i sharp --no-save
 *   node tools/assets/crest-variants.js [outDir]
 */
const fs = require('fs');
const path = require('path');

let sharp;
for (const p of ['sharp', process.env.SHARP_PATH].filter(Boolean)){
  try { sharp = require(p); break; } catch (e) { /* try the next */ }
}
if (!sharp){
  console.error('sharp not found. Install it first:  npm i sharp --no-save');
  console.error('or point SHARP_PATH at an existing copy.');
  process.exit(1);
}

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'assets', 'velvet-viking-crest.png');
const OUT = process.argv[2] || path.join(__dirname, 'crest-out');

/* 180 CSS px is the rendered width. 540 covers a 3x phone exactly; 360 covers
   2x; 720 is deliberate headroom for a 4x display that does not yet exist, to
   show what that headroom costs. */
const WIDTHS = [360, 540, 720];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const src = fs.readFileSync(SRC);
  const meta = await sharp(src).metadata();
  const rows = [];
  rows.push({ label: 'ORIGINAL (master)', file: 'velvet-viking-crest.png',
              w: meta.width, h: meta.height, bytes: src.length, format: meta.format,
              alpha: meta.hasAlpha });

  for (const w of WIDTHS){
    /* Lanczos3 is sharp's default for downscale and is the right filter for
       artwork with fine gold linework -- a box filter softens the runes. */
    const base = sharp(src).resize({ width: w, kernel: 'lanczos3', withoutEnlargement: true });

    const png = await base.clone().png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
    /* A palette PNG is the one lossy-ish option worth testing for a crest:
       gold gradients can band, so it is measured rather than assumed. */
    const png8 = await base.clone().png({ compressionLevel: 9, effort: 10, palette: true, quality: 90 }).toBuffer();
    const webp = await base.clone().webp({ quality: 88, effort: 6, alphaQuality: 100 }).toBuffer();
    const webpLossless = await base.clone().webp({ lossless: true, effort: 6 }).toBuffer();
    const avif = await base.clone().avif({ quality: 60, effort: 6 }).toBuffer();

    const each = [['png', png], ['png8', png8], ['webp', webp],
                  ['webp-lossless', webpLossless], ['avif', avif]];
    for (const [kind, buf] of each){
      const ext = kind.indexOf('webp') === 0 ? 'webp' : (kind === 'avif' ? 'avif' : 'png');
      const name = 'crest-' + w + '-' + kind + '.' + ext;
      fs.writeFileSync(path.join(OUT, name), buf);
      const m = await sharp(buf).metadata();
      rows.push({ label: w + 'px ' + kind, file: name, w: m.width, h: m.height,
                  bytes: buf.length, format: m.format, alpha: m.hasAlpha });
    }
  }

  const orig = rows[0].bytes;
  console.log('\n' + 'variant'.padEnd(22) + 'size'.padStart(12) + 'saving'.padStart(10) +
              '  dims'.padEnd(14) + ' alpha');
  console.log('-'.repeat(70));
  rows.forEach(r => {
    const kb = (r.bytes / 1024).toFixed(1) + ' KB';
    const save = r.bytes === orig ? '--' : ((1 - r.bytes / orig) * 100).toFixed(1) + '%';
    console.log(r.label.padEnd(22) + kb.padStart(12) + save.padStart(10) +
                ('  ' + r.w + 'x' + r.h).padEnd(14) + ' ' + (r.alpha ? 'yes' : 'NO'));
  });
  fs.writeFileSync(path.join(OUT, 'sizes.json'), JSON.stringify(rows, null, 1));
  console.log('\n-> ' + OUT);
})();
