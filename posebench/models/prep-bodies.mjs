// Builds posebench/bodies.js from the Sketchfab "Human Models Set - Male/Female (Rigged)" glTF (CC-BY-4.0, lzyassoul).
// The set's high-detail meshes carry no rig; the low-detail ones do, in the same pose. So: the rigged mesh is fitted
// onto the high one, each high vertex takes its skin weights from the nearest rigged vertices, and the result is
// welded (smooth normals), trimmed to the bones Pose Bench drives and packed compactly.
//   node models/prep-bodies.mjs [--dump]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'sketchfab');
const g = JSON.parse(fs.readFileSync(path.join(SRC, 'scene.gltf'), 'utf8'));
const bin = fs.readFileSync(path.join(SRC, g.buffers[0].uri));

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
function read(ai) {
  const a = g.accessors[ai], bv = g.bufferViews[a.bufferView], T = CT[a.componentType], n = NC[a.type];
  const stride = bv.byteStride || T.BYTES_PER_ELEMENT * n, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new Float64Array(a.count * n), dv = new DataView(bin.buffer, bin.byteOffset);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let i = 0; i < a.count; i++) for (let k = 0; k < n; k++) {
    let v = dv[get](base + i * stride + k * T.BYTES_PER_ELEMENT, true);
    if (a.normalized) v = a.componentType === 5121 ? v / 255 : a.componentType === 5123 ? v / 65535 : v;
    out[i * n + k] = v;
  }
  return out;
}
function meshData(mi) {
  const P = [], I = [], J = [], W = []; let off = 0;
  for (const pr of g.meshes[mi].primitives) {
    const p = read(pr.attributes.POSITION), c = p.length / 3;
    for (const v of p) P.push(v);
    if (pr.attributes.JOINTS_0 !== undefined) { for (const v of read(pr.attributes.JOINTS_0)) J.push(v); for (const v of read(pr.attributes.WEIGHTS_0)) W.push(v); }
    const idx = pr.indices !== undefined ? read(pr.indices) : Array.from({ length: c }, (_, i) => i);
    for (const v of idx) I.push(v + off);
    off += c;
  }
  return { P, I, J, W };
}
// 4x4 column-major helpers
const inv4 = m => {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
    b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
    b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [(a11 * b11 - a12 * b10 + a13 * b09) * d, (a02 * b10 - a01 * b11 - a03 * b09) * d, (a31 * b05 - a32 * b04 + a33 * b03) * d, (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d, (a00 * b11 - a02 * b08 + a03 * b07) * d, (a32 * b02 - a30 * b05 - a33 * b01) * d, (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d, (a01 * b08 - a00 * b10 - a03 * b06) * d, (a30 * b04 - a31 * b02 + a33 * b00) * d, (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d, (a00 * b09 - a01 * b07 + a02 * b06) * d, (a31 * b01 - a30 * b03 - a32 * b00) * d, (a20 * b03 - a21 * b01 + a22 * b00) * d];
};
const bbox = P => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); } return { mn, mx }; };

