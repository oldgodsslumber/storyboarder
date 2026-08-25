/* promptpanel.js — everything prompt-related in one panel, opened when the
 * user is ready for prompts. Cards stay clean until they ask for them.
 */
(function (SB) {
  'use strict';

  let panel, bodyEl, statusEl, usageEl, limitEl;
  const write = { image: true, video: true };   // which prompts to write this run

  function P() { return SB.app.project; }

  function init() {
    panel = document.getElementById('promptPanel');
    bodyEl = document.getElementById('promptBody');
  }

  function block(title) {
    const b = SB.el('div', 'pp-block');
    if (title) b.appendChild(SB.el('div', 't', title));
    return b;
  }

  function modelSelect(role) {
    const p = P();
    const sel = document.createElement('select');
    [['image', 'Image models'], ['video', 'Video models']].forEach(function (g) {
      const list = p.settings.models.filter(function (m) { return m.kind === g[0]; });
      if (!list.length) return;
      const og = document.createElement('optgroup');
      og.label = g[1];
      list.forEach(function (m) {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.name;
        if (m.id === (role === 'image' ? p.settings.imageModelId : p.settings.videoModelId)) o.selected = true;
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    sel.addEventListener('change', function () {
      if (role === 'image') p.settings.imageModelId = sel.value;
      else p.settings.videoModelId = sel.value;
      SB.app.changed(true);   // cards relabel to the new model
    });
    return sel;
  }

  function row(labelText, control) {
    const r = SB.el('div', 'pp-row');
    r.appendChild(SB.el('label', null, labelText));
    r.appendChild(control);
    return r;
  }

  function checkRow(labelText, checked, onChange) {
    const l = SB.el('label', 'pp-toggle');
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!checked;
    c.addEventListener('change', function () { onChange(c.checked); });
    l.appendChild(c);
    l.appendChild(document.createTextNode(labelText));
    return l;
  }

  function render() {
    if (!panel || !P()) return;
    const p = P();
    bodyEl.innerHTML = '';

    /* --- target models --- */
    const b1 = block('target models');
    b1.appendChild(row('First frame', modelSelect('image')));
    b1.appendChild(row('Video', modelSelect('video')));
    b1.appendChild(SB.el('div', 'pp-note',
      'Each shot keeps its prompts per model — switching models here never loses the old ones.'));
    bodyEl.appendChild(b1);

    /* --- generate --- */
    const b2 = block('write prompts');
    b2.appendChild(checkRow(' first-frame prompt', write.image, function (v) { write.image = v; }));
    b2.appendChild(checkRow(' image→video prompt', write.video, function (v) { write.video = v; }));

    const brand = SB.Brand.brandOf(p);
    const bRow = checkRow(' apply house style', brand.enabled, function (v) {
      p.settings.brand = p.settings.brand || {};
      p.settings.brand.enabled = v;
      SB.Store.touch();
    });
    bRow.title = 'Continuity, camera, tone and the no-gendered-language rule — Settings → Brand style';
    b2.appendChild(bRow);

    const scope = document.createElement('select');
    [['project', 'Whole project'], ['scene', 'Selected scene'], ['shot', 'Selected shot']]
      .forEach(function (o) {
        const op = document.createElement('option');
        op.value = o[0]; op.textContent = o[1];
        scope.appendChild(op);
      });
    b2.appendChild(row('Scope', scope));

    const acts = SB.el('div', 'pp-actions');
    const gen = SB.el('button', 'tb on', 'Generate');
    acts.appendChild(gen);
    b2.appendChild(acts);

    const ready = SB.Providers.active().ready();
    statusEl = SB.el('div', 'pp-status', ready ? '' : SB.Providers.active().notReady());
    if (!ready) statusEl.classList.add('err');
    b2.appendChild(statusEl);
    bodyEl.appendChild(b2);

    gen.addEventListener('click', function () {
      const shots = scope.value === 'project' ? SB.Prompts.allShots()
        : scope.value === 'scene' ? SB.Prompts.sceneShots(SB.app.selectedSceneId)
          : (function () {
            const f = SB.app.selectedShotId && SB.Model.findShot(p, SB.app.selectedShotId);
            return f ? [f.shot] : [];
          })();
      if (!shots.length) { setStatus('Nothing in scope — select a scene or shot first.', true); return; }
      run(shots, { image: write.image, video: write.video }, gen);
    });

    /* --- show on cards --- */
    const b3 = block('show on cards');
    b3.appendChild(checkRow(' first-frame prompt', p.settings.showImagePrompt, function (v) {
      p.settings.showImagePrompt = v; SB.app.changed(true);
    }));
    b3.appendChild(checkRow(' image→video prompt', p.settings.showVideoPrompt, function (v) {
      p.settings.showVideoPrompt = v; SB.app.changed(true);
    }));
    b3.appendChild(SB.el('div', 'pp-note',
      'Off by default so cards stay compact. Generating turns the matching box on for you.'));
    bodyEl.appendChild(b3);

    /* --- engine ---
     * The provider switch lives here as well as in Settings: choosing between
     * the cloud model and the local one is a working decision (quota gone,
     * offline, a draft not worth spending calls on), not a configuration one,
     * and it should not cost a trip through a modal. */
    const b4 = block('prompt writer');

    const provRow = SB.el('div', 'pp-row prov-row');
    provRow.appendChild(SB.el('label', null, 'Writer'));
    const provWrap = SB.el('div', 'prov-pick');
    SB.Providers.list().forEach(function (prov) {
      const b = SB.el('button', 'tb toggle' + (prov.id === SB.Providers.activeId() ? ' on' : ''),
        prov.id === 'gemini' ? 'Gemini' : 'Local');
      b.title = prov.label;
      b.onclick = function () {
        SB.Providers.setActive(prov.id);
        SB.app.changed(true);
        render();                       // the model picker below it changes too
      };
      provWrap.appendChild(b);
    });
    provRow.appendChild(provWrap);
    b4.appendChild(provRow);

    const activeProv = SB.Providers.active();

    if (activeProv.id === 'gemini') {
      const pick = SB.GeminiModels.picker(p.settings.geminiModel, function (id) {
        p.settings.geminiModel = id || SB.GeminiModels.DEFAULT;
        SB.Store.touch();
        refreshUsage();
      });
      b4.appendChild(row('Model', pick.el));

      const uRow = SB.el('div', 'pp-row');
      uRow.appendChild(SB.el('label', null, 'Free calls'));
      usageEl = SB.el('span', 'pp-usage');
      uRow.appendChild(usageEl);
      limitEl = document.createElement('input');
      limitEl.type = 'number';
      limitEl.min = '0';
      limitEl.className = 'pp-limit';
      limitEl.title = 'Your free-tier requests per day for this model (AI Studio shows the real number). Blank = just count.';
      limitEl.placeholder = 'limit';
      limitEl.addEventListener('change', function () {
        SB.GeminiModels.setLimit(p.settings.geminiModel, parseInt(limitEl.value, 10) || 0);
        refreshUsage();
      });
      uRow.appendChild(limitEl);
      b4.appendChild(uRow);
      b4.appendChild(SB.el('div', 'pp-note',
        'Counted in this browser and reset at midnight. Google no longer publishes the free-tier ' +
        'daily cap per model — set it from your AI Studio rate-limit page.'));

      b4.appendChild(SB.el('div', 'pp-note', SB.Store.getApiKey()
        ? 'API key is set in this browser.' : 'No API key — add one in Settings → API.'));
    } else {
      /* Local: no quota to spend, so the counter is a plain tally and the
       * things worth showing are where it points and what is loaded. */
      const o = SB.Store.getOoba();
      usageEl = null;
      limitEl = null;
      const mRow = SB.el('div', 'pp-row');
      mRow.appendChild(SB.el('label', null, 'Model'));
      mRow.appendChild(SB.el('span', 'pp-usage', o.model || 'whatever is loaded'));
      b4.appendChild(mRow);

      const sRow = SB.el('div', 'pp-row');
      sRow.appendChild(SB.el('label', null, 'Server'));
      sRow.appendChild(SB.el('span', 'pp-usage', SB.Providers.baseUrl()));
      b4.appendChild(sRow);

      const calls = SB.GeminiModels.count(SB.Providers.usageKey('ooba', o.model));
      b4.appendChild(SB.el('div', 'pp-note',
        'Runs on your machine — no quota, no key, nothing sent out. ' +
        calls + ' request' + (calls === 1 ? '' : 's') + ' today.'));
      b4.appendChild(SB.el('div', 'pp-note',
        'Change the address or model in Settings → API.'));
    }
    bodyEl.appendChild(b4);

    refreshUsage();
  }

  function refreshUsage() {
    if (!usageEl || !P()) return;
    if (SB.Providers.activeId() !== 'gemini') return;   // local runs have no allowance
    const id = P().settings.geminiModel;
    usageEl.textContent = SB.GeminiModels.usageText(id);
    const rem = SB.GeminiModels.remaining(id);
    usageEl.classList.toggle('spent', rem === 0);
    if (limitEl && document.activeElement !== limitEl) {
      const lim = SB.GeminiModels.limit(id);
      limitEl.value = lim ? lim : '';
    }
  }

  function setStatus(txt, isErr) {
    if (!statusEl) return;
    statusEl.textContent = txt;
    statusEl.classList.toggle('err', !!isErr);
  }

  function run(shots, roles, btn) {
    if (!roles.image && !roles.video) { setStatus('Tick at least one prompt to write.', true); return; }
    btn.disabled = true;
    SB.Prompts.generateFor(shots, {
      roles: roles,
      onProgress: function (done, total, failed) {
        setStatus('writing ' + done + '/' + total + (failed ? ' · ' + failed + ' failed' : ''), false);
        refreshUsage();
      }
    }).then(function (r) {
      btn.disabled = false;
      // reveal what was just written
      const s = P().settings;
      if (roles.image && r.done) s.showImagePrompt = true;
      if (roles.video && r.done) s.showVideoPrompt = true;
      SB.app.changed(true);
      setStatus(r.failed
        ? r.done + ' of ' + r.total + ' written · ' + r.failed + ' failed: ' + (r.error || 'unknown')
        : 'done — ' + r.done + ' of ' + r.total,
        !!r.failed);
    }).catch(function (e) {
      btn.disabled = false;
      if (SB.apiBlocked(e, function () { run(shots, roles, btn); })) {
        setStatus('blocked — see the dialog', true);
        return;
      }
      const msg = e.message || String(e);
      setStatus(msg, true);
      /* "that model is not available to this key" is answerable on the spot:
       * ask the key what it can reach and put those in the picker. */
      if (/\b404\b/.test(msg) && SB.Providers.activeId() === 'gemini') {
        setStatus(msg + ' — checking what your key can reach…', true);
        SB.GeminiModels.fetchAvailable().then(function (models) {
          render();
          setStatus('“' + P().settings.geminiModel + '” is not available to this key. ' +
            'The writer list now shows the ' + models.length + ' models it can reach — pick one.', true);
        }).catch(function () {
          setStatus(msg, true);
        });
      }
    });
  }

  function open() {
    panel.classList.remove('hidden');
    document.getElementById('btnPrompts').classList.add('on');
    render();
  }
  function close() {
    panel.classList.add('hidden');
    document.getElementById('btnPrompts').classList.remove('on');
  }
  function toggle() { panel.classList.contains('hidden') ? open() : close(); }
  function isOpen() { return panel && !panel.classList.contains('hidden'); }
  function refresh() { if (isOpen()) render(); }

  SB.PromptPanel = {
    init: init, open: open, close: close, toggle: toggle, isOpen: isOpen,
    refresh: refresh, run: run, refreshUsage: refreshUsage
  };

})(window.SB);
