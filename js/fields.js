/* fields.js — the extra text boxes a card carries, chosen per project.
 *
 * Every board wants something different under the description: art direction
 * on one, SFX on another, a client's own column on a third. The set lives in
 * the project, so it travels with the board, and the values live on the shot.
 *
 * Anything filled in is handed to the prompt writer as well — art direction
 * that only the storyboard can see is not much use.
 */
(function (SB) {
  'use strict';

  /* Ship the ones asked for, switched off until wanted. */
  function defaults() {
    return [
      { id: 'artDirection', label: 'Art direction', enabled: false, builtin: true },
      { id: 'context', label: 'Context', enabled: false, builtin: true },
      { id: 'sfx', label: 'SFX', enabled: false, builtin: true }
    ];
  }

  function all(p) {
    const s = p.settings || {};
    if (!Array.isArray(s.fields) || !s.fields.length) s.fields = defaults();
    return s.fields;
  }

  function enabled(p) {
    return all(p).filter(function (f) { return f.enabled; });
  }

  function find(p, id) {
    return all(p).filter(function (f) { return f.id === id; })[0] || null;
  }

  function add(p, label) {
    const f = {
      id: SB.uid('fld'),
      label: (label || 'New field').trim() || 'New field',
      enabled: true,
      builtin: false
    };
    all(p).push(f);
    return f;
  }

  /* Removing a field takes its text with it — the caller confirms first. */
  function remove(p, id) {
    p.settings.fields = all(p).filter(function (f) { return f.id !== id; });
    SB.Model.eachShot(p, function (sh) {
      if (sh.fields) delete sh.fields[id];
    });
  }

  function value(shot, id) {
    return (shot.fields && shot.fields[id]) || '';
  }

  function set(shot, id, text) {
    shot.fields = shot.fields || {};
    if (text) shot.fields[id] = text;
    else delete shot.fields[id];
  }

  /* ART_DIRECTION, SFX, MY_OWN_FIELD — usable in a model template. */
  function placeholder(f) {
    if (f.id === 'artDirection') return 'ART_DIRECTION';
    if (f.id === 'context') return 'CONTEXT';
    if (f.id === 'sfx') return 'SFX';
    return String(f.label || 'FIELD').toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '') || 'FIELD';
  }

  function placeholders(p, shot) {
    const out = {};
    enabled(p).forEach(function (f) { out[placeholder(f)] = value(shot, f.id); });
    return out;
  }

  /* What gets appended to a prompt request for this shot. */
  function promptBlock(p, shot) {
    const filled = enabled(p).filter(function (f) { return value(shot, f.id).trim(); });
    if (!filled.length) return '';
    return filled.map(function (f) {
      return f.label.toUpperCase() + ':\n' + value(shot, f.id).trim();
    }).join('\n\n');
  }

  function migrate(p) {
    const s = p.settings;
    if (!Array.isArray(s.fields)) s.fields = defaults();
    s.fields = s.fields.filter(function (f) { return f && f.id; }).map(function (f) {
      return {
        id: f.id,
        label: f.label || f.id,
        enabled: !!f.enabled,
        builtin: !!f.builtin
      };
    });
    // make sure the shipped three are always offered, even in an older file
    defaults().forEach(function (d) {
      if (!s.fields.some(function (f) { return f.id === d.id; })) s.fields.push(d);
    });
  }

  SB.Fields = {
    defaults: defaults, all: all, enabled: enabled, find: find,
    add: add, remove: remove, value: value, set: set,
    placeholder: placeholder, placeholders: placeholders,
    promptBlock: promptBlock, migrate: migrate
  };

})(window.SB);