/* ---- which bone each Rigify bone's weight goes to: the bones Pose Bench drives, plus the fingers ---- */
const KEEP = ['spine', 'spine.001', 'spine.002', 'spine.003', 'spine.004', 'spine.005', 'spine.006',
  ...['L', 'R'].flatMap(s => ['shoulder', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe'].map(b => b + '.' + s)),
  ...['L', 'R'].flatMap(s => ['thumb', 'f_index', 'f_middle', 'f_ring', 'f_pinky'].flatMap(f => ['01', '02', '03'].map(k => f + '.' + k + '.' + s)))];

/* Weights from the skeleton alone, for a body whose own skin is broken (the male's: its left-thigh weights sit on
   the right leg, its toe bones take half the shin). Each bone is a segment from its head to the next bone's head;
   a vertex goes to the nearest segments, blended by distance, and only to bones on its own side of the body — so an
   inner thigh never follows the other leg and a hand resting on a hip never follows the pelvis. */
const TAIL = n => {
  const m = n.match(/^(thumb|f_\w+)\.0(\d)\.(L|R)$/); if (m) return +m[2] < 3 ? m[1] + '.0' + (+m[2] + 1) + '.' + m[3] : null;
  const S = n.slice(-2);
  return ({ 'spine': 'spine.001', 'spine.001': 'spine.002', 'spine.002': 'spine.003', 'spine.003': 'spine.004', 'spine.004': 'spine.005', 'spine.005': 'spine.006' })[n] ||
    ({ shoulder: 'upper_arm', upper_arm: 'forearm', forearm: 'hand', hand: 'f_middle.01', thigh: 'shin', shin: 'foot', foot: 'toe' })[n.slice(0, -2)] + (n.endsWith(S) && /\.(L|R)$/.test(n) ? S : '');
};
function autoWeights(HP, bones, SJ, SW) {
  const ix = Object.fromEntries(bones.map((b, i) => [b.name, i])), mid = bones[ix['spine']].head[0];
  const seg = bones.map(b => {
    const t = TAIL(b.name), ti = t && ix[t] !== undefined ? ix[t] : -1;
    let tail;
    if (ti >= 0) tail = bones[ti].head;
    else { // the ends (head, toes, fingertips): along the bone for a sensible length
      const L = b.name === 'spine.006' ? 0.1 : b.name.startsWith('toe') ? 0.05 : b.name.startsWith('thumb') ? 0.014 : 0.012;   // of body height (~3.5 units)
      tail = b.head.map((v, k) => v + b.y[k] * L * 3.5);
    }
    const side = /\.L$/.test(b.name) ? 1 : /\.R$/.test(b.name) ? -1 : 0;
    const limb = /^(upper_arm|forearm|hand|thumb|f_|thigh|shin|foot|toe)/.test(b.name);
    return { a: b.head, b: tail, side, limb };
  });
  const dist = (p, s) => {
    const ab = [0, 1, 2].map(k => s.b[k] - s.a[k]), ap = [0, 1, 2].map(k => p[k] - s.a[k]);
    const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, t = L2 > 0 ? Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2)) : 0;
    return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
  };
  for (let v = 0; v < HP.length / 3; v++) {
    const p = [HP[v * 3], HP[v * 3 + 1], HP[v * 3 + 2]], sx = Math.sign(p[0] - mid);
    const d = seg.map((s, i) => [s.limb && s.side && s.side !== sx ? Infinity : dist(p, s), i]).sort((x, y) => x[0] - y[0]);
    const d0 = Math.max(d[0][0], 1e-4), near = d.filter(x => x[0] < d0 * 1.5 + 0.004).slice(0, 4);
    const ws = near.map(([dd]) => 1 / Math.max(dd, 1e-4) ** 6), tot = ws.reduce((a, b) => a + b, 0);
    let q = near.map(([, i], k) => [i, Math.round(ws[k] / tot * 255)]).filter(x => x[1] > 0);
    const drift = 255 - q.reduce((t, x) => t + x[1], 0); q[0][1] += drift;
    q.forEach(([t, w], k) => { SJ[v * 4 + k] = t; SW[v * 4 + k] = w; });
  }
}

