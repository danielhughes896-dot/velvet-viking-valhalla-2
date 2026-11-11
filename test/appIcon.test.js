'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* WHAT THE OPERATING SYSTEM DRAWS BEFORE THE APP DOES
 * ===========================================================================
 * The icon and the launch screen. Between them they are everything an athlete
 * sees of this product before a line of it has run, and they are the pieces
 * with no screen to check them on. A broken icon does not throw, does not
 * render blank, and does not appear in any screenshot the suite takes -- it
 * just sits on a phone being wrong.
 *
 * Three ways it goes wrong quietly, and a law each:
 *
 *   1. A href points at a file that is not there. The browser shows its own
 *      default and nobody notices for a month.
 *   2. The favicon is a full-size export. For most of this app's life every
 *      public page pulled a 1.7 MB badge to paint 16 CSS pixels -- over mobile
 *      data, on the first paint, five pages deep.
 *   3. The Android adaptive foreground is drawn full-bleed. Android insets it
 *      and then masks it to the launcher's shape, so artwork that looks right
 *      in a file browser gets its outer ring sliced off on the device. There
 *      is no way to see this without doing the mask arithmetic, which is what
 *      the last section of this file does.
 */

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

/* Every page in the product that has a <head> of its own. */
const PAGES = ['start.html', 'account.html', 'privacy.html', 'terms.html',
               'get.html', RUNTIME_RELATIVE];

const FAVICON = '/assets/favicon.png';
const TOUCH = '/assets/apple-touch-icon.png';

// ---------------------------------------------------------------------------
// PNG, read rather than trusted
// ---------------------------------------------------------------------------

/* Header only -- dimensions and encoding, no pixels. */
function pngHead(file){
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(33);
  fs.readSync(fd, buf, 0, 33, 0);
  fs.closeSync(fd);
  assert.equal(buf.slice(0, 8).toString('binary'), '\x89PNG\r\n\x1a\n', file + ' is not a PNG');
  assert.equal(buf.slice(12, 16).toString('ascii'), 'IHDR', file + ' has no IHDR');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20),
           depth: buf[24], colour: buf[25], bytes: fs.statSync(file).size };
}

/* Full decode: inflate the IDAT stream and undo the per-row filters. Only the
   two encodings this repo's icons use (8-bit RGB and 8-bit RGBA, no
   interlacing) -- anything else fails loudly rather than being guessed at. */
function pngPixels(file){
  const buf = fs.readFileSync(file);
  assert.equal(buf.slice(0, 8).toString('binary'), '\x89PNG\r\n\x1a\n', file + ' is not a PNG');
  let off = 8, w = 0, h = 0, depth = 0, colour = 0;
  const idat = [];
  while (off + 8 <= buf.length){
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('ascii');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR'){
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colour = data[9];
      assert.equal(data[12], 0, file + ' is interlaced; this reader does not handle that');
    } else if (type === 'IDAT'){ idat.push(data); }
    else if (type === 'IEND'){ break; }
    off += 12 + len;
  }
  assert.equal(depth, 8, file + ' is not 8 bits per channel');
  const ch = colour === 2 ? 3 : colour === 6 ? 4 : 0;
  assert.ok(ch, file + ' is colour type ' + colour + '; expected 2 (RGB) or 6 (RGBA)');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  assert.equal(raw.length, h * (stride + 1), file + ' decoded to the wrong length');
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++){
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride, up = row - stride;
    for (let x = 0; x < stride; x++){
      const a = x >= ch ? px[row + x - ch] : 0;
      const b = y ? px[up + x] : 0;
      const c = (y && x >= ch) ? px[up + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4){
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (f !== 0) assert.fail(file + ' uses unknown row filter ' + f);
      px[row + x] = v & 255;
    }
  }
  return { w: w, h: h, ch: ch, px: px };
}

/* The bounding box of everything that is not the black ground. The artwork is
   gold on black, so anything appreciably above black is ink. */
