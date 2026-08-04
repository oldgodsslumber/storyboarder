/* model.js — project schema, numbering, and all structural mutations. */
(function (SB) {
  'use strict';

  const FILE_VERSION = 1;

  const DEFAULT_SHOT_TYPES = [
    'Wide', 'Medium', 'Close-up', 'Extreme close-up', 'Over the shoulder',
    'Two shot', 'Insert', 'Cutaway', 'POV', 'Screen capture', 'Talking head'
  ];

  const IMG_TPL =
    'Write a single first-frame still-image prompt for {{MODEL}}.\n' +
    'Shot type: {{SHOT_TYPE}}. Scene: {{SCENE}}.\n' +
    'Describe subject, setting, composition, lens, lighting and mood in one dense paragraph. ' +
    'No camera motion, no narration, no preamble.\n\n' +
    'SHOT DESCRIPTION:\n{{DESCRIPTION}}';

  const VID_TPL =
    'Write a single image-to-video prompt for {{MODEL}}, starting from the first frame described below.\n' +
    'Shot type: {{SHOT_TYPE}}. Scene: {{SCENE}}.\n' +
    'Describe only what MOVES: subject action, camera move, pacing, and how the shot ends. ' +
    'Keep it one paragraph, no preamble.\n\n' +
    'SHOT DESCRIPTION:\n{{DESCRIPTION}}';

  function model(name, kind) {
    return {
      id: SB.uid('m'), name: name, kind: kind,
      imageTemplate: IMG_TPL, videoTemplate: VID_TPL,
      referenceTemplate: SB.Personas.DEFAULT_REF_TEMPLATE
    };
  }

  function defaultModels() {
    return [
      model('Wan', 'video'), model('LTX (LTXV 2.3)', 'video'), model('Veo', 'video'),
      model('Kling', 'video'), model('Sora', 'video'), model('Runway', 'video'),
      model('Hailuo (MiniMax)', 'video'), model('Seedance', 'video'),
      model('Nano Banana (Gemini Image)', 'image'), model('Qwen-Image', 'image'),
      model('FLUX', 'image'), model('GPT Image', 'image'), model('Imagen', 'image'),
      model('Ideogram', 'image'), model('Midjourney', 'image')
    ];
  }

  /* Mid-tone hues, each legible as a card edge on both the light and dark board. */
  const CARD_COLORS = [
    '#6b7280', // slate
    '#3b82f6', // blue
    '#0891b2', // cyan
    '#0d9488', // teal
    '#16a34a', // green
    '#ca8a04', // gold
    '#ea580c', // orange
    '#dc2626', // red
    '#db2777', // pink
    '#7c3aed'  // violet
  ];

  function newShot(opts) {
    opts = opts || {};
    return {
      id: SB.uid('sh'),
      type: opts.type || '',
      noShot: !!opts.noShot,
      color: opts.color || CARD_COLORS[0],
      link: opts.link || null,          // {from,to} into master, or null = freestanding
      local: opts.link ? null : SB.Doc.make(opts.text || ''),
      personaIds: [],                   // who appears in this shot
      broken: false,
      description: '',
      fields: {},                       // extra text boxes, keyed by field id
      image: null,                      // {ref,w,h} into project.blobs
      annotation: null,                 // {ref} — transparent PNG overlay
      comments: [],
      prompts: {}                       // modelName -> {imagePrompt, videoPrompt}
    };
  }

  function newScene(heading) {
    return { id: SB.uid('sc'), heading: heading || 'New scene', description: '', shots: [] };
  }

  function firstOfKind(models, kind) {
    const m = models.filter(function (x) { return x.kind === kind; })[0] || models[0];
    return m ? m.id : null;
  }

  function newProject() {
    const p = {
      fileVersion: FILE_VERSION,
      id: SB.uid('prj'),
      name: 'Untitled project',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      master: SB.Doc.make(''),
      blobs: {},                        // hash -> data URL; images live here once
      personas: [],
      scenes: [newScene('Scene one')],
      versionNumber: 1,
      versionName: 'v1',
      versions: [],
      settings: {
        shotTypes: DEFAULT_SHOT_TYPES.slice(),
        fields: SB.Fields.defaults(),
        models: defaultModels(),
        imageModelId: null,
        videoModelId: null,
        geminiModel: SB.GeminiModels.DEFAULT,
        brand: { enabled: true, custom: false },
        // prompt boxes stay off the cards until the user asks for them
        showImagePrompt: false,
        showVideoPrompt: false
      }
    };
    p.settings.imageModelId = firstOfKind(p.settings.models, 'image');
    p.settings.videoModelId = firstOfKind(p.settings.models, 'video');
    p.scenes[0].shots.push(newShot({ type: DEFAULT_SHOT_TYPES[0] }));
    return p;
  }

  /* Fill in anything an older/hand-edited file is missing. */
  function migrate(p) {
    if (!p || typeof p !== 'object') throw new Error('not a Storyboarder project');
    p.fileVersion = FILE_VERSION;
    p.id = p.id || SB.uid('prj');
    p.name = p.name || 'Untitled project';
    p.createdAt = p.createdAt || Date.now();
    p.master = p.master && typeof p.master.text === 'string' ? p.master : SB.Doc.make('');
    p.master.marks = p.master.marks || { b: [], i: [], u: [] };
    ['b', 'i', 'u'].forEach(function (t) { p.master.marks[t] = p.master.marks[t] || []; });
    /* Images used to sit inline on each shot, which meant every version froze
     * its own copy of every frame. They are now stored once under a hash. */
    p.blobs = (p.blobs && typeof p.blobs === 'object') ? p.blobs : {};
    p.personas = Array.isArray(p.personas) ? p.personas : [];
    p.personas.forEach(function (x) {
      x.id = x.id || SB.uid('per');
      x.name = x.name || 'Persona';
      x.description = x.description || '';
      x.imagePrompt = x.imagePrompt || '';
      x.image = SB.Blobs.adopt(p, x.image);
    });
    p.scenes = Array.isArray(p.scenes) ? p.scenes : [];
    if (!p.scenes.length) p.scenes.push(newScene('Scene one'));
    p.versionNumber = p.versionNumber || 1;
    p.versionName = p.versionName || ('v' + p.versionNumber);
    p.versions = Array.isArray(p.versions) ? p.versions : [];
    /* Frozen versions carried their own copy of every frame — the same bytes
     * hash to the same reference, so migrating them collapses the duplicates. */
    p.versions.forEach(function (v) {
      if (!v || !v.snapshot) return;
      (v.snapshot.scenes || []).forEach(function (sc) {
        (sc.shots || []).forEach(function (sh) {
          sh.image = SB.Blobs.adopt(p, sh.image);
          sh.annotation = SB.Blobs.adopt(p, sh.annotation);
        });
      });
      (v.snapshot.personas || []).forEach(function (per) {
        per.image = SB.Blobs.adopt(p, per.image);
      });
    });
    const s = p.settings = p.settings || {};
    s.shotTypes = (s.shotTypes && s.shotTypes.length) ? s.shotTypes : DEFAULT_SHOT_TYPES.slice();
    SB.Fields.migrate(p);
    s.models = (s.models && s.models.length) ? s.models : defaultModels();
    s.models.forEach(function (m) {
      m.id = m.id || SB.uid('m');
      m.kind = m.kind || 'video';
      m.imageTemplate = m.imageTemplate || IMG_TPL;
      m.videoTemplate = m.videoTemplate || VID_TPL;
      if (typeof m.referenceTemplate !== 'string') {
        m.referenceTemplate = SB.Personas.DEFAULT_REF_TEMPLATE;
      }
    });
    const has = function (id) { return s.models.some(function (m) { return m.id === id; }); };
    // older files carried a single activeModelId
    if (s.activeModelId && has(s.activeModelId)) {
      const old = s.models.filter(function (m) { return m.id === s.activeModelId; })[0];
      if (old.kind === 'image' && !s.imageModelId) s.imageModelId = old.id;
      if (old.kind === 'video' && !s.videoModelId) s.videoModelId = old.id;
    }
    delete s.activeModelId;
    if (!has(s.imageModelId)) s.imageModelId = firstOfKind(s.models, 'image');
    if (!has(s.videoModelId)) s.videoModelId = firstOfKind(s.models, 'video');
    // Google retires ids; move a project off anything that is gone
    s.geminiModel = SB.GeminiModels.normalize(s.geminiModel);
    s.brand = (s.brand && typeof s.brand === 'object') ? s.brand : {};
    if (typeof s.brand.enabled !== 'boolean') s.brand.enabled = true;
    // only a hand-edited house style is stored; the rest follow the app's
    if (typeof s.brand.custom !== 'boolean') s.brand.custom = false;
    if (!s.brand.custom) delete s.brand.text;
    if (typeof s.showImagePrompt !== 'boolean') s.showImagePrompt = false;
    if (typeof s.showVideoPrompt !== 'boolean') s.showVideoPrompt = false;

    p.scenes.forEach(function (sc) {
      sc.id = sc.id || SB.uid('sc');
      sc.heading = sc.heading || '';
      sc.description = sc.description || '';
      sc.shots = Array.isArray(sc.shots) ? sc.shots : [];
      sc.shots.forEach(function (sh) {
        sh.id = sh.id || SB.uid('sh');
        sh.type = sh.type || '';
        sh.noShot = !!sh.noShot;
        sh.color = sh.color || CARD_COLORS[0];
        sh.link = sh.link && typeof sh.link.from === 'number' ? sh.link : null;
        if (!sh.link) {
          sh.local = sh.local && typeof sh.local.text === 'string' ? sh.local : SB.Doc.make('');
          sh.local.marks = sh.local.marks || { b: [], i: [], u: [] };
          ['b', 'i', 'u'].forEach(function (t) { sh.local.marks[t] = sh.local.marks[t] || []; });
        } else {
          sh.link.from = SB.clamp(sh.link.from, 0, p.master.text.length);
          sh.link.to = SB.clamp(sh.link.to, sh.link.from, p.master.text.length);
        }
        sh.broken = !!sh.broken;
        sh.description = sh.description || '';
        sh.fields = (sh.fields && typeof sh.fields === 'object') ? sh.fields : {};
        sh.comments = Array.isArray(sh.comments) ? sh.comments : [];
        sh.prompts = sh.prompts || {};
        sh.personaIds = Array.isArray(sh.personaIds) ? sh.personaIds : [];
        sh.image = SB.Blobs.adopt(p, sh.image);
        sh.annotation = SB.Blobs.adopt(p, sh.annotation);
      });
    });
    return p;
  }

  /* ---------- lookup / numbering ---------- */

  function eachShot(p, fn) {
    for (let i = 0; i < p.scenes.length; i++) {
      const sc = p.scenes[i];
      for (let j = 0; j < sc.shots.length; j++) fn(sc.shots[j], sc, i, j);
    }
  }

  function code(sceneIdx, shotIdx) { return (sceneIdx + 1) + SB.letters(shotIdx); }

  function findShot(p, id) {
    let res = null;
    eachShot(p, function (sh, sc, i, j) {
      if (sh.id === id) res = { shot: sh, scene: sc, sceneIdx: i, shotIdx: j, code: code(i, j) };
    });
    return res;
  }

  function findScene(p, id) {
    for (let i = 0; i < p.scenes.length; i++) if (p.scenes[i].id === id) return { scene: p.scenes[i], idx: i };
    return null;
  }

  /* ---------- the shared-script window ---------- */

  /* What document + slice does this shot's script box show? */
  function windowFor(p, shot) {
    if (shot.link) return { doc: p.master, from: shot.link.from, to: shot.link.to, linked: true };
    return { doc: shot.local, from: 0, to: shot.local.text.length, linked: false };
  }

  /* The one place master-script text changes.
   * sourceShotId = the shot whose box the user typed in (null = typed in master).
   */
  function applyMasterEdit(p, start, end, text, sourceShotId) {
    if (SB.History) SB.History.push('master:' + (sourceShotId || ''));
    const op = { start: start, end: end, len: (text || '').length };
    const links = [];
    eachShot(p, function (sh) { if (sh.link) links.push(sh); });

    links.forEach(function (sh) {
      let fromLeft, toLeft;
      if (sh.id === sourceShotId) {
        // the shot being typed in grows at both edges
        fromLeft = true; toLeft = false;
      } else if (!sourceShotId) {
        // typed in master: text at a shot's end boundary extends that shot
        fromLeft = false; toLeft = false;
      } else {
        // another shot's edit: only interior insertions grow this one
        fromLeft = false; toLeft = true;
      }
      const nf = SB.Doc.mapPos(sh.link.from, start, end, op.len, fromLeft);
      const nt = SB.Doc.mapPos(sh.link.to, start, end, op.len, toLeft);
      sh.link.from = Math.min(nf, nt);
      sh.link.to = Math.max(nf, nt);
      if (sh.link.to <= sh.link.from) sh.broken = true;
      else if (sh.broken && sh.link.to > sh.link.from) sh.broken = false;
    });

    SB.Doc.replace(p.master, start, end, text);
    p.updatedAt = Date.now();
    return op;
  }

  /* Edit routed from a shot's own script box (local coords). */
  function applyShotEdit(p, shot, lStart, lEnd, text) {
    if (shot.link) {
      return applyMasterEdit(p, shot.link.from + lStart, shot.link.from + lEnd, text, shot.id);
    }
    if (SB.History) SB.History.push('local:' + shot.id);
    SB.Doc.replace(shot.local, lStart, lEnd, text);
    p.updatedAt = Date.now();
    return { start: lStart, end: lEnd, len: (text || '').length };
  }

  function breakLink(p, shot) {
    if (!shot.link) return;
    if (SB.History) { SB.History.seal(); SB.History.push('break:' + shot.id); SB.History.seal(); }
    const w = windowFor(p, shot);
    shot.local = {
      text: p.master.text.slice(w.from, w.to),
      marks: SB.Doc.sliceMarks(p.master, w.from, w.to)
    };
    shot.link = null;
    shot.broken = false;
    p.updatedAt = Date.now();
  }

  /* how many shots cover each master character (for the highlight underlay) */
  function coverage(p) {
    const n = p.master.text.length;
    const d = new Uint8Array(n);
    eachShot(p, function (sh) {
      if (!sh.link) return;
      for (let i = sh.link.from; i < sh.link.to && i < n; i++) if (d[i] < 250) d[i]++;
    });
    return d;
  }

  /* ---------- structure ---------- */

  function addScene(p, afterIdx) {
    const sc = newScene('Scene ' + (p.scenes.length + 1));
    if (typeof afterIdx === 'number') p.scenes.splice(afterIdx + 1, 0, sc);
    else p.scenes.push(sc);
    p.updatedAt = Date.now();
    return sc;
  }

  function deleteScene(p, sceneId) {
    const f = findScene(p, sceneId);
    if (!f) return;
    p.scenes.splice(f.idx, 1);
    if (!p.scenes.length) p.scenes.push(newScene('Scene one'));
    p.updatedAt = Date.now();
  }

  function addShot(p, sceneId, opts, atIdx) {
    const f = findScene(p, sceneId);
    if (!f) return null;
    const sh = newShot(Object.assign({ type: p.settings.shotTypes[0] || '' }, opts || {}));
    if (typeof atIdx === 'number') f.scene.shots.splice(atIdx, 0, sh);
    else f.scene.shots.push(sh);
    p.updatedAt = Date.now();
    return sh;
  }

  /* Deleting a shot leaves its text in the master script (resolved decision #2). */
  function deleteShot(p, shotId) {
    const f = findShot(p, shotId);
    if (!f) return;
    f.scene.shots.splice(f.shotIdx, 1);
    p.updatedAt = Date.now();
  }

  function moveShot(p, shotId, toSceneId, toIdx) {
    const f = findShot(p, shotId);
    const t = findScene(p, toSceneId);
    if (!f || !t) return;
    f.scene.shots.splice(f.shotIdx, 1);
    if (f.scene === t.scene && toIdx > f.shotIdx) toIdx--;
    toIdx = SB.clamp(toIdx, 0, t.scene.shots.length);
    t.scene.shots.splice(toIdx, 0, f.shot);
    p.updatedAt = Date.now();
  }

  function moveScene(p, sceneId, toIdx) {
    const f = findScene(p, sceneId);
    if (!f) return;
    p.scenes.splice(f.idx, 1);
    if (toIdx > f.idx) toIdx--;
    p.scenes.splice(SB.clamp(toIdx, 0, p.scenes.length), 0, f.scene);
    p.updatedAt = Date.now();
  }

  function modelById(p, id) {
    return p.settings.models.filter(function (m) { return m.id === id; })[0] || null;
  }
  function imageModel(p) { return modelById(p, p.settings.imageModelId); }
  function videoModel(p) { return modelById(p, p.settings.videoModelId); }

  SB.Model = {
    FILE_VERSION: FILE_VERSION,
    CARD_COLORS: CARD_COLORS,
    DEFAULT_SHOT_TYPES: DEFAULT_SHOT_TYPES,
    IMG_TPL: IMG_TPL, VID_TPL: VID_TPL,
    newProject: newProject, migrate: migrate, newShot: newShot, newScene: newScene,
    defaultModels: defaultModels,
    eachShot: eachShot, code: code, findShot: findShot, findScene: findScene,
    windowFor: windowFor, applyMasterEdit: applyMasterEdit, applyShotEdit: applyShotEdit,
    breakLink: breakLink, coverage: coverage,
    addScene: addScene, deleteScene: deleteScene, addShot: addShot, deleteShot: deleteShot,
    moveShot: moveShot, moveScene: moveScene,
    modelById: modelById, imageModel: imageModel, videoModel: videoModel, firstOfKind: firstOfKind
  };

})(window.SB);