function body(skinMi, skinIx, lowMi, highMis, opts = {}) {
  const low = meshData(skinMi), skin = g.skins[skinIx];
  const names = skin.joints.map(j => (g.nodes[j].name || '').replace(/_\d+$/, ''));
  const ibm = read(skin.inverseBindMatrices), B = names.map((_, i) => inv4(Array.from(ibm.slice(i * 16, i * 16 + 16))));
  // parent (within the skin) of each joint
  const nodeToJ = new Map(skin.joints.map((n, i) => [n, i])), parent = names.map(() => -1);
  skin.joints.forEach((n, i) => (g.nodes[n].children || []).forEach(c => { if (nodeToJ.has(c)) parent[nodeToJ.get(c)] = i; }));
  // each joint's weight goes to its nearest kept ancestor (palms -> hand, face -> head, breasts -> chest)
  const keepIx = KEEP.map(k => names.indexOf(k)); if (keepIx.includes(-1)) throw new Error('missing bone ' + KEEP[keepIx.indexOf(-1)]);
  const to = names.map((_, i) => { let k = i; while (k >= 0 && !KEEP.includes(names[k])) k = parent[k]; return k < 0 ? keepIx[0] : KEEP.indexOf(names[k]); });

  // fit the rigged mesh onto the unrigged one of the same density (a scale + shift: the set lays them out apart)
  const ref = meshData(lowMi), a = bbox(low.P), b = bbox(ref.P);
  const s = (b.mx[1] - b.mn[1]) / (a.mx[1] - a.mn[1]), sh = [0, 1, 2].map(k => (b.mn[k] + b.mx[k]) / 2 - s * (a.mn[k] + a.mx[k]) / 2);
  const fit = p => [p[0] * s + sh[0], p[1] * s + sh[1], p[2] * s + sh[2]];
  const LP = []; for (let i = 0; i < low.P.length; i += 3) LP.push(...fit([low.P[i], low.P[i + 1], low.P[i + 2]]));
  // bones in the same space: head position and the bone's own axes (x, y along the bone, z), unscaled
  const bones = KEEP.map((k, ki) => {
    const m = B[keepIx[ki]], ax = c => { const v = [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]], L = Math.hypot(...v); return v.map(x => x / L); };
    return { name: k, head: fit([m[12], m[13], m[14]]), x: ax(0), y: ax(1), z: ax(2) };
  });
  bones.forEach((bn, i) => { const pn = KEEP.indexOf(names[(() => { let k = parent[keepIx[i]]; while (k >= 0 && !KEEP.includes(names[k])) k = parent[k]; return k; })()]); bn.parent = pn; });
  // low vertex -> kept-bone weights
  const lowW = []; for (let v = 0; v < low.P.length / 3; v++) { const w = {}; for (let k = 0; k < 4; k++) { const wt = low.W[v * 4 + k]; if (wt > 0) { const t = to[low.J[v * 4 + k]]; w[t] = (w[t] || 0) + wt; } } lowW.push(w); }

  // the high mesh(es), welded
  const HP = [], HI = []; const key = new Map();
  for (const mi of highMis) {
    const m = meshData(mi), remap = [];
    for (let i = 0; i < m.P.length; i += 3) {
      const k = [m.P[i], m.P[i + 1], m.P[i + 2]].map(v => Math.round(v * 4e3)).join(',');   // ~1/14000 of the height: joins the seams a finer weld left open
      if (!key.has(k)) { key.set(k, HP.length / 3); HP.push(m.P[i], m.P[i + 1], m.P[i + 2]); }
      remap.push(key.get(k));
    }
    for (let i = 0; i < m.I.length; i += 3) { const t = [remap[m.I[i]], remap[m.I[i + 1]], remap[m.I[i + 2]]]; if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) HI.push(...t); }
  }
  const nv = HP.length / 3, SJ = new Uint8Array(nv * 4), SW = new Uint8Array(nv * 4);
  if (opts.auto) autoWeights(HP, bones, SJ, SW);
  else transfer();
  function transfer() {
  // weights: inverse-distance blend of the 4 nearest rigged vertices (a grid keeps it quick)
  const cell = 0.04, grid = new Map(), ck = (x, y, z) => x + ',' + y + ',' + z;
  for (let v = 0; v < LP.length / 3; v++) { const c = ck(...[0, 1, 2].map(k => Math.floor(LP[v * 3 + k] / cell))); if (!grid.has(c)) grid.set(c, []); grid.get(c).push(v); }
  for (let v = 0; v < nv; v++) {
    const p = [HP[v * 3], HP[v * 3 + 1], HP[v * 3 + 2]], c = p.map(x => Math.floor(x / cell)); let best = [];
    for (let r = 1; best.length < 4 && r < 20; r++) {
      best = [];
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const l = grid.get(ck(c[0] + dx, c[1] + dy, c[2] + dz)); if (!l) continue;
        for (const u of l) best.push([Math.hypot(LP[u * 3] - p[0], LP[u * 3 + 1] - p[1], LP[u * 3 + 2] - p[2]), u]);
      }
    }
    best.sort((x, y) => x[0] - y[0]); best = best.slice(0, 4);
    const acc = {}; let tot = 0;
    for (const [d, u] of best) { const iw = 1 / (d + 1e-4) ** 2; for (const t in lowW[u]) { acc[t] = (acc[t] || 0) + lowW[u][t] * iw; } tot += iw; }
    const top = Object.entries(acc).sort((x, y) => y[1] - x[1]).slice(0, 4), sum = top.reduce((t, x) => t + x[1], 0);
    let q = top.map(([t, w]) => [+t, Math.round(w / sum * 255)]); const drift = 255 - q.reduce((t, x) => t + x[1], 0); q[0][1] += drift;
    q.forEach(([t, w], k) => { SJ[v * 4 + k] = t; SW[v * 4 + k] = w; });
  }
  }
  // normalise: feet at 0, height 1, centred on the hips (x) and the ankles (z)
  const hb = bbox(HP), H = hb.mx[1] - hb.mn[1], hip = bones[0].head;
  const ox = hip[0], oy = hb.mn[1], oz = (bones[KEEP.indexOf('foot.L')].head[2] + bones[KEEP.indexOf('foot.R')].head[2]) / 2;
  const N = p => [(p[0] - ox) / H, (p[1] - oy) / H, (p[2] - oz) / H];
  for (let i = 0; i < HP.length; i += 3) { const q = N([HP[i], HP[i + 1], HP[i + 2]]); HP[i] = q[0]; HP[i + 1] = q[1]; HP[i + 2] = q[2]; }
  bones.forEach(bn => { bn.head = N(bn.head).map(v => +v.toFixed(5)); ['x', 'y', 'z'].forEach(k => { bn[k] = bn[k].map(v => +v.toFixed(5)); }); });
  /* Face winding: the male mesh mixes inward- and outward-wound faces (dark bands in any render, torn smooth
     normals). Each face is turned to point away from its main bone's axis (a line through the bone's head along
     its length), which is outward everywhere on a body. Duplicate faces (the same three vertices, either winding)
     are dropped, so no inner shell z-fights with the outer one. */
  const seen = new Set(), OI = []; let flipped = 0, dup = 0;
  for (let t = 0; t < HI.length; t += 3) {
    const [a, b2, c] = [HI[t], HI[t + 1], HI[t + 2]], k = [a, b2, c].sort((x, y) => x - y).join(',');
    if (seen.has(k)) { dup++; continue; } seen.add(k);
    const V = i => [HP[i * 3], HP[i * 3 + 1], HP[i * 3 + 2]], A = V(a), Bv = V(b2), C = V(c);
    const u = [0, 1, 2].map(i => Bv[i] - A[i]), w = [0, 1, 2].map(i => C[i] - A[i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const cen = [0, 1, 2].map(i => (A[i] + Bv[i] + C[i]) / 3);
    // main bone of the face: the heaviest total weight over its three vertices
    const tot = {}; for (const v of [a, b2, c]) for (let q = 0; q < 4; q++) tot[SJ[v * 4 + q]] = (tot[SJ[v * 4 + q]] || 0) + SW[v * 4 + q];
    const bn = bones[+Object.entries(tot).sort((x, y) => y[1] - x[1])[0][0]];
    const d = cen.map((x, i) => x - bn.head[i]), along = d[0] * bn.y[0] + d[1] * bn.y[1] + d[2] * bn.y[2];
    const out = d.map((x, i) => x - along * bn.y[i]);
    if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) { OI.push(a, c, b2); flipped++; } else OI.push(a, b2, c);
  }
  /* The per-face test is right almost everywhere but not in folds (armpits, shoulder tops), where a face can lean
     toward another bone's axis. So the winding is then made consistent across each connected piece of the surface
     — neighbours sharing an edge must run it opposite ways — and each piece takes the majority's side. */
  {
    const nf = OI.length / 3, ekey = (a, b) => a < b ? a + '_' + b : b + '_' + a, edges = new Map();
    for (let f = 0; f < nf; f++) for (let e = 0; e < 3; e++) { const a = OI[f * 3 + e], b = OI[f * 3 + (e + 1) % 3], k = ekey(a, b); if (!edges.has(k)) edges.set(k, []); edges.get(k).push(f); }
    const out0 = new Uint8Array(nf); // 1 = the per-face test said this winding is outward (after its flip, all are)
    const flip = new Int8Array(nf).fill(-1); let pieces = 0, reflipped = 0;
    const dir = (f, a, b) => { for (let e = 0; e < 3; e++) if (OI[f * 3 + e] === a && OI[f * 3 + (e + 1) % 3] === b) return 1; return 0; };
    for (let s = 0; s < nf; s++) {
      if (flip[s] >= 0) continue; pieces++;
      const comp = [s]; flip[s] = 0; let votes = 0;
      for (let qi = 0; qi < comp.length; qi++) {
        const f = comp[qi];
        votes += flip[f] ? -1 : 1;             // agrees with the per-face test when not flipped
        for (let e = 0; e < 3; e++) {
          const a = OI[f * 3 + e], b = OI[f * 3 + (e + 1) % 3], l = edges.get(ekey(a, b)); if (l.length !== 2) continue;
          const g2 = l[0] === f ? l[1] : l[0]; if (flip[g2] >= 0) continue;
          // f (as flipped) runs a->b when flip[f]==0; the neighbour must run b->a
          const fRunsAB = flip[f] === 0, gRunsAB = !!dir(g2, a, b);
          flip[g2] = (fRunsAB === gRunsAB) ? 1 : 0; comp.push(g2);
        }
      }
      const invert = votes < 0;
      for (const f of comp) { let fl = flip[f]; if (invert) fl = fl ? 0 : 1; if (fl) { const t = OI[f * 3 + 1]; OI[f * 3 + 1] = OI[f * 3 + 2]; OI[f * 3 + 2] = t; reflipped++; } }
    }
    if (process.argv.includes('--dump')) console.log('winding: pieces', pieces, 'faces re-turned for consistency', reflipped);
  }
  if (process.argv.includes('--dump')) console.log('faces flipped', flipped, 'duplicates dropped', dup);
  return { HP, HI: OI, SJ, SW, bones, tris: OI.length / 3, verts: nv };
}