function inkBox(img){
  let x0 = img.w, y0 = img.h, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++){
    for (let x = 0; x < img.w; x++){
      const i = y * img.w * img.ch + x * img.ch;
      if (img.ch === 4 && img.px[i + 3] < 8) continue;
      if (Math.max(img.px[i], img.px[i + 1], img.px[i + 2]) <= 24) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  assert.ok(x1 >= 0, 'the image is entirely black -- there is no mark in it');
  return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// ---------------------------------------------------------------------------
// 1. EVERY DECLARED ICON IS A FILE THAT EXISTS
// ---------------------------------------------------------------------------
test('every icon a page declares resolves to a file on disk', () => {
  const re = /<link rel="(icon|apple-touch-icon)"[^>]*href="([^"]+)"/g;
  let found = 0;
  PAGES.forEach(p => {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    let m;
    while ((m = re.exec(html))){
      found++;
      assert.ok(m[2].charAt(0) === '/',
        p + ' declares ' + m[1] + ' as "' + m[2] + '"; icon hrefs are site-absolute ' +
        'because these pages are served from more than one path depth');
      const file = path.join(ROOT, m[2].replace(/^\//, ''));
      assert.ok(fs.existsSync(file),
        p + ' declares ' + m[1] + ' = ' + m[2] + ', which does not exist -- the ' +
        'browser will fall back to its own default and nothing else will complain');
    }
  });
  assert.equal(found, PAGES.length * 2,
    'every page declares exactly one icon and one apple-touch-icon; found ' + found +
    ' declarations across ' + PAGES.length + ' pages');
});

test('every page points at the same mark', () => {
  PAGES.forEach(p => {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert.ok(html.indexOf('<link rel="icon" href="' + FAVICON + '">') > -1,
      p + ' does not use ' + FAVICON + ' -- one product, one mark');
    assert.ok(html.indexOf('<link rel="apple-touch-icon" href="' + TOUCH + '">') > -1,
      p + ' does not use ' + TOUCH);
  });
});

test('the runtime names a file rather than carrying a mark inline', () => {
  /* It used to inline the retired chevron as 1.7 kB of SVG data URI, which is
     a second mark in a second format that no asset pipeline ever touches.
     When the product was renamed, that one was missed. */
  assert.ok(!/rel="icon"[^>]*href="data:/.test(APP),
    'the runtime carries its favicon inline again; an inline mark is invisible ' +
    'to every tool that regenerates the icon set, so it is the one that goes stale');
});

// ---------------------------------------------------------------------------
// 2. A FAVICON IS FAVICON-SIZED
// ---------------------------------------------------------------------------
test('the favicon is small enough to be a favicon', () => {
  const f = pngHead(path.join(ROOT, FAVICON.replace(/^\//, '')));
  assert.ok(f.w <= 96 && f.h <= 96,
    'the favicon is ' + f.w + 'x' + f.h + '; it is painted at 16 to 32 CSS px');
  assert.ok(f.bytes <= 24 * 1024,
    'the favicon is ' + Math.round(f.bytes / 1024) + ' KB. Every public page pulls ' +
    'this on first paint. It was once 1.7 MB and no test noticed for months');
});

test('the touch icon is the size iOS asks for', () => {
  const t = pngHead(path.join(ROOT, TOUCH.replace(/^\//, '')));
  assert.equal(t.w, 180, 'apple-touch-icon is 180x180; anything else gets resampled by the OS');
  assert.equal(t.h, 180);
  assert.ok(t.bytes <= 64 * 1024, 'the touch icon is ' + Math.round(t.bytes / 1024) + ' KB');
});

test('the share card and the notification icon are served something legible', () => {
  /* /assets/icon.png is the og:image on get.html and the icon on every push
     notification -- the two places the mark is drawn at a size that is neither
     a favicon nor a home screen. */
  const i = pngHead(path.join(ROOT, 'assets', 'icon.png'));
  assert.ok(i.w >= 192, '/assets/icon.png is ' + i.w + 'px; a share card wants at least 192');
  assert.ok(i.w <= 512,
    '/assets/icon.png is ' + i.w + 'px. Nothing draws it larger than a share card ' +
    'preview, and a notification pulls it over whatever connection the phone has');
  assert.ok(i.bytes <= 160 * 1024,
    '/assets/icon.png is ' + Math.round(i.bytes / 1024) + ' KB and is fetched by every ' +
    'notification; the master belongs in assets/, not on the wire');
  assert.match(APP, /icon:\s*'\/assets\/icon\.png'/,
    'the notification no longer names the icon it draws');
});

// ---------------------------------------------------------------------------
// 3. THE ANDROID SET IS COMPLETE
// ---------------------------------------------------------------------------
/* Launcher size per density, and the adaptive layers at 108dp against the same
   scale -- 108/48 = 2.25x the launcher size. */
const DENSITIES = [
  { dir: 'mipmap-ldpi',    launcher:  36, layer:  81 },
  { dir: 'mipmap-mdpi',    launcher:  48, layer: 108 },
  { dir: 'mipmap-hdpi',    launcher:  72, layer: 162 },
  { dir: 'mipmap-xhdpi',   launcher:  96, layer: 216 },
  { dir: 'mipmap-xxhdpi',  launcher: 144, layer: 324 },
  { dir: 'mipmap-xxxhdpi', launcher: 192, layer: 432 }
];
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

test('every density carries a full icon set at the right pixel size', () => {
  DENSITIES.forEach(d => {
    [['ic_launcher.png', d.launcher], ['ic_launcher_round.png', d.launcher],
     ['ic_launcher_foreground.png', d.layer], ['ic_launcher_background.png', d.layer]
    ].forEach(([name, px]) => {
      const file = path.join(RES, d.dir, name);
      assert.ok(fs.existsSync(file), d.dir + '/' + name + ' is missing; a half-regenerated ' +
        'icon set ships the old mark on exactly the phones you do not own');
      const p = pngHead(file);
      assert.equal(p.w, px, d.dir + '/' + name + ' is ' + p.w + 'px, expected ' + px);
      assert.equal(p.h, px, d.dir + '/' + name + ' is ' + p.h + 'px tall, expected ' + px);
    });
  });
});

test('the adaptive icon still declares the inset the safe-zone sum assumes', () => {
  ['ic_launcher.xml', 'ic_launcher_round.xml'].forEach(f => {
    const xml = fs.readFileSync(path.join(RES, 'mipmap-anydpi-v26', f), 'utf8');
    assert.match(xml, /android:inset="16\.7%"/,
      f + ' changed its inset. The foreground artwork is sized against 16.7% ' +
      '(108dp drawn into 72dp); change one and the next test below is wrong');
    assert.match(xml, /@mipmap\/ic_launcher_foreground/, f + ' lost its foreground layer');
    assert.match(xml, /@mipmap\/ic_launcher_background/, f + ' lost its background layer');
  });
});

// ---------------------------------------------------------------------------
// 4. THE MARK SURVIVES THE LAUNCHER'S MASK
// ---------------------------------------------------------------------------
/* Android's arithmetic, written out once.
 *
 *   The adaptive layer is 108dp. The XML insets the foreground by 16.7% a side,
 *   so the artwork is drawn into the middle 72dp. The launcher then masks the
 *   result: 72dp is the largest any mask can be, and 66dp is the circle every
 *   mask is guaranteed to contain -- the safe zone.
 *
 *   So artwork occupying a fraction f of the foreground file ends up 72*f dp
 *   across, and must be no wider than 66dp to survive every launcher:
 *
 *       72 * f <= 66   ->   f <= 0.9167
 *
 *   The floor is taste rather than geometry: below about 0.70 the mark is a
 *   dot in a black tile.
 */
const INSET_TO = 72;   // dp the foreground is drawn into
const SAFE = 66;       // dp diameter every launcher mask contains
const FLOOR = 0.70;

function foregroundInk(file){
  const img = pngPixels(file);
  const box = inkBox(img);
  return {
    img: img, box: box,
    fraction: Math.max(box.w, box.h) / img.w,
    /* How far the mark's centre sits from the file's centre, in px. */
    offX: Math.abs((box.x0 + box.x1 + 1) / 2 - img.w / 2),
    offY: Math.abs((box.y0 + box.y1 + 1) / 2 - img.h / 2)
  };
}

test('the adaptive foreground keeps the mark inside the launcher safe zone', () => {
  /* The source asset and the largest generated density. The small densities are
     the same artwork resampled; decoding all six costs seconds for no new fact. */
  [path.join(ROOT, 'assets', 'icon-foreground.png'),
   path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png')
  ].forEach(file => {
    const f = foregroundInk(file);
    const dp = INSET_TO * f.fraction;
    assert.ok(dp <= SAFE,
      path.basename(file) + ': the mark fills ' + (f.fraction * 100).toFixed(1) +
      '% of the layer, which lands at ' + dp.toFixed(1) + 'dp once Android insets it. ' +
      'Anything over ' + SAFE + 'dp has its outer ring sliced off by a round launcher ' +
      'mask. This is drawn full-bleed -- it needs padding, not a resize');
    assert.ok(f.fraction >= FLOOR,
      path.basename(file) + ': the mark fills only ' + (f.fraction * 100).toFixed(1) +
      '% of the layer; it will read as a speck floating in a black tile');
  });
});

test('the adaptive foreground is centred, because the mask is', () => {
  const f = foregroundInk(path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png'));
  const slack = f.img.w * 0.01;
  assert.ok(f.offX <= slack && f.offY <= slack,
    'the mark sits ' + f.offX.toFixed(0) + 'px across and ' + f.offY.toFixed(0) +
    'px down from centre. The launcher mask is centred on the layer, so an ' +
    'off-centre mark loses more on one side than the other');
});

test('the legacy launcher icon is full bleed, unlike the adaptive foreground', () => {
  /* Pre-adaptive Android draws ic_launcher.png as-is with no inset, so the two
     cannot be the same artwork. Shipping the padded foreground as the legacy
     icon leaves a visibly small mark in a black square on older phones. */
  const legacy = foregroundInk(path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher.png'));
  const fg = foregroundInk(path.join(RES, 'mipmap-xxxhdpi', 'ic_launcher_foreground.png'));
  assert.ok(legacy.fraction > fg.fraction + 0.04,
    'ic_launcher.png fills ' + (legacy.fraction * 100).toFixed(1) + '% and the adaptive ' +
    'foreground ' + (fg.fraction * 100).toFixed(1) + '% -- they are the same file. One of ' +
    'the two is wrong: the legacy icon is never inset, the adaptive one always is');
  assert.ok(legacy.fraction >= 0.90,
    'ic_launcher.png fills only ' + (legacy.fraction * 100).toFixed(1) + '% of its tile');
});

// ---------------------------------------------------------------------------
// 5. THE LAUNCH SCREEN ANDROID DRAWS BEFORE THE WEBVIEW EXISTS
// ---------------------------------------------------------------------------
/* The web app paints its own arrival now, from the document, before any script
   runs -- see #boot-splash and test/programmeEntry. But even that cannot paint
   until there is a WebView, and before there is a WebView there is this: a flat
   PNG the window is drawn with. It is the only thing that can honour "appear
   almost instantly", because it costs no network and no parsing at all.
   The two have to be the same picture. These are cut from #boot-splash itself
   with javascript disabled (tools: see the session's native-splash render), so
   the handover is a photograph turning into the same photograph rather than a
   launch screen giving way to a different one.
   WHY THE SIZES ARE PINNED: Android picks a drawable by density bucket and
   stretches whatever it finds. A half-regenerated set does not fail to build;
   it ships a stretched or letterboxed launch screen on the densities nobody
   on the project happens to own. */
const SPLASH = [
  { dir:'drawable',              w: 480, h: 320 },   /* the fallback any bucket can fall to */
  { dir:'drawable-port-mdpi',    w: 320, h: 480 },
  { dir:'drawable-port-hdpi',    w: 480, h: 800 },
  { dir:'drawable-port-xhdpi',   w: 720, h:1280 },
  { dir:'drawable-port-xxhdpi',  w: 960, h:1600 },
  { dir:'drawable-port-xxxhdpi', w:1280, h:1920 },
  { dir:'drawable-land-mdpi',    w: 480, h: 320 },
  { dir:'drawable-land-hdpi',    w: 800, h: 480 },
  { dir:'drawable-land-xhdpi',   w:1280, h: 720 },
  { dir:'drawable-land-xxhdpi',  w:1600, h: 960 },
  { dir:'drawable-land-xxxhdpi', w:1920, h:1280 }
];

test('every density carries a launch screen at the right pixel size', () => {
  SPLASH.forEach(s => {
    const file = path.join(RES, s.dir, 'splash.png');
    assert.ok(fs.existsSync(file), s.dir + '/splash.png is missing; that density ' +
      'falls back to a drawable of the wrong shape and launches stretched');
    const p = pngHead(file);
    assert.equal(p.w, s.w, s.dir + '/splash.png is ' + p.w + 'px wide, expected ' + s.w);
    assert.equal(p.h, s.h, s.dir + '/splash.png is ' + p.h + 'px tall, expected ' + s.h);
  });
});

test('the generic launch screen is the landscape frame, and nothing else repeats', () => {
  /* drawable/ is the bucket Android falls to when it finds nothing better, and
     in this project it has always been a byte-for-byte copy of the landscape
     mdpi frame -- same 480x320, same picture. That is deliberate and is pinned
     here so a regeneration that updates one and not the other is caught: a
     stale fallback is a launch screen with the old badge on it, on exactly the
     devices nobody tests. Every other pair must differ, because every other
     pair is a different size and a copy would be the wrong shape. */
  const sha = f => require('crypto').createHash('sha1')
    .update(fs.readFileSync(path.join(RES, f, 'splash.png'))).digest('hex');
  assert.equal(sha('drawable'), sha('drawable-land-mdpi'),
    'the generic launch screen has drifted from the landscape mdpi frame it is a copy of');
  const seen = new Map();
  SPLASH.filter(s => s.dir !== 'drawable').forEach(s => {
    const k = sha(s.dir);
    assert.ok(!seen.has(k), s.dir + '/splash.png is a byte-for-byte copy of ' +
      seen.get(k) + '/splash.png; one of the two is the wrong shape for its bucket');
    seen.set(k, s.dir);
  });
});

/* A 32x32 greyscale thumbnail, which is all that is needed to answer "are
   these two the same picture?" -- and the only question a composition check
   can answer honestly from pixels. An earlier version of this law measured
   where the bright pixels sat and failed on the real landscape frame, because
   a lit cloud in the photograph is as bright as the wordmark. */
function thumb(file, n){
  const img = pngPixels(file);
  const sum = new Float64Array(n * n), count = new Float64Array(n * n);
  for (let y = 0; y < img.h; y++){
    const ty = Math.min(n - 1, Math.floor(y * n / img.h));
    for (let x = 0; x < img.w; x++){
      const tx = Math.min(n - 1, Math.floor(x * n / img.w));
      const i = y * img.w * img.ch + x * img.ch;
      sum[ty * n + tx] += (img.px[i] + img.px[i + 1] + img.px[i + 2]) / 3;
      count[ty * n + tx]++;
    }
  }
  for (let i = 0; i < sum.length; i++) sum[i] /= (count[i] || 1);
  return sum;
}
function meanDiff(a, b){
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

test('the landscape launch screen is composed, not the portrait one stretched', () => {
  /* THE FAILURE THE SIZE LAW CANNOT SEE. Stretching the portrait frame to
     1280x720 produces a file of exactly the right dimensions and entirely the
     wrong picture: the lockup squashed, the photograph distorted. It is the
     obvious shortcut when regenerating, and it builds and installs cleanly.
     Measured on this repo's own frames, on a 0-255 scale:
         the real portrait against the real landscape      19.7
         a stretched portrait against the portrait          0.6
         the same picture at two densities                  1.7
     So anything under 8 is the same picture wearing another size. */
  const STRETCH_FLOOR = 8;
  [['drawable-port-xhdpi', 'drawable-land-xhdpi'],
   ['drawable-port-xxhdpi', 'drawable-land-xxhdpi']].forEach(([p, l]) => {
    const d = meanDiff(thumb(path.join(RES, p, 'splash.png'), 32),
                       thumb(path.join(RES, l, 'splash.png'), 32));
    assert.ok(d >= STRETCH_FLOOR,
      l + '/splash.png differs from ' + p + '/splash.png by only ' + d.toFixed(1) +
      ' -- it is the portrait frame stretched, not a landscape composition. ' +
      'Render it at a landscape viewport rather than resizing');
  });
});

test('the launch screen is a photograph, not the retired badge', () => {
  /* The old one was the crest on near-black, and the crest artwork reads
     VALHALLA AWAITS in pixels -- which is why the rename never touched it and
     why no grep could have found it. A flat ground with one centred badge
     compresses to a fraction of what a full-bleed photograph does, so the file
     size is the cheap tell that the badge has come back: measured, the real
     960x1600 frame is 775 KB and the same frame rebuilt as a badge on #151417
     is 123 KB. */
  const p = pngHead(path.join(RES, 'drawable-port-xxhdpi', 'splash.png'));
  assert.ok(p.bytes > 300 * 1024,
    'the 960x1600 launch screen is only ' + Math.round(p.bytes / 1024) + ' KB. ' +
    'The arrival photograph does not compress that small; a flat ground with a ' +
    'badge on it does, and the badge still says Valhalla');
});
