'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* SAVE TO PHOTOS, ON THE PLATFORM IT WAS FAILING ON.
 *
 * Founder: "Save to photos says can't save to photos try again every time."
 *
 * On Android the Media plugin refuses a save that names no album: its
 * `albumIdentifier` must be the path of an album directory that exists, and
 * the app passed null. Every save was rejected with "Album identifier
 * required" and reported as "try again". iOS accepts a save with no album,
 * which is why the call looked correct.
 *
 * The plugin here is a stand-in that behaves as the Android source does on
 * the two points that matter: it rejects a missing album, and it rejects one
 * that does not exist.
 */

const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

function shell(platform, opts) {
  const o = opts || {};
  const a = loadApp();
  const calls = { getAlbums: 0, createAlbum: [], savePhoto: [], toasts: [] };
  const albums = (o.albums || []).slice();
  const Media = {
    getAlbums: () => { calls.getAlbums++; return Promise.resolve({ albums: albums.slice() }); },
    createAlbum: (arg) => {
      calls.createAlbum.push(arg);
      if (o.createFails) return Promise.reject(new Error('Cant create album'));
      if (albums.some((x) => x.name === arg.name)) return Promise.reject(new Error('Album already exists'));
      albums.push({ name: arg.name, identifier: '/storage/emulated/0/Android/media/com.velvetviking.valhalla/' + arg.name });
      return Promise.resolve();
    },
    savePhoto: (arg) => {
      calls.savePhoto.push(arg);
      if (platform === 'android') {
        if (arg.albumIdentifier == null) return Promise.reject(new Error('Album identifier required'));
        if (!albums.some((x) => x.identifier === arg.albumIdentifier))
          return Promise.reject(new Error('Album identifier does not exist, use getAlbums() to get'));
      }
      return Promise.resolve({ filePath: 'x' });
    },
  };
  if (o.racedAlbum) albums.push(o.racedAlbum), (Media.getAlbums = (() => {
    let n = 0;
    return () => { calls.getAlbums++; n++; return Promise.resolve({ albums: n === 1 ? [] : albums.slice() }); };
  })());
  a.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, Plugins: { Media } };
  a.shareBlobToBase64 = () => Promise.resolve('QUJD');
  a.showToast = (m) => { calls.toasts.push(m); };
  return { a, calls };
}
const SACORO = { name: 'SACORO', identifier: '/storage/emulated/0/Android/media/com.velvetviking.valhalla/SACORO' };

test('on Android a save names the app\'s album, so it is no longer refused', async () => {
  const { a, calls } = shell('android', { albums: [{ name: 'Camera', identifier: '/dcim/Camera' }, SACORO] });
  await a.saveImageToPhotos({ blob: {}, filename: 'sacoro-2026-11-10.png' });
  assert.equal(calls.savePhoto.length, 1);
  assert.equal(calls.savePhoto[0].albumIdentifier, SACORO.identifier);
  assert.equal(calls.createAlbum.length, 0, 'an album that exists is not made again');
  assert.deepEqual(calls.toasts, ['Saved to your photos']);
});

test('the first save on a phone makes the album, then saves into it', async () => {
  const { a, calls } = shell('android', { albums: [] });
  await a.saveImageToPhotos({ blob: {}, filename: 'run.png' });
  assert.deepEqual(calls.createAlbum.map((x) => x.name), ['SACORO']);
  assert.equal(calls.savePhoto.length, 1);
  assert.match(calls.savePhoto[0].albumIdentifier, /\/SACORO$/);
  assert.deepEqual(calls.toasts, ['Saved to your photos']);
});

test('an album that turns out to exist already is not a failure', async () => {
  const { a, calls } = shell('android', { racedAlbum: SACORO });
  await a.saveImageToPhotos({ blob: {}, filename: 'run.png' });
  assert.equal(calls.createAlbum.length, 1, 'it was not listed the first time, so it was asked for');
  assert.equal(calls.savePhoto[0].albumIdentifier, SACORO.identifier);
  assert.deepEqual(calls.toasts, ['Saved to your photos']);
});

test('the file name goes in without its extension, because the plugin adds one', async () => {
  const { a, calls } = shell('android', { albums: [SACORO] });
  await a.saveImageToPhotos({ blob: {}, filename: 'sacoro-2026-11-10.png' });
  assert.equal(calls.savePhoto[0].fileName, 'sacoro-2026-11-10', 'or it is saved as .png.png');
  assert.match(calls.savePhoto[0].path, /^data:image\/png;base64,QUJD$/);
});

test('on iOS no album is named and none is looked for', async () => {
  const { a, calls } = shell('ios');
  await a.saveImageToPhotos({ blob: {}, filename: 'run.png' });
  assert.equal(calls.getAlbums, 0);
  assert.equal(calls.createAlbum.length, 0);
  assert.ok(!('albumIdentifier' in calls.savePhoto[0]), 'iOS saves to the library when no album is given');
  assert.deepEqual(calls.toasts, ['Saved to your photos']);
});

test('if the album cannot be made the athlete is told, and nothing is sent to be refused', async () => {
  const { a, calls } = shell('android', { albums: [], createFails: true });
  await a.saveImageToPhotos({ blob: {}, filename: 'run.png' });
  assert.equal(calls.savePhoto.length, 0);
  assert.equal(calls.toasts.length, 1);
  assert.match(calls.toasts[0], /Could not save to your photos/);
});

test('no save is ever sent with a null album', () => {
  const i = CODE.indexOf('function saveImageToPhotos(o){');
  const body = CODE.slice(i, CODE.indexOf('\nfunction ', i + 10));
  assert.doesNotMatch(body, /albumIdentifier:\s*null/, 'that one argument is what failed every save on Android');
  assert.match(body, /nativePhotoAlbumId\(Media\)/);
});
