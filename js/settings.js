/* settings.js — tabbed: General · Models & templates · API. */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }

  function field(labelText, control) {
    const l = SB.el('label', 'field');
    l.appendChild(SB.el('span', null, labelText));
    l.appendChild(control);
    return l;
  }

  function open(startTab) {
    const p = P();
    const body = SB.el('div');

    const tabs = SB.el('div', 'tabs');
    const panels = {};
    const order = [['general', 'General'], ['models', 'Models & templates'], ['api', 'API']];
    order.forEach(function (t) {
      const b = SB.el('button', 'tab', t[1]);
      b.dataset.tab = t[0];
      b.onclick = function () { select(t[0]); };
      tabs.appendChild(b);
      panels[t[0]] = SB.el('div', 'tab-panel');
    });
    function select(id) {
      tabs.querySelectorAll('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === id); });
      order.forEach(function (t) { panels[t[0]].classList.toggle('on', t[0] === id); });
    }
    body.appendChild(tabs);
    const host = SB.el('div');
    host.style.paddingTop = '12px';
    order.forEach(function (t) { host.appendChild(panels[t[0]]); });
    body.appendChild(host);

    /* ---------------- General ---------------- */
    const types = document.createElement('textarea');
    types.rows = 8;
    types.value = p.settings.shotTypes.join('\n');
    panels.general.appendChild(field('Shot types (one per line)', types));

    const themeSel = document.createElement('select');
    [['dark', 'Dark'], ['light', 'Light']].forEach(function (o) {
      const op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      if (SB.Theme.current() === o[0]) op.selected = true;
      themeSel.appendChild(op);
    });
    themeSel.onchange = function () { SB.Theme.set(themeSel.value); };
    panels.general.appendChild(field('Appearance', themeSel));

    /* ---------------- Models & templates ---------------- */
    panels.models.appendChild(SB.el('div', 'pp-note',
      'One entry per target model. The templates tell Gemini how to write for that model — ' +
      'Midjourney-style parameters, natural language, whatever it needs.'));
    const hint = SB.el('div', 'vmeta',
      'Placeholders: {{MODEL}} {{SHOT_TYPE}} {{SCENE}} {{SCENE_DESC}} {{SCRIPT}} {{DESCRIPTION}} {{CODE}}');
    hint.style.margin = '6px 0 10px';
    panels.models.appendChild(hint);

    const listHost = SB.el('div');
    panels.models.appendChild(listHost);

    const working = SB.clone(p.settings.models);

    function drawModels() {
      listHost.innerHTML = '';
      working.forEach(function (m, i) {
        const row = SB.el('div', 'model-row');
        const top = SB.el('div', 'top');
        const name = document.createElement('input');
        name.type = 'text'; name.value = m.name; name.placeholder = 'Model name';
        name.oninput = function () { m.name = name.value; };
        const kind = document.createElement('select');
        [['video', 'video'], ['image', 'image']].forEach(function (k) {
          const o = document.createElement('option');
          o.value = k[0]; o.textContent = k[1];
          if (m.kind === k[0]) o.selected = true;
          kind.appendChild(o);
        });
        kind.onchange = function () { m.kind = kind.value; };
        const tpl = SB.el('button', 'mini', m.__open ? 'hide templates' : 'templates');
        tpl.onclick = function () { m.__open = !m.__open; drawModels(); };
        const rst = SB.el('button', 'mini', 'reset');
        rst.title = 'Restore the default templates for this model';
        rst.onclick = function () {
          m.imageTemplate = SB.Model.IMG_TPL; m.videoTemplate = SB.Model.VID_TPL;
          m.__open = true; drawModels();
        };
        const del = SB.el('button', 'mini danger', 'remove');
        del.onclick = function () { working.splice(i, 1); drawModels(); };
        top.appendChild(name); top.appendChild(kind);
        top.appendChild(tpl); top.appendChild(rst); top.appendChild(del);
        row.appendChild(top);

        if (m.__open) {
          const ti = document.createElement('textarea');
          ti.rows = 5; ti.value = m.imageTemplate;
          ti.oninput = function () { m.imageTemplate = ti.value; };
          row.appendChild(field('first-frame (image) template', ti));

          const tv = document.createElement('textarea');
          tv.rows = 5; tv.value = m.videoTemplate;
          tv.oninput = function () { m.videoTemplate = tv.value; };
          row.appendChild(field('image→video template', tv));
        }
        listHost.appendChild(row);
      });
      const add = SB.el('button', 'tb', '+ Add model');
      add.onclick = function () {
        working.push({
          id: SB.uid('m'), name: 'New model', kind: 'video',
          imageTemplate: SB.Model.IMG_TPL, videoTemplate: SB.Model.VID_TPL, __open: true
        });
        drawModels();
      };
      listHost.appendChild(add);
    }
    drawModels();

    /* ---------------- API ---------------- */
    const key = document.createElement('input');
    key.type = 'password';
    key.value = SB.Store.getApiKey();
    key.placeholder = 'AIza…';
    panels.api.appendChild(field('Google (Gemini) API key', key));
    panels.api.appendChild(SB.el('div', 'pp-note',
      'Stored in this browser only — never written into the .storyboard file, so a board can be shared without leaking the key.'));

    let chosenModel = p.settings.geminiModel || SB.GeminiModels.DEFAULT;
    const pick = SB.GeminiModels.picker(chosenModel, function (id) { chosenModel = id; });
    const gmField = field('Gemini model used to write prompts', pick.el);
    gmField.style.marginTop = '14px';
    panels.api.appendChild(gmField);

    const refreshRow = SB.el('div', 'pp-actions');
    const refresh = SB.el('button', 'tb', 'Refresh list from my key');
    const refreshNote = SB.el('span', 'pp-note', '');
    refresh.onclick = function () {
      SB.Store.setApiKey(key.value.trim());   // use whatever is typed right now
      refresh.disabled = true;
      refreshNote.textContent = 'asking Google…';
      refreshNote.classList.remove('err');
      SB.GeminiModels.fetchAvailable().then(function (models) {
        pick.rebuild(chosenModel);
        refresh.disabled = false;
        refreshNote.textContent = models.length + ' models this key can reach.';
      }).catch(function (e) {
        refresh.disabled = false;
        refreshNote.textContent = e.message || String(e);
        refreshNote.classList.add('err');
      });
    };
    const useCurated = SB.el('button', 'tb', 'Back to curated list');
    useCurated.onclick = function () {
      SB.GeminiModels.clearCache();
      pick.rebuild(chosenModel);
      refreshNote.textContent = 'showing the built-in list.';
      refreshNote.classList.remove('err');
    };
    refreshRow.appendChild(refresh);
    refreshRow.appendChild(useCurated);
    panels.api.appendChild(refreshRow);
    panels.api.appendChild(refreshNote);
    panels.api.appendChild(SB.el('div', 'pp-note',
      'Google retires model ids on its own schedule. If a prompt run comes back 404, ' +
      'refresh this list — it asks your key what it can actually reach today.'));

    select(startTab && panels[startTab] ? startTab : 'general');

    SB.modal({
      title: 'Settings',
      width: '720px',
      body: body,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Save', primary: true, onClick: function (close) {
            const t = types.value.split('\n').map(function (s) { return s.trim(); })
              .filter(function (s) { return s; });
            p.settings.shotTypes = t.length ? t : SB.Model.DEFAULT_SHOT_TYPES.slice();
            p.settings.geminiModel = (chosenModel || '').trim() || SB.GeminiModels.DEFAULT;
            p.settings.models = working.filter(function (m) { return (m.name || '').trim(); })
              .map(function (m) { delete m.__open; return m; });
            if (!p.settings.models.length) p.settings.models = SB.Model.defaultModels();
            const has = function (id) {
              return p.settings.models.some(function (m) { return m.id === id; });
            };
            if (!has(p.settings.imageModelId)) {
              p.settings.imageModelId = SB.Model.firstOfKind(p.settings.models, 'image');
            }
            if (!has(p.settings.videoModelId)) {
              p.settings.videoModelId = SB.Model.firstOfKind(p.settings.models, 'video');
            }
            SB.Store.setApiKey(key.value.trim());
            close();
            SB.app.changed(true);
            SB.PromptPanel.refresh();
            SB.toast('Settings saved');
          }
        }
      ]
    });
  }

  SB.Settings = { open: open };

})(window.SB);
