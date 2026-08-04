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
    const order = [['general', 'General'], ['fields', 'Card fields'], ['brand', 'Brand style'],
    ['models', 'Models & templates'], ['api', 'API']];
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

    /* ---------------- Card fields ---------------- */
    panels.fields.appendChild(SB.el('div', 'pp-note',
      'Extra text boxes under each card’s description, chosen per project. Anything filled ' +
      'in is handed to the prompt writer too, and each one is available in a model template ' +
      'as a placeholder.'));

    const fieldHost = SB.el('div');
    fieldHost.style.marginTop = '10px';
    panels.fields.appendChild(fieldHost);

    function drawFields() {
      fieldHost.innerHTML = '';
      SB.Fields.all(p).forEach(function (f) {
        const row = SB.el('div', 'field-row');

        const on = document.createElement('input');
        on.type = 'checkbox';
        on.checked = !!f.enabled;
        on.title = 'Show this box on every card';
        on.onchange = function () { f.enabled = on.checked; };
        row.appendChild(on);

        const name = document.createElement('input');
        name.type = 'text';
        name.value = f.label;
        name.className = 'field-name';
        name.oninput = function () {
          f.label = name.value;
          tag.textContent = '{{' + SB.Fields.placeholder(f) + '}}';
        };
        if (f.builtin) name.readOnly = true;
        row.appendChild(name);

        const tag = SB.el('code', 'field-tag', '{{' + SB.Fields.placeholder(f) + '}}');
        row.appendChild(tag);

        if (f.builtin) {
          row.appendChild(SB.el('span', 'vmeta', 'built in'));
        } else {
          const del = SB.el('button', 'mini danger', 'remove');
          del.onclick = function () {
            let used = 0;
            SB.Model.eachShot(p, function (sh) { if (SB.Fields.value(sh, f.id).trim()) used++; });
            if (used && !confirm('Remove “' + f.label + '”? Text in it on ' + used +
              ' card(s) is deleted with it.')) return;
            SB.Fields.remove(p, f.id);
            drawFields();
          };
          row.appendChild(del);
        }
        fieldHost.appendChild(row);
      });

      const add = SB.el('button', 'tb', '+ Add a field');
      add.onclick = function () {
        SB.Fields.add(p, 'New field');
        drawFields();
      };
      fieldHost.appendChild(add);
    }
    drawFields();

    /* ---------------- Brand style ---------------- */
    const brand = SB.Brand.brandOf(p);
    const bOn = SB.el('label', 'pp-toggle');
    const bChk = document.createElement('input');
    bChk.type = 'checkbox';
    bChk.checked = brand.enabled;
    bOn.appendChild(bChk);
    bOn.appendChild(document.createTextNode(' Apply the house style to every prompt'));
    panels.brand.appendChild(bOn);

    panels.brand.appendChild(SB.el('div', 'pp-note',
      'Rides along with every prompt the app writes, on top of the per-model templates. ' +
      'The app adds the scene’s beat list underneath it automatically, so “same subject, same ' +
      'wardrobe, same location across the sequence” is something the writer can actually act on. ' +
      'The no-gendered-language rule is verified on the way back, not just requested.'));

    const bText = document.createElement('textarea');
    bText.rows = 22;
    bText.value = (p.settings.brand && p.settings.brand.text) || SB.Brand.DEFAULT;
    bText.style.fontSize = '11.5px';
    const bField = field('House style', bText);
    bField.style.marginTop = '10px';
    panels.brand.appendChild(bField);

    const bActs = SB.el('div', 'pp-actions');
    const bReset = SB.el('button', 'tb', 'Restore the default style');
    bReset.onclick = function () { bText.value = SB.Brand.DEFAULT; };
    const bPreview = SB.el('button', 'tb', 'Preview what a shot sends');
    bPreview.onclick = function () {
      const f = SB.app.selectedShotId && SB.Model.findShot(p, SB.app.selectedShotId);
      const shot = f ? f.shot : (p.scenes[0] && p.scenes[0].shots[0]);
      if (!shot) { SB.toast('Add a shot first', true); return; }
      const saved = p.settings.brand.text;
      p.settings.brand.text = bText.value;      // preview what is on screen
      const body = SB.el('div');
      const pre = document.createElement('textarea');
      pre.rows = 24;
      pre.readOnly = true;
      pre.value = SB.Brand.systemFor(p, shot, 'both');
      pre.style.fontSize = '11px';
      body.appendChild(pre);
      p.settings.brand.text = saved;
      SB.modal({
        title: 'System instruction for this shot', width: '760px', body: body,
        buttons: [{ label: 'Close', primary: true }]
      });
    };
    bActs.appendChild(bReset);
    bActs.appendChild(bPreview);
    panels.brand.appendChild(bActs);

    /* ---------------- Models & templates ---------------- */
    panels.models.appendChild(SB.el('div', 'pp-note',
      'One entry per target model. The templates tell Gemini how to write for that model — ' +
      'Midjourney-style parameters, natural language, whatever it needs.'));
    const fieldTags = SB.Fields.enabled(p).map(function (f) {
      return '{{' + SB.Fields.placeholder(f) + '}}';
    }).join(' ');
    const hint = SB.el('div', 'vmeta',
      'Placeholders: {{MODEL}} {{SHOT_TYPE}} {{SCENE}} {{SCENE_DESC}} {{SCRIPT}} {{DESCRIPTION}} {{CODE}}' +
      (fieldTags ? ' · your fields: ' + fieldTags + ' (or {{FIELDS}} for all of them)' : ''));
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

          const tr = document.createElement('textarea');
          tr.rows = 3;
          tr.value = m.referenceTemplate || SB.Personas.DEFAULT_REF_TEMPLATE;
          tr.oninput = function () { m.referenceTemplate = tr.value; };
          const trF = field('reference-image wording — how THIS model expects to be told about ' +
            'persona references ({{N}} = image number, {{NAME}} = names)', tr);
          row.appendChild(trF);
          const trHint = SB.el('div', 'pp-note',
            'Only used on shots that have cast. Leave blank for a model that takes no references.');
          row.appendChild(trHint);
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
            const bTxt = bText.value.trim();
            p.settings.brand = (bTxt && bTxt !== SB.Brand.DEFAULT.trim())
              ? { enabled: bChk.checked, custom: true, text: bTxt }
              : { enabled: bChk.checked, custom: false };
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
