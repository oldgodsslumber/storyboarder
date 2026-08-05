/* host.js — tolerating differences between Premiere builds.
 *
 * The UXP surface is not stable across versions: getVideoFrameRate() is absent
 * from the settings object on some builds, and TickTime has exposed its value as
 * .seconds, .ticksNumber and .ticks at different times. Reading any of it must
 * never be able to stop the panel finding the sequence, so every lookup is
 * probed and falls through.
 *
 * Kept out of index.js so the fallback chain can be tested against mock hosts.
 */
(function (root, factory) {
  const api = factory();
  root.SBHost = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TICKS_PER_SECOND = 254016000000;

  /* Call the first named method that exists, tolerating sync or async returns. */
  async function tryCall(obj, names) {
    for (let i = 0; i < names.length; i++) {
      const fn = obj && obj[names[i]];
      if (typeof fn !== 'function') continue;
      try {
        const v = await fn.call(obj);
        if (v !== null && v !== undefined) return v;
      } catch (e) { /* wrong build for this one; try the next */ }
    }
    return null;
  }

  function methodsOf(obj) {
    const out = [];
    for (const k in obj) {
      try { if (typeof obj[k] === 'function') out.push(k); } catch (e) { /* getter threw */ }
    }
    return out.sort().join(', ') || '(none)';
  }

  function plausibleFps(n) {
    return typeof n === 'number' && isFinite(n) && n > 0 && n < 1000;
  }

  /* TickTime → seconds, whichever accessor this build provides. */
  function secondsOf(t) {
    if (t === null || t === undefined) return null;
    if (typeof t === 'number') return isFinite(t) ? t : null;
    if (typeof t.seconds === 'number' && isFinite(t.seconds)) return t.seconds;
    if (typeof t.ticksNumber === 'number' && isFinite(t.ticksNumber)) {
      return t.ticksNumber / TICKS_PER_SECOND;
    }
    if (t.ticks !== undefined && isFinite(Number(t.ticks))) {
      return Number(t.ticks) / TICKS_PER_SECOND;
    }
    return null;
  }

  /* Timebase is ticks-per-frame as a string. */
  function fpsFromTimebase(timebase) {
    const ticksPerFrame = Number(timebase);
    if (!(ticksPerFrame > 0)) return null;
    const fps = TICKS_PER_SECOND / ticksPerFrame;
    return plausibleFps(fps) ? fps : null;
  }

  /* Resolve frame rate and frame size, preferring the sequence-level accessors —
   * those live on the sequence itself and survive builds where the settings
   * object has a different shape. Returns what it found plus what it had to
   * guess, so the caller can say so rather than quietly using 30fps.
   */
  async function readMetrics(seq, getSettings) {
    let fps = 0, width = 0, height = 0;

    const fromTimebase = fpsFromTimebase(await tryCall(seq, ['getTimebase']));
    if (fromTimebase) fps = fromTimebase;

    const size = await tryCall(seq, ['getFrameSize']);
    if (size && size.width && size.height) { width = size.width; height = size.height; }

    let settings = null;
    if (!fps || !width) {
      try { settings = getSettings ? await getSettings() : null; } catch (e) { settings = null; }
    }
    if (settings) {
      if (!fps) {
        const rate = (await tryCall(settings, ['getVideoFrameRate'])) || settings.videoFrameRate;
        const v = (rate && rate.value !== undefined) ? rate.value : rate;
        if (plausibleFps(Number(v))) fps = Number(v);
      }
      if (!width) {
        const rect = await tryCall(settings, ['getVideoFrameRect', 'getFrameRect']);
        if (rect && rect.width && rect.height) { width = rect.width; height = rect.height; }
      }
    }

    const guessedFps = !fps;
    const guessedSize = !width;
    return {
      fps: fps || 30,
      width: width || 1920,
      height: height || 1080,
      zeroPoint: secondsOf(await tryCall(seq, ['getZeroPoint'])) || 0,
      guessedFps: guessedFps,
      guessedSize: guessedSize,
      settings: settings
    };
  }

  /* Every call convention worth trying for exportSequenceFrame.
   *
   * `rawDir` is the folder's nativePath verbatim — that is what Adobe's own
   * working sample passes, so it is tried first. The rest cover the ambiguity in
   * the docs, where the example passes a full path as `filename` while also
   * taking a separate directory, and never says whether the directory wants a
   * trailing separator or which slash.
   *
   * Note what is NOT here: the file that lands on disk is not assumed to be
   * named `filename`. Premiere appends the extension a second time — Adobe's
   * sample logs "output.png.png *(We do double extension)*" — so callers match
   * on `prefix` and take whatever turned up.
   */
  function exportPlans(dir, baseName, ext, w, h, rawDir) {
    const withSlash = /\/$/.test(dir) ? dir : dir + '/';
    const noSlash = withSlash.replace(/\/$/, '');
    const backslash = noSlash.replace(/\//g, '\\') + '\\';
    const file = baseName + '.' + ext;
    const forms = [];
    if (rawDir && rawDir !== withSlash && rawDir !== noSlash) {
      forms.push(['name + nativePath', file, rawDir]);
    }
    forms.push(
      ['name + dir/', file, withSlash],
      ['name + dir', file, noSlash],
      ['full path as name', withSlash + file, withSlash],
      ['name + dir\\', file, backslash],
      ['full path (backslashes)', backslash + file, backslash]
    );
    return forms.map(function (f) {
      return {
        label: f[0], filename: f[1], filepath: f[2],
        prefix: baseName, ext: ext, w: w, h: h
      };
    });
  }

  /* What Premiere actually wrote, whatever it decided to call it. Matching on the
   * basename rather than the full filename is what makes the doubled-extension
   * bug a non-issue: sb_0001.jpg, sb_0001.jpg.jpg and sb_0001.jpg.png all match. */
  function matchExported(names, prefix) {
    const hits = names.filter(function (n) { return n.indexOf(prefix) === 0; });
    if (!hits.length) return null;
    // shortest wins, so sb_0001.jpg beats sb_0001.jpg.png if both somehow exist
    hits.sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); });
    return hits[0];
  }

  /* Trust the bytes, not the extension: the file may be PNG however it is named. */
  function sniffImageType(buffer) {
    const b = new Uint8Array(buffer || new ArrayBuffer(0));
    if (b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return 'image/png';
    }
    if (b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b.length > 3 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
    return null;
  }

  /* Try each shape × each plan in order, stopping at the first that works.
   * Returns the winner plus everything that was tried, so a total failure can be
   * reported precisely instead of as a bare count. */
  async function probeVariants(shapes, plansFor, attemptFn) {
    const tried = [];
    for (let s = 0; s < shapes.length; s++) {
      const plans = plansFor(shapes[s]);
      for (let i = 0; i < plans.length; i++) {
        let res;
        try {
          res = await attemptFn(plans[i], shapes[s]);
        } catch (e) {
          res = { ok: false, why: (e && e.message) ? e.message : String(e) };
        }
        if (res && res.ok) {
          return { plan: plans[i], shape: shapes[s], result: res, tried: tried,
            fallback: tried.length > 0 };
        }
        tried.push({
          plan: plans[i], shape: shapes[s], why: (res && res.why) || 'unknown'
        });
      }
    }
    return { plan: null, shape: null, result: null, tried: tried, fallback: false };
  }

  return {
    tryCall: tryCall,
    methodsOf: methodsOf,
    exportPlans: exportPlans,
    probeVariants: probeVariants,
    matchExported: matchExported,
    sniffImageType: sniffImageType,
    secondsOf: secondsOf,
    plausibleFps: plausibleFps,
    fpsFromTimebase: fpsFromTimebase,
    readMetrics: readMetrics,
    TICKS_PER_SECOND: TICKS_PER_SECOND
  };
});