const bodies = { male: body(0, 0, 1, [5, 6], { auto: true }), female: body(2, 1, 3, [4]) };
templateWeights(bodies.male, bodies.female);
for (const b of Object.values(bodies)) smoothWeights(b, 6);

/* Weights smoothed over the surface: each pass, a vertex moves half way to its neighbours' average. Removes the
   stair-steps a nearest-vertex copy leaves (the shoulder tops tore into thin cracks when posed). Top four kept. */
function smoothWeights(B, iters) {
  const nv = B.HP.length / 3, nb = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < B.HI.length; t += 3) for (let e = 0; e < 3; e++) { const a = B.HI[t + e], c = B.HI[t + (e + 1) % 3]; nb[a].add(c); nb[c].add(a); }
  let W = Array.from({ length: nv }, (_, v) => { const m = new Map(); for (let k = 0; k < 4; k++) if (B.SW[v * 4 + k]) m.set(B.SJ[v * 4 + k], (m.get(B.SJ[v * 4 + k]) || 0) + B.SW[v * 4 + k] / 255); return m; });
  for (let it = 0; it < iters; it++) {
    W = W.map((m, v) => {
      if (!nb[v].size) return m;
      const o = new Map(); for (const [j, w] of m) o.set(j, w * 0.5);
      const k = 0.5 / nb[v].size; for (const u of nb[v]) for (const [j, w] of W[u]) o.set(j, (o.get(j) || 0) + w * k);
      return o;
    });
  }
  for (let v = 0; v < nv; v++) {
    const top = [...W[v]].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((t, x) => t + x[1], 0);
    const q = top.map(([j, w]) => [j, Math.round(w / sum * 255)]); q[0][1] += 255 - q.reduce((t, x) => t + x[1], 0);
    for (let k = 0; k < 4; k++) { B.SJ[v * 4 + k] = q[k] ? q[k][0] : 0; B.SW[v * 4 + k] = q[k] ? q[k][1] : 0; }
  }
}

