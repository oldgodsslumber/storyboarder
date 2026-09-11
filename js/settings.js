/* settings.js — tabbed: General · Card fields · Brand · Models & templates · API. */
(function (SB) {
  'use strict';

  function P() { return SB.app.project; }

  function field(labelText, control) {
    const l = SB.el('label', 'field');
    l.appendChild(SB.el('span', null, labelText));
    l.appendChild(control);
    return l;
  }


  /* Where the full-size renders live. The handle is per-browser and is kept the
   * way the project file's handle is — never in the .storyboard, because it is a
   * fact about this machine. */
  /* ---------------- originals & clips ----------------
   *
   * They used to go to a folder this browser remembered, which was a fact
   * about one machine and never travelled with the board. Now they are in the
   * file, which makes the file the only thing anyone has to send — and makes
   * its weight something worth showing, since it is now mostly pictures the
   * board never draws.
   */
  function kb(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function originalsBlock() {
    const box = SB.el('div', 'pp-block');
    box.appendChild(SB.el('div', 't', 'originals & clips'));
    box.appendChild(SB.el('div', 'pp-note',
      'Every picture is held twice: the ≤480p copy the board draws, and the full-size ' +
      'original a model gets handed. Clips are held whole. All of it is inside the ' +
      '.storyboard, so handing the file to someone hands over the whole board — there is ' +
      'no folder to connect and nothing to lose on the way.'));

    const w = SB.Renders.weigh(P());
    const table = SB.el('div', 'weigh');
    [['the board’s copies', w.proxies], ['full-size originals', w.originals],
     ['clips', w.clips], ['ink', w.ink]].forEach(function (r) {
      if (!r[1].n) return;
      const line = SB.el('div', 'weigh-row');
      line.appendChild(SB.el('span', 'n', String(r[1].n)));
      line.appendChild(SB.el('span', 'l', r[0]));
      line.appendChild(SB.el('span', 'b', kb(r[1].bytes)));
      table.appendChild(line);
    });
    const tot = SB.el('div', 'weigh-row total');
    tot.appendChild(SB.el('span', 'n', ''));
    tot.appendChild(SB.el('span', 'l', 'pictures in this file'));
    tot.appendChild(SB.el('span', 'b', kb(w.total)));
    table.appendChild(tot);
    box.appendChild(table);

    /* A clip is two orders of magnitude heavier than a still, and the whole
       file is rewritten on every autosave — so the number that matters is not
       "is this big" but "is this big enough to feel". */
    if (w.total > 40 * 1024 * 1024) {
      box.appendChild(SB.el('div', 'pp-note warn',
        'This board is heavy enough that saving it takes a noticeable moment — almost all of ' +
        'it is clips. Deleting a clip you have already cut with, or keeping the shot and ' +
        'dropping its take, gives the weight straight back.'));
    }

    if (w.dangling) {
      box.appendChild(SB.el('div', 'pp-note warn',
        w.dangling + (w.dangling === 1 ? ' record points' : ' records point') +
        ' at pictures this file no longer holds. That should not happen — if you know ' +
        'which shots they are, drop the pictures in again; otherwise an older copy of ' +
        'this board is the safer thing to work from.'));
    }

    if (w.legacy) {
      box.appendChild(SB.el('div', 'pp-note warn',
        w.legacy + (w.legacy === 1 ? ' frame was' : ' frames were') + ' filed when originals ' +
        'lived in a folder on one machine, so only the board copy is in this file. Drop ' +
        (w.legacy === 1 ? 'that picture' : 'those pictures') + ' in again to bring the ' +
        (w.legacy === 1 ? 'original' : 'originals') + ' with them.'));
    }

    const pick = document.createElement('select');
    [['webp', 'Re-encoded at full size (WebP) — about 16× smaller'],
     ['source', 'Exactly the bytes that arrived — much bigger files']].forEach(function (o) {
      const el = document.createElement('option');
      el.value = o[0]; el.textContent = o[1];
      if ((P().settings.originals || 'webp') === o[0]) el.selected = true;
      pick.appendChild(el);
    });
    pick.onchange = function () {
      P().settings.originals = pick.value === 'source' ? 'source' : 'webp';
      SB.Store.touch();
    };
    const f = field('How originals are kept', pick);
    f.style.marginTop = '12px';
    box.appendChild(f);
    box.appendChild(SB.el('div', 'pp-note',
      'Measured on a real board: a 1184×672 render is 1 MB as the PNG it arrives as and 63 KB ' +
      're-encoded, at a quality no reference use can tell apart. Forty of them is the ' +
      'difference between a 7 MB board and a 73 MB one. Changing this affects the next ' +
      'picture you drop, not the ones already here.'));
    return box;
  }

  function open(startTab) {
    const p = P();
    const body = SB.el('div');

    const tabs = SB.el('div', 'tabs');
    const panels = {};
    const order = [['general', 'General'], ['fields', 'Card fields'], ['brand', 'Brand style'],
    ['models', 'Models & templates'], ['imagine', 'ImagineArt'], ['api', 'API']];
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

    /* ---- what this board is carrying ---- */
    panels.general.appendChild(originalsBlock());

    /* ---------------- Card fields ---------------- */
    panels.fields.appendChild(SB.el('div', 'pp-note',
      'Extra text boxes under each card’s description, chosen per project. Anything filled ' +
      'in is handed to the prompt writer too, and each one is available in a model template ' +
      'as a placeholder.'));

    const fieldHost = SB.el('div');
    fieldHost.style.marginTop = '10px';
    panels.fields.appendChild(fieldHost);

    /* Edit a copy, like the model list does: Cancel has to leave the project
     * exactly as it was — renaming a field, switching one off, and above all
     * removing one (which takes its text off every card with it) used to land
     * the moment it was typed, whichever button was pressed afterwards. */
    const workingFields = SB.clone(SB.Fields.all(p));

    function drawFields() {
      fieldHost.innerHTML = '';
      workingFields.forEach(function (f) {
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
            const at = workingFields.indexOf(f);
            if (at >= 0) workingFields.splice(at, 1);
            drawFields();
          };
          row.appendChild(del);
        }
        fieldHost.appendChild(row);
      });

      const add = SB.el('button', 'tb', '+ Add a field');
      add.onclick = function () {
        workingFields.push({ id: SB.uid('fld'), label: 'New field', enabled: true, builtin: false });
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
      'wardrobe, same location across the sequence” is something the writer can actually act on.'));

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
        /* Which ImagineArt model this one is, so the prompt table can push a
           prompt at it. Free text with the known slugs offered: the catalog is
           ImagineArt's to change, and a board must not be stuck waiting for
           this app to hear about a new one. */
        const slug = document.createElement('input');
        slug.type = 'text';
        slug.className = 'slug';
        slug.value = m.imagineSlug || '';
        slug.placeholder = 'ImagineArt model — none';
        slug.title = 'The slug ImagineArt knows this model by. Blank means this model is ' +
          'never pushed; the prompt is still written and copied as usual.';
        const dlId = 'slugs-' + m.id;
        slug.setAttribute('list', dlId);
        const dl = document.createElement('datalist');
        dl.id = dlId;
        /* Only this model's kind: a video model should never be offered
           flux-dev. Each option carries the readable name, so the list can be
           read as well as matched. */
        ((SB.Imagine && SB.Imagine.catalogAll()) || []).forEach(function (mm) {
          if (mm.kind !== m.kind) return;
          const o = document.createElement('option');
          o.value = mm.slug;
          o.label = SB.Imagine.labelFor(mm.slug, mm.mode);
          dl.appendChild(o);
        });
        /* A slug ImagineArt no longer offers is found here, at the desk,
           rather than at the push — where it costs a refusal and a wait. */
        const slugNote = SB.el('div', 'pp-note warn');
        slugNote.style.display = 'none';
        const checkSlug = function () {
          const v = (m.imagineSlug || '').trim();
          const known = !v || !SB.Imagine || !!SB.Imagine.modelInfo(v);
          slug.classList.toggle('unknown', !known);
          slugNote.style.display = known ? 'none' : '';
          if (!known) {
            slugNote.textContent = 'ImagineArt does not list “' + v + '” for ' + m.kind +
              ' — it may have been retired, or it may be newer than this list. It will still ' +
              'be sent if you leave it.';
          }
        };
        slug.oninput = function () { m.imagineSlug = slug.value.trim(); checkSlug(); };
        checkSlug();
        const tpl = SB.el('button', 'mini', m.__open ? 'hide templates' : 'templates');
        tpl.onclick = function () { m.__open = !m.__open; drawModels(); };
        const rst = SB.el('button', 'mini', 'reset');
        rst.title = 'Restore the default templates for this model';
        rst.onclick = function () {
          const t = SB.Model.tplsFor(m.name);
          m.imageTemplate = t.image; m.videoTemplate = t.video;
          m.referenceTemplate = t.reference;
          m.__open = true; drawModels();
        };
        const del = SB.el('button', 'mini danger', 'remove');
        del.onclick = function () { working.splice(i, 1); drawModels(); };
        top.appendChild(name); top.appendChild(kind);
        top.appendChild(slug); top.appendChild(dl);
        row.appendChild(slugNote);
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
          /* Shown as stored, so a box left blank stays blank instead of the
             default reappearing and looking like the clearing never took. */
          tr.value = typeof m.referenceTemplate === 'string'
            ? m.referenceTemplate : SB.Personas.DEFAULT_REF_TEMPLATE;
          tr.placeholder = 'blank — no reference wording is sent for this model';
          tr.oninput = function () { m.referenceTemplate = tr.value; };
          const trF = field('reference-image wording — how THIS model expects to be told about ' +
            'reference images ({{N}} = image number, {{NAME}} = names)', tr);
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
          id: SB.uid('m'), name: 'New model', kind: 'video', imagineSlug: '',
          imageTemplate: SB.Model.IMG_TPL, videoTemplate: SB.Model.VID_TPL, __open: true
        });
        drawModels();
      };
      listHost.appendChild(add);
    }
    drawModels();

    /* ---------------- ImagineArt ----------------
     *
     * Two doors, and they bill differently, so the user picks rather than the
     * app guessing. Signing in spends the credits the imagine.art account
     * already has and stores nothing but a token; an API key is a second bill
     * but needs no address to come back to — which is the only way in when the
     * app is opened straight off the disk.
     */
    const IM = SB.Imagine;
    let chosenImagine = IM ? IM.transport() : 'oauth';

    function imLink(href, text) {
      const a = document.createElement('a');
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = text;
      return a;
    }

    panels.imagine.appendChild(SB.el('div', 'pp-note',
      'Where a finished prompt goes when you press ▶ in the Prompts panel. One press is ' +
      'one generation — a still lands on the card like any other frame, a clip is kept in ' +
      'the board beside it.'));

    const imPick = SB.el('div', 'prov-pick');
    const imBtns = {};
    const imBlocks = { oauth: SB.el('div', 'prov-block'), key: SB.el('div', 'prov-block') };

    function showImagine(id) {
      chosenImagine = id === 'key' ? 'key' : 'oauth';
      Object.keys(imBtns).forEach(function (k) {
        imBtns[k].classList.toggle('on', k === chosenImagine);
      });
      Object.keys(imBlocks).forEach(function (k) {
        imBlocks[k].classList.toggle('hidden', k !== chosenImagine);
      });
    }

    [['oauth', 'Sign in with ImagineArt'], ['key', 'API key']].forEach(function (t) {
      const b = SB.el('button', 'tb toggle', t[1]);
      b.onclick = function () { showImagine(t[0]); };
      imBtns[t[0]] = b;
      imPick.appendChild(b);
    });
    panels.imagine.appendChild(imPick);
    panels.imagine.appendChild(imBlocks.oauth);
    panels.imagine.appendChild(imBlocks.key);

    /* ---- signed in ---- */

    const imStatus = SB.el('div', 'pp-status');
    imBlocks.oauth.appendChild(imStatus);

    const imActs = SB.el('div', 'pp-actions');
    const imIn = SB.el('button', 'tb', 'Sign in');
    const imOut = SB.el('button', 'tb', 'Sign out');
    const imCheck = SB.el('button', 'tb', 'Check account');
    imActs.appendChild(imIn); imActs.appendChild(imCheck); imActs.appendChild(imOut);
    imBlocks.oauth.appendChild(imActs);

    const imNote = SB.el('div', 'pp-note', '');
    imBlocks.oauth.appendChild(imNote);

    const imTools = SB.el('div', 'pp-note dim', '');
    imBlocks.oauth.appendChild(imTools);

    /* Which model list the slug field is offering, and how old it is. Without
       this the field shows a number and no way to tell whose number it is. */
    const imModels = SB.el('div', 'pp-note', '');
    const imModelsRow = SB.el('div', 'pp-actions');
    const imRefresh = SB.el('button', 'tb', 'Refresh models');
    imModelsRow.appendChild(imRefresh);
    panels.imagine.appendChild(imModels);
    panels.imagine.appendChild(imModelsRow);

    function ago(ms) {
      if (ms == null) return '';
      const m = Math.round(ms / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
      const h = Math.round(m / 60);
      if (h < 36) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
      return Math.round(h / 24) + ' days ago';
    }

    function drawCatalogLine() {
      if (!IM) return;
      const all = IM.catalogAll();
      const img = all.filter(function (x) { return x.kind === 'image'; }).length;
      const vid = all.length - img;
      const src = IM.catalogSource();
      const counts = all.length + ' models — ' + img + ' image · ' + vid + ' video. ';
      if (src === 'account') {
        imModels.textContent = counts + 'From your account, checked ' + ago(IM.catalogAge()) + '.';
        imModels.classList.remove('warn');
      } else if (src === 'shipped') {
        imModels.textContent = counts + 'The built-in list, published by ImagineArt on ' +
          ((SB.ImagineModels && SB.ImagineModels.fetchedAt) || 'an unknown date') +
          '. Sign in and this becomes whatever your account actually offers.';
        imModels.classList.toggle('warn', !IM.isSignedIn() ? false : true);
      } else {
        imModels.textContent = counts + 'A last-resort handful — the generated list did not load.';
        imModels.classList.add('warn');
      }
      imRefresh.disabled = !IM.isSignedIn();
      imRefresh.title = IM.isSignedIn()
        ? 'Ask the account what it offers now. Models come and go.'
        : 'Sign in to read your account\u2019s own list.';
    }

    imRefresh.onclick = function () {
      imRefresh.disabled = true;
      imRefresh.textContent = 'asking…';
      IM.refreshCatalog().then(function (r) {
        const bits = [];
        if (r.added.length) bits.push(r.added.length + ' new');
        if (r.gone.length) bits.push(r.gone.length + ' gone: ' + r.gone.slice(0, 3).join(', '));
        SB.toast(r.list.length + ' models' + (bits.length ? ' — ' + bits.join(', ') : ''));
      }).catch(function (e) {
        SB.toast(e.message || String(e), !e.soft);
      }).then(function () {
        imRefresh.textContent = 'Refresh models';
        drawCatalogLine();
      });
    };

    imBlocks.oauth.appendChild(SB.el('div', 'pp-note',
      'The sign-in is ImagineArt’s own OAuth: a window opens, you approve, it closes. ' +
      'Nothing but the token is kept, and it is kept in this browser — never in the ' +
      '.storyboard file.'));

    function imDraw() {
      if (!IM) { imStatus.textContent = 'ImagineArt support is not loaded.'; return; }
      const why = IM.signInBlocked();
      const acct = IM.account();
      const inOk = IM.isSignedIn();
      imIn.style.display = inOk ? 'none' : '';
      imOut.style.display = inOk ? '' : 'none';
      imCheck.style.display = inOk ? '' : 'none';
      imIn.disabled = !!why;
      if (inOk) {
        const who = (acct && acct.email) || 'signed in';
        const cr = acct && typeof acct.credits === 'number'
          ? ' · ' + acct.credits + ' credits' : '';
        imStatus.textContent = who + cr;
        imStatus.classList.remove('err');
      } else {
        imStatus.textContent = why ? 'Cannot sign in here' : 'Not signed in';
        imStatus.classList.toggle('err', !!why);
      }
      imNote.textContent = why || '';
      imNote.classList.toggle('err', !!why);
      drawCatalogLine();
      const tools = IM.tools();
      if (inOk && tools.length) {
        imTools.textContent = tools.length + ' tools offered: ' +
          tools.slice(0, 8).map(function (t) { return t.name; }).join(', ') +
          (tools.length > 8 ? ', …' : '');
      } else {
        imTools.textContent = '';
      }
    }

    imIn.onclick = function () {
      imIn.disabled = true;
      imStatus.textContent = 'waiting for the sign-in window…';
      IM.signIn().then(function () {
        return IM.toolList(true).catch(function () { return null; });
      }).then(function () {
        return IM.balance().catch(function () { return null; });
      }).then(function () {
        imIn.disabled = false;
        imDraw();
        SB.toast('Signed in to ImagineArt');
      }).catch(function (e) {
        imIn.disabled = false;
        imDraw();
        imNote.textContent = e.message;
        imNote.classList.add('err');
      });
    };

    imOut.onclick = function () {
      IM.signOut();
      imDraw();
    };

    imCheck.onclick = function () {
      imCheck.disabled = true;
      imStatus.textContent = 'asking ImagineArt…';
      IM.whoAmI().catch(function () { return null; }).then(function () {
        return IM.toolList(true).catch(function () { return null; });
      }).then(function () {
        return IM.balance().catch(function () { return null; });
      }).then(function () {
        imCheck.disabled = false;
        imDraw();
      });
    };

    /* ---- key ---- */

    const imKey = document.createElement('input');
    imKey.type = 'password';
    imKey.value = IM ? IM.apiKey() : '';
    imKey.placeholder = 'vk-…';
    imBlocks.key.appendChild(field('ImagineArt API key', imKey));
    const imKeyHow = SB.el('div', 'pp-note');
    imKeyHow.appendChild(document.createTextNode('Made at '));
    imKeyHow.appendChild(imLink('https://platform.imagine.art/', 'platform.imagine.art ↗'));
    imKeyHow.appendChild(document.createTextNode(
      '. This is a separate, metered API balance — it is not the credits on the ' +
      'imagine.art plan. Stored in this browser only.'));
    imBlocks.key.appendChild(imKeyHow);

    /* ---- shared ---- */

    const imAspect = document.createElement('select');
    ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2'].forEach(function (r) {
      const o = document.createElement('option');
      o.value = r; o.textContent = r;
      if ((p.settings.imagineAspect || '16:9') === r) o.selected = true;
      imAspect.appendChild(o);
    });
    const imAspF = field('Aspect ratio asked for', imAspect);
    imAspF.style.marginTop = '14px';
    panels.imagine.appendChild(imAspF);
    panels.imagine.appendChild(SB.el('div', 'pp-note',
      'Saved with the project — it is how this board is shot, not a fact about this browser.'));
    panels.imagine.appendChild(SB.el('div', 'pp-note',
      'Which ImagineArt model each of your models means is set per model, in ' +
      'Models & templates. A model with none is never pushed.'));

    showImagine(chosenImagine);
    imDraw();
    /* A day old is old enough: models come and go, and the only moment this
       matters is the moment somebody opens the page where slugs are chosen.
       Never blocking — the cached list is already on screen. */
    const DAY = 24 * 60 * 60 * 1000;
    if (IM && IM.isSignedIn() && (IM.catalogAge() == null || IM.catalogAge() > DAY)) {
      IM.refreshCatalog().then(function () { drawCatalogLine(); }).catch(function () { });
    }

    /* ---------------- API ----------------
     * Two backends, picked at the top: Google's Gemini, or any local
     * OpenAI-compatible server (oobabooga's text-generation-webui, LM Studio,
     * llama.cpp, KoboldCpp). Each keeps its own settings, so switching back
     * and forth costs nothing — the one you left is exactly as you left it.
     *
     * The Gemini key field on its own only helps someone who already has a
     * key. The path from "no Google account set up" to a working key is five
     * steps, and step 2 is also what clears the blocked-API dialog on this
     * network, so it is spelled out here rather than left to be asked about.
     */
    let chosenProvider = SB.Providers.normalize(p.settings.aiProvider);

    const provRow = SB.el('div', 'prov-pick');
    const provBtns = {};
    const provBlocks = {};

    function showProvider(id) {
      chosenProvider = SB.Providers.normalize(id);
      Object.keys(provBtns).forEach(function (k) {
        provBtns[k].classList.toggle('on', k === chosenProvider);
      });
      Object.keys(provBlocks).forEach(function (k) {
        provBlocks[k].classList.toggle('hidden', k !== chosenProvider);
      });
    }

    SB.Providers.list().forEach(function (prov) {
      const b = SB.el('button', 'tb toggle', prov.label);
      b.onclick = function () { showProvider(prov.id); };
      provBtns[prov.id] = b;
      provRow.appendChild(b);
      /* Named, so the two providers' panels are told apart from the outside —
         both hold a model picker of the same shape. */
      provBlocks[prov.id] = SB.el('div', 'prov-block');
      provBlocks[prov.id].dataset.prov = prov.id;
    });
    panels.api.appendChild(SB.el('div', 'pp-label', 'Who writes the prompts'));
    panels.api.appendChild(provRow);
    panels.api.appendChild(SB.el('div', 'pp-note',
      'The choice is saved with the project. Both sides keep their own model and ' +
      'credentials in this browser, so switching back is lossless.'));
    SB.Providers.list().forEach(function (prov) {
      panels.api.appendChild(provBlocks[prov.id]);
    });

    const gemPanel = provBlocks.gemini;
    const oobaPanel = provBlocks.ooba;

    const how = SB.el('div', 'setup');
    how.appendChild(SB.el('div', 't', 'Getting a key'));
    const steps = document.createElement('ol');
    steps.className = 'setup-steps';

    function step(parts) {
      const li = document.createElement('li');
      parts.forEach(function (x) {
        li.appendChild(typeof x === 'string' ? document.createTextNode(x) : x);
      });
      steps.appendChild(li);
      return li;
    }
    function mono(text) { return SB.el('code', 'setup-mono', text); }
    function ext(href, text) {
      const a = document.createElement('a');
      a.href = href; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = text;
      return a;
    }

    step(['Open ', ext(SB.AISTUDIO_URL, 'aistudio.google.com ↗'),
      ' and sign in with the Google account this board should bill to.']);
    const s2 = step(['Accept the terms when prompted. ']);
    s2.appendChild(SB.el('span', 'dim',
      'This is also the step that clears the “API is being blocked” dialog on the Pega ' +
      'network — it only has to be done once in this browser.'));
    step([mono('Get API key'), ' → ', mono('Create API key'),
      '. Pick an existing Google Cloud project or let it make one. ']);
    steps.lastChild.appendChild(SB.el('span', 'dim',
      'The free-tier daily allowance is counted per project, so a project of your own keeps ' +
      'your quota separate from anyone else’s.'));
    step(['Copy the ', mono('AIza…'), ' string and paste it into the field below.']);
    step(['Press ', mono('Refresh list from my key'),
      ' — if it comes back with a model count, everything downstream works.']);

    how.appendChild(steps);
    gemPanel.appendChild(how);

    const key = document.createElement('input');
    key.type = 'password';
    key.value = SB.Store.getApiKey();
    key.placeholder = 'AIza…';
    gemPanel.appendChild(field('Google (Gemini) API key', key));
    gemPanel.appendChild(SB.el('div', 'pp-note',
      'Stored in this browser only — never written into the .storyboard file, so a board can be shared without leaking the key.'));
    gemPanel.appendChild(SB.el('div', 'pp-note',
      'The free tier is counted per Google Cloud project per day. What this browser has spent ' +
      'today is shown as “Free calls” in the Prompts panel.'));

    let chosenModel = p.settings.geminiModel || SB.GeminiModels.DEFAULT;
    const pick = SB.GeminiModels.picker(chosenModel, function (id) { chosenModel = id; });
    const gmField = field('Gemini model used to write prompts', pick.el);
    gmField.style.marginTop = '14px';
    gemPanel.appendChild(gmField);

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
        if (SB.apiBlocked(e, function () { refresh.onclick(); })) {
          refreshNote.textContent = 'blocked — see the dialog';
          refreshNote.classList.add('err');
          return;
        }
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
    gemPanel.appendChild(refreshRow);
    gemPanel.appendChild(refreshNote);
    gemPanel.appendChild(SB.el('div', 'pp-note',
      'Google retires model ids on its own schedule. If a prompt run comes back 404, ' +
      'refresh this list — it asks your key what it can actually reach today.'));


    /* ---- local / OpenAI-compatible server ---- */
    const oobaSaved = SB.Store.getOoba();

    oobaPanel.appendChild(SB.el('div', 'pp-note',
      'Any server speaking the OpenAI chat API: oobabooga’s text-generation-webui started ' +
      'with --api, LM Studio, llama.cpp’s server, KoboldCpp. Nothing leaves your machine, ' +
      'there is no quota, and no key is needed unless you launched the server with one.'));

    const oUrl = document.createElement('input');
    oUrl.type = 'text';
    oUrl.value = oobaSaved.url || '';
    oUrl.placeholder = SB.Providers.DEFAULT_OOBA_URL;
    oobaPanel.appendChild(field('Server address', oUrl));
    oobaPanel.appendChild(SB.el('div', 'pp-note',
      'Just the host and port — /v1/chat/completions is added for you. ' +
      'Blank means ' + SB.Providers.DEFAULT_OOBA_URL + '.'));

    /* Same shape as the Gemini picker: a list when the server has told us
     * what it has, and a free-text box for when it hasn't. */
    let oobaModel = oobaSaved.model || '';
    const oSel = document.createElement('select');
    const oCustom = document.createElement('input');
    oCustom.type = 'text';
    oCustom.className = 'gm-custom';
    oCustom.placeholder = 'model name as the server reports it';
    const oWrap = SB.el('div', 'gm-picker');
    oWrap.appendChild(oSel);
    oWrap.appendChild(oCustom);

    function buildOoba(list) {
      oSel.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = 'whatever is loaded (send no model name)';
      oSel.appendChild(none);
      let matched = !oobaModel;
      (list || []).forEach(function (m) {
        const o = document.createElement('option');
        o.value = m.id; o.textContent = m.label || m.id;
        if (m.id === oobaModel) { o.selected = true; matched = true; }
        oSel.appendChild(o);
      });
      if (oobaModel && !matched) {
        const o = document.createElement('option');
        o.value = oobaModel; o.textContent = oobaModel + ' — (not listed)';
        o.selected = true;
        oSel.insertBefore(o, oSel.firstChild.nextSibling);
      }
      const oc = document.createElement('option');
      oc.value = '__custom'; oc.textContent = 'Custom…';
      oSel.appendChild(oc);
      oCustom.classList.add('hidden');
    }
    buildOoba(null);

    oSel.addEventListener('change', function () {
      if (oSel.value === '__custom') {
        oCustom.classList.remove('hidden');
        oCustom.value = oobaModel || '';
        oCustom.focus();
        return;
      }
      oCustom.classList.add('hidden');
      oobaModel = oSel.value;
    });
    oCustom.addEventListener('input', function () { oobaModel = oCustom.value.trim(); });

    oobaPanel.appendChild(field('Model', oWrap));
    oobaPanel.appendChild(SB.el('div', 'pp-note',
      'text-generation-webui serves the one model you have loaded and ignores this. ' +
      'LM Studio and llama-server want the name — load the list to fill it in.'));

    const oKey = document.createElement('input');
    oKey.type = 'password';
    oKey.value = oobaSaved.key || '';
    oKey.placeholder = 'usually blank';
    oobaPanel.appendChild(field('API key (only if the server asks for one)', oKey));

    const oActs = SB.el('div', 'pp-actions');
    const oLoad = SB.el('button', 'tb', 'Load models from the server');
    const oTest = SB.el('button', 'tb', 'Test connection');
    const oNote = SB.el('span', 'pp-note', '');

    /* Both buttons work off what is typed right now, not what was saved —
     * otherwise the first thing anyone does is press Save to find out whether
     * the address they just typed is right. */
    function liveOoba() {
      SB.Store.setOoba({ url: oUrl.value, model: oobaModel, key: oKey.value });
    }
    function oobaFail(e) {
      oNote.textContent = e.message || String(e);
      oNote.classList.add('err');
    }

    oLoad.onclick = function () {
      liveOoba();
      oLoad.disabled = true;
      oNote.textContent = 'asking the server…';
      oNote.classList.remove('err');
      SB.Providers.get('ooba').listModels(oUrl.value).then(function (list) {
        oLoad.disabled = false;
        buildOoba(list);
        oNote.textContent = list.length + ' model' + (list.length === 1 ? '' : 's') + ' loaded.';
      }).catch(function (e) { oLoad.disabled = false; oobaFail(e); });
    };

    /* A model list can come back from a server with nothing loaded, so the
     * only honest test is a real completion. */
    oTest.onclick = function () {
      liveOoba();
      const wasProvider = p.settings.aiProvider;
      p.settings.aiProvider = 'ooba';
      oTest.disabled = true;
      oNote.textContent = 'sending a test prompt…';
      oNote.classList.remove('err');
      const started = Date.now();
      SB.Prompts.raw('Reply with the JSON object {"ok":true} and nothing else.',
        { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] })
        .then(function () {
          oNote.textContent = 'answered in ' + (Date.now() - started) + ' ms — ready to write prompts.';
        })
        .catch(oobaFail)
        .then(function () {
          oTest.disabled = false;
          p.settings.aiProvider = wasProvider;
        });
    };

    oActs.appendChild(oLoad);
    oActs.appendChild(oTest);
    oobaPanel.appendChild(oActs);
    oobaPanel.appendChild(oNote);

    showProvider(chosenProvider);

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

            /* Card fields: removals take their text off every card, so they are
             * applied here rather than while the dialog is open. */
            const kept = {};
            workingFields.forEach(function (f) { kept[f.id] = 1; });
            SB.Fields.all(p).slice().forEach(function (f) {
              if (!kept[f.id]) SB.Fields.remove(p, f.id);
            });
            p.settings.fields = workingFields.map(function (f) {
              return {
                id: f.id,
                label: (f.label || '').trim() || 'Field',
                enabled: !!f.enabled,
                builtin: !!f.builtin
              };
            });

            const bTxt = bText.value.trim();
            p.settings.brand = (bTxt && bTxt !== SB.Brand.DEFAULT.trim())
              ? { enabled: bChk.checked, custom: true, text: bTxt }
              : { enabled: bChk.checked, custom: false };
            p.settings.aiProvider = SB.Providers.normalize(chosenProvider);
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
            SB.Store.setOoba({ url: oUrl.value, model: oobaModel, key: oKey.value });
            p.settings.imagineAspect = imAspect.value || '16:9';
            if (IM) {
              IM.setTransport(chosenImagine);
              IM.setApiKey(imKey.value);
            }
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
