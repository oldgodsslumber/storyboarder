/* personas.js — recurring people, so the same face and the same clothes come
 * back shot after shot.
 *
 * A persona holds a description, the prompt that made its reference frame, and
 * the reference image itself (≤480p proxy, like every other image here). Shots
 * name the personas that appear in them; the prompt writer then gets both the
 * description AND the phrasing that particular model expects for reference
 * images — Qwen wants "the person in image 1", others want something else.
 */
(function (SB) {
  'use strict';

  /* How a model wants to be told about reference images. {{N}} = the image's
   * position, {{NAME}} = the persona's name. */
  const REF_TEMPLATES = {
    numbered: 'Reference images are supplied in order. Refer to each recurring subject as ' +
      '"the person in image {{N}}" and keep their face, hair and wardrobe exactly as in that image.',
    named: 'Reference images are supplied for each named subject. Refer to them by name ' +
      '({{NAME}}) and keep their face, hair and wardrobe exactly as in the reference.',
    none: ''
  };

  const DEFAULT_REF_TEMPLATE = REF_TEMPLATES.numbered;

  function newPersona(opts) {
    opts = opts || {};
    return {
      id: SB.uid('per'),
      name: opts.name || 'New persona',
      description: opts.description || '',
      imagePrompt: opts.imagePrompt || '',
      image: opts.image || null      // {data,w,h} — the reference frame
    };
  }

  function all(p) { return (p.personas = p.personas || []); }

  function find(p, id) {
    return all(p).filter(function (x) { return x.id === id; })[0] || null;
  }

  function add(p, opts) {
    const per = newPersona(opts);
    all(p).push(per);
    return per;
  }

  function remove(p, id) {
    p.personas = all(p).filter(function (x) { return x.id !== id; });
    SB.Model.eachShot(p, function (sh) {
      sh.personaIds = (sh.personaIds || []).filter(function (x) { return x !== id; });
    });
  }

  /* The personas in a shot, in the order their reference images should be fed. */
  function forShot(p, shot) {
    return (shot.personaIds || []).map(function (id) { return find(p, id); })
      .filter(Boolean);
  }

  function toggleOnShot(p, shot, id) {
    shot.personaIds = shot.personaIds || [];
    const i = shot.personaIds.indexOf(id);
    if (i >= 0) shot.personaIds.splice(i, 1);
    else shot.personaIds.push(id);
  }

  /* The CAST block appended to the system instruction for one job. */
  function block(p, shot, model) {
    const cast = forShot(p, shot);
    if (!cast.length) return '';
    const lines = ['CAST — these people recur across the board. They must look the same every time.'];
    const withImages = cast.filter(function (x) { return !!x.image; });

    cast.forEach(function (per, i) {
      const bits = [];
      bits.push((per.image ? 'image ' + (withImages.indexOf(per) + 1) + ' — ' : '') + (per.name || 'unnamed'));
      const d = (per.description || '').replace(/\s+/g, ' ').trim();
      bits.push(d || '(no description yet)');
      lines.push('  ' + (i + 1) + '. ' + bits.join(': '));
      if (!per.image) {
        lines.push('     No reference image — describe this person fully and identically every time.');
      }
    });

    if (withImages.length) {
      const tpl = (model && model.referenceTemplate) || DEFAULT_REF_TEMPLATE;
      const names = withImages.map(function (x) { return x.name; }).join(', ');
      lines.push(tpl.replace(/\{\{N\}\}/g, function () { return 'N'; })
        .replace(/\{\{NAME\}\}/g, names));
      withImages.forEach(function (per, i) {
        lines.push('  image ' + (i + 1) + ' = ' + (per.name || 'unnamed'));
      });
    }
    lines.push('Wardrobe stays identical to the description above unless the shot says otherwise.');
    return lines.join('\n');
  }

  /* ---- generate personas from the brand + the master script ---- */

  const GEN_SCHEMA = {
    type: 'OBJECT',
    properties: {
      personas: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            description: { type: 'STRING' },
            imagePrompt: { type: 'STRING' }
          },
          required: ['name', 'description', 'imagePrompt']
        }
      }
    },
    required: ['personas']
  };

  function generate(p, count, extraNote) {
    const script = (p.master.text || '').trim();
    const descs = [];
    SB.Model.eachShot(p, function (sh) {
      if (sh.description) descs.push(sh.description);
    });
    if (!script && !descs.length) {
      return Promise.reject(new Error('Nothing to work from yet — write some script or shot descriptions first.'));
    }

    const model = SB.Model.imageModel(p);
    const text = [
      'Read the script below and invent ' + count + ' recurring on-camera ' +
      (count === 1 ? 'person' : 'people') + ' for this video.',
      '',
      'For each one return:',
      '- name: a short label for the board (not a character name in the script — a handle like "Ops lead").',
      '- description: who they are on camera and, critically, exactly what they look like and are WEARING. ' +
      'Age range, build, hair, skin tone, and a specific outfit described down to fabric and colour. ' +
      'This text is what keeps them identical from shot to shot, so be concrete and complete. No gendered language.',
      '- imagePrompt: a single still-image prompt that would produce a clean, front-facing reference frame of ' +
      'this person for ' + (model ? model.name : 'an image model') + ' — plain background, natural light, ' +
      'full wardrobe visible, neutral expression. It must obey the house style.',
      '',
      extraNote ? 'Additional direction: ' + extraNote + '\n' : '',
      script ? 'SCRIPT:\n' + script.slice(0, 12000) : '',
      descs.length ? '\n\nSHOT DESCRIPTIONS:\n- ' + descs.slice(0, 40).join('\n- ') : ''
    ].join('\n');

    const system = SB.Brand.brandOf(p).enabled
      ? 'HOUSE STYLE — the reference frames you describe must obey this.\n\n' + SB.Brand.brandOf(p).text
      : '';

    return SB.Prompts.raw(text, GEN_SCHEMA, system).then(function (out) {
      const made = (out.personas || []).map(function (x) {
        return add(p, {
          name: x.name, description: x.description, imagePrompt: x.imagePrompt
        });
      });
      if (!made.length) throw new Error('No personas came back');
      return made;
    });
  }

  SB.Personas = {
    REF_TEMPLATES: REF_TEMPLATES,
    DEFAULT_REF_TEMPLATE: DEFAULT_REF_TEMPLATE,
    newPersona: newPersona, all: all, find: find, add: add, remove: remove,
    forShot: forShot, toggleOnShot: toggleOnShot, block: block, generate: generate
  };

})(window.SB);