/* The nearest-bone weights get the limbs right but not the places an artist fixes by hand: the upper arm grabs the
   side of the chest, the thigh the lower belly. The female body's own weights are good there, and the two share one
   skeleton. So each male vertex is carried into the female body through its main bone (the bone's head to head,
   turned from the male bone's direction to the female's, scaled by the two bones' lengths) and takes the weights
   of the nearest female vertex. Near a joint both neighbouring bones land it in the same place, so the result
   doesn't hinge on which bone the first pass picked. */
function templateWeights(M, F) {
  const qFrom = (a, b) => { // unit quaternion turning unit vector a onto b
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (d < -0.999999) return [1, 0, 0, 0];
    const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], w = 1 + d, L = Math.hypot(c[0], c[1], c[2], w);
    return [c[0] / L, c[1] / L, c[2] / L, w / L];
  };
  const rot = (q, v) => { const [x, y, z, w] = q, u = [x, y, z];
    const t = [2 * (u[1] * v[2] - u[2] * v[1]), 2 * (u[2] * v[0] - u[0] * v[2]), 2 * (u[0] * v[1] - u[1] * v[0])];
    return [v[0] + w * t[0] + (u[1] * t[2] - u[2] * t[1]), v[1] + w * t[1] + (u[2] * t[0] - u[0] * t[2]), v[2] + w * t[2] + (u[0] * t[1] - u[1] * t[0])]; };
  const ixM = Object.fromEntries(M.bones.map((b, i) => [b.name, i]));
  const len = (B, n) => { const t = TAIL(n), j = B.bones.findIndex(b => b.name === t); if (j < 0) return 0; const a = B.bones.find(b => b.name === n).head, c = B.bones[j].head; return Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]); };
  const map = M.bones.map((bm, i) => {
    const bf = F.bones[i], lm = len(M, bm.name), lf = len(F, bm.name);
    return { hm: bm.head, hf: bf.head, q: qFrom(bm.y, bf.y), s: lm > 0 && lf > 0 ? lf / lm : 1 };
  });
  // female vertices in a grid
  const cell = 0.012, grid = new Map(), ck = (a, b, c) => a + ',' + b + ',' + c, FP = F.HP;
  for (let v = 0; v < FP.length / 3; v++) { const k = ck(...[0, 1, 2].map(i => Math.floor(FP[v * 3 + i] / cell))); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(v); }
  const nearest = p => {
    const c = p.map(x => Math.floor(x / cell));
    for (let r = 1; r < 40; r++) { let best = null;
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const l = grid.get(ck(c[0] + dx, c[1] + dy, c[2] + dz)); if (!l) continue;
        for (const u of l) { const d = Math.hypot(FP[u * 3] - p[0], FP[u * 3 + 1] - p[1], FP[u * 3 + 2] - p[2]); if (!best || d < best[0]) best = [d, u]; } }
      if (best) return best[1]; }
    return -1;
  };
  let kept = 0;
  for (let v = 0; v < M.HP.length / 3; v++) {
    let b = 0; for (let k = 1; k < 4; k++) if (M.SW[v * 4 + k] > M.SW[v * 4 + b]) b = k;
    const bi = M.SJ[v * 4 + b], m = map[bi], name = M.bones[bi].name;
    if (/^(thumb|f_)/.test(name)) { kept++; continue; }       // male fingers are separate; female ones are not — keep the nearest-bone fingers
    const p = [M.HP[v * 3] - m.hm[0], M.HP[v * 3 + 1] - m.hm[1], M.HP[v * 3 + 2] - m.hm[2]];
    const r = rot(m.q, p), pf = [m.hf[0] + r[0] * m.s, m.hf[1] + r[1] * m.s, m.hf[2] + r[2] * m.s];
    const u = nearest(pf); if (u < 0) continue;
    for (let k = 0; k < 4; k++) { M.SJ[v * 4 + k] = F.SJ[u * 4 + k]; M.SW[v * 4 + k] = F.SW[u * 4 + k]; }
  }
  if (process.argv.includes('--dump')) console.log('template weights: kept own finger weights on', kept, 'vertices');
}
if (process.argv.includes('--dump')) {
  for (const [k, b] of Object.entries(bodies)) {
    console.log(k, 'verts', b.verts, 'tris', b.tris);
    b.bones.slice(0, 23).forEach(bn => console.log('  ', bn.name.padEnd(12), 'head', bn.head.map(v => v.toFixed(3)).join(' '), ' y', bn.y.map(v => v.toFixed(2)).join(' '), ' x', bn.x.map(v => v.toFixed(2)).join(' '), ' parent', bn.parent));
  }
}
// pack: positions int16 over [-1,1] (normalised units, height 1), indices uint16/32, joints + weights uint8
const b64 = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
const out = {};
for (const [k, b] of Object.entries(bodies)) {
  const P = new Int16Array(b.HP.length); b.HP.forEach((v, i) => { P[i] = Math.round(v * 32767); });
  const I = b.verts < 65536 ? new Uint16Array(b.HI) : new Uint32Array(b.HI);
  out[k] = { bones: b.bones, pos: b64(P), idx: b64(I), idx32: !(I instanceof Uint16Array), sj: b64(b.SJ), sw: b64(b.SW) };
}
const js = `/* Pose Bench bodies — generated by models/prep-bodies.mjs; do not edit.
 * Based on "Human Models Set - Male/Female (Rigged)" (https://sketchfab.com/3d-models/human-models-set-malefemale-rigged-7311fcfdc03e4234900eeced42a1e669)
 * by lzyassoul (https://sketchfab.com/lzyassoul), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Re-rigged weights and packing ours. */
window.PB_BODIES=${JSON.stringify(out)};
`;
fs.writeFileSync(path.join(here, '..', 'bodies.js'), js);
console.log('wrote bodies.js', (js.length / 1024).toFixed(0), 'KB');
