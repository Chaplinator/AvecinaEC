// Simulacion Monte Carlo v2 de umbrales de confirmacion (CLAUDE.md §7, §8, §10, §12).
// Solo especificacion/cuantificacion: no toca la app. Sin dependencias nuevas (usa h3-js).
// Uso: node scripts/sim/umbrales.mjs [--trials 300] [--atk-trials 100] [--ret-trials 600] [--seed N] [--full]
//
// LO MEDIDO sale de ejecutar este script. LO SUPUESTO esta en el bloque SUPUESTOS.
// Comparacion pareada: en cada repeticion TODAS las reglas ven exactamente el mismo mundo (mismos usuarios,
// mismos retrasos, mismas respuestas); no se consume azar dentro de la evaluacion de una regla.
import { latLngToCell, gridDisk, gridDistance, cellToParent, cellToChildren } from 'h3-js';

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const TRIALS = argVal('--trials', 300);
const ATK_TRIALS = argVal('--atk-trials', 100);
const RET_TRIALS = argVal('--ret-trials', 600);
const SEED = argVal('--seed', 20261026);
const FULL = args.includes('--full');

// ---------- SUPUESTOS (no medidos; ver docs/specs/incidentes-umbrales.md §8.1) ----------
const POP_CELL = 5000;        // personas por celda res 8
const P_HOME = 0.7;           // fraccion de usuarios en casa durante el corte
const MEAN_REPORT = 8;        // min: retraso medio (exponencial) del reporte espontaneo
const MEAN_ANSWER = 5;        // min: retraso medio de respuesta a la pregunta push
const P_MOBILE = 0.6;         // fraccion de usuarios en datos moviles durante el corte (comparten /24)
const NEW_FRAC = 0.10;        // usuarios honestos con cuenta de menos de 24 h, ademas de los veteranos
const HORIZON = 120;          // min simulados
const IPS_PER_NET = 8;        // IP publicas de salida por /24 movil (solo para el limite de altas por IP)
// ---------- PARAMETROS del producto (CLAUDE.md §7 + decisiones aprobadas) ----------
const SUSPECT_WIN = 15, SUSPECT_MIN = 2, K = 3, RATIO = 0.6, ASK_MAX = 40;
const ADOPT_MIN = 0.01;       // adoption_min_pct = 1 %
const NIGHT_PERSONS = 5, NIGHT_ANCHORS = 2;   // regla de noche: 5 personas o 2 anclas
const RING_NO_W = 0.5;
const BUCKET = 5;             // cubo de publicacion (min)
const RET_RATIO = 0.4, RET_WAVE_FIRST = 30, RET_WAVE_EVERY = 60, RET_SPAN = 720;
const TAUS = [15, 30, 60, 120];

const BASE = { scope: 'disk', win: 60, expire: 45, def: false };
const F = { ...BASE, parent: true, anchor: true, noRingW: RING_NO_W, minWait: 5, ageFilter: true, expire: 60,
  bucket: BUCKET, askDelay: true, gate: true, night: 'or', def: true };
const RULES = {
  a: { ...BASE, label: 'original (celda, 15 min)', scope: 'cell', win: 15 },
  b: { ...BASE, label: '+vecinas', win: 15 },
  c: { ...BASE, label: '+vecinas +60 min' },
  d: { ...BASE, label: '+res7', parent: true },
  e: { ...BASE, label: '+protecciones (v1: muestreo propio primero, sin edad de cuenta)', parent: true, anchor: true, ownFrac: 1, noRingW: RING_NO_W, minWait: 5 },
  f: { ...F, label: 'v2 final (todo lo aprobado)' },
  fn: { ...F, label: 'f sin compuerta de adopcion minima', gate: false },
  fx: { ...F, label: 'f sin deduplicacion por red', def: false },
  g: { ...F, label: 'f con sospechado a 45 min', expire: 45 },
  h: { ...F, label: 'f con preguntas primero a la celda propia (reparto observable)', ownFrac: 1 },
  hn: { ...F, label: 'h sin compuerta de adopcion', ownFrac: 1, gate: false },
  w: { ...F, label: 'f con la mitad de las preguntas a la celda propia', ownFrac: 0.5 },
  wn: { ...F, label: 'w sin compuerta de adopcion', ownFrac: 0.5, gate: false },
  fd: { ...F, label: 'f con la regla de dia tambien de noche', night: null },
  fs: { ...F, label: 'f con noche estricta (5 personas Y 2 anclas)', night: 'and' },
  fs8: { ...F, label: 'f con noche muy estricta (8 personas Y 2 anclas)', night: 'and', nightP: 8 },
};
const MAIN = ['a', 'b', 'c', 'd', 'e', 'f', 'fn'];
const VARS = ['f', 'g', 'h', 'w', 'fd', 'fs', 'fx'];
const ALL = [...MAIN, 'g', 'h', 'w', 'fd', 'fs', 'fx'];

// ---------- utilidades ----------
let _s = SEED;
const setSeed = (x) => { _s = x | 0; };
const rng = () => { _s = (_s + 0x6D2B79F5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const seedFor = (...p) => { let h = (2166136261 ^ SEED) | 0; for (const x of p) { h = Math.imul(h ^ (Math.round(x * 1000) | 0), 16777619); h ^= h >>> 13; } return h >>> 0; };
const normal = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const expo = (mean) => -mean * Math.log(1 - rng());

const CENTER = latLngToCell(-2.1500, -79.9000, 8);
const diskCache = new Map(), diskSetCache = new Map(), uniCache = new Map(), kidsCache = new Map();
const diskOf = (c) => { let d = diskCache.get(c); if (!d) { d = gridDisk(c, 1); diskCache.set(c, d); diskSetCache.set(c, new Set(d)); } return d; };
const diskSetOf = (c) => { diskOf(c); return diskSetCache.get(c); };
const kidsOf = (c) => { const p = cellToParent(c, 7); let k = kidsCache.get(p); if (!k) { k = new Set(cellToChildren(p, 8)); kidsCache.set(p, k); } return k; };
const uniOf = (c) => { let u = uniCache.get(c); if (!u) { u = [...new Set([...diskOf(c), ...kidsOf(c)])]; uniCache.set(c, u); } return u; };

let UID = 0;
function genWorld(cells, o) {
  const byCell = new Map(), reps = new Map();
  for (const cell of cells) {
    const mean = POP_CELL * o.adopt * (o.share ?? 1);
    const nVet = Math.max(0, Math.round(mean + Math.sqrt(mean) * normal()));
    const nNew = Math.round(nVet * NEW_FRAC);
    const aff0 = o.aff ? o.aff.has(cell) : false;
    const arr = [], rr = [];
    for (let i = 0; i < nVet + nNew; i++) {
      const id = UID++;
      const home = rng() < P_HOME, affR = rng(), repU = rng(), repT = expo(o.meanRep ?? MEAN_REPORT);
      const mob = rng() < (o.pMobile ?? P_MOBILE), nid = Math.floor(rng() * (o.netPool ?? 200));
      const aff = aff0 && affR < (o.pAff ?? 1);
      const u = { id, cell, aff, home, fake: false, hoard: false, old: i < nVet, net: mob ? 'M' + nid : 'H' + id,
        reportT: aff && home && repU < (o.r ?? 0) ? repT : Infinity,
        askRank: rng(), respU: rng(), respU2: rng(), delay: expo(o.meanAns ?? MEAN_ANSWER), delay2: expo(o.meanAns ?? MEAN_ANSWER), pdelay: rng() * 2,
        wrong: rng() < (o.err ?? 0) };
      arr.push(u); if (u.reportT < Infinity) rr.push(u);
    }
    byCell.set(cell, arr); reps.set(cell, rr);
  }
  return { byCell, reps, adoptCounted: o.adoptCounted ?? o.adopt };
}
function addUsers(W, list) {
  for (const u of list) {
    if (!W.byCell.has(u.cell)) { W.byCell.set(u.cell, []); W.reps.set(u.cell, []); }
    W.byCell.get(u.cell).push(u); if (u.reportT < Infinity) W.reps.get(u.cell).push(u);
  }
}
const mkFake = (cell, i, nets, aged) => ({ id: UID++, cell, aff: false, home: true, fake: true, hoard: false, old: aged,
  net: nets === 0 ? 'X' + i : 'F' + (i % nets), reportT: rng() * 5, askRank: rng(), respU: 1, respU2: 1, delay: 0, delay2: 0, pdelay: 0, wrong: false });
const mkHoard = (cell, i, nNets, aged) => ({ id: UID++, cell, aff: false, home: true, fake: false, hoard: true, old: aged,
  net: 'Z' + (i % nNets), reportT: Infinity, askRank: rng(), respU: 0, respU2: 0, delay: expo(MEAN_ANSWER), delay2: expo(MEAN_ANSWER), pdelay: rng() * 2, wrong: false });

const pkey = (u, def) => (def ? 'n' + u.net : 'u' + u.id);
const clockMin = (ctx, t) => (((ctx.clock0 + t) % 1440) + 1440) % 1440;
const isNight = (m) => m >= 1320 || m < 360;          // 22:00 a 06:00
const askAllowed = (m) => m >= 360 && m < 1380;        // preguntas push: 06:00 a 23:00 (luz y agua)

// Evalua un incidente con origen en la celda c. Devuelve {tc, tp, zone, ts, ev, pool} o null.
// tc = instante de confirmacion; tp = instante en que se PUBLICA (cubo de 5 min si la regla lo tiene).
function evalCell(c, W, rule, ctx) {
  if (rule.gate && W.adoptCounted < ADOPT_MIN) return null;
  const def = rule.def;
  const el = rule.ageFilter ? (u) => u.old : () => true;
  const suspCells = rule.scope === 'cell' ? [c] : diskOf(c);
  const rep = [];
  for (const cell of suspCells) { const a = W.reps.get(cell); if (a) for (const u of a) if (el(u) && u.reportT <= HORIZON) rep.push(u); }
  if (rep.length < SUSPECT_MIN) return null;
  rep.sort((x, y) => x.reportT - y.reportT);
  const diskSet = diskSetOf(c), kids = kidsOf(c);
  const uniCells = rule.parent ? uniOf(c) : diskOf(c);
  const pool = [];
  for (const cell of uniCells) { const a = W.byCell.get(cell); if (a) for (const u of a) if (el(u)) pool.push(u); }
  pool.sort((x, y) => x.askRank - y.askRank);
  const cellScope = (u) => u.cell === c, diskScope = (u) => diskSet.has(u.cell), allScope = () => true;
  let tStart = 0;
  for (;;) {
    let ts = null;
    for (let i = 0; i < rep.length; i++) {
      const t = rep[i].reportT; if (t < tStart) continue; if (t > HORIZON) break;
      const keys = new Set();
      for (let j = i; j >= 0 && rep[j].reportT > t - SUSPECT_WIN; j--) keys.add(pkey(rep[j], def));
      if (keys.size >= SUSPECT_MIN) { ts = t; break; }
    }
    if (ts === null) return null;
    // --- eventos de voto: reportes (cuentan como "si") y respuestas a la pregunta push
    const ev = [];
    for (const u of pool) if (u.reportT <= HORIZON) ev.push({ t: u.reportT, u, yes: true, w: 1 });
    if (askAllowed(clockMin(ctx, ts))) {
      let cand = pool.filter((u) => u.reportT === Infinity);
      let slice;
      if (rule.ownFrac) {
        const own = cand.filter((u) => u.cell === c), rest = cand.filter((u) => u.cell !== c);
        const nOwn = Math.min(own.length, Math.max(Math.round(ASK_MAX * rule.ownFrac), ASK_MAX - rest.length));
        slice = own.slice(0, nOwn).concat(rest.slice(0, ASK_MAX - nOwn));
      } else slice = cand.slice(0, ASK_MAX);
      if (ctx.stat) { ctx.stat.asked = (ctx.stat.asked || 0) + slice.length; ctx.stat.hoard = (ctx.stat.hoard || 0) + slice.filter((u) => u.hoard).length; }
      for (const u of slice) {
        if (!(u.respU < ctx.q) || !u.home) continue;   // "No estoy en casa" no cuenta
        const t = ts + u.delay + (rule.askDelay ? u.pdelay : 0); if (t > HORIZON) continue;
        const yes = (u.aff || u.fake) !== u.wrong;
        ev.push({ t, u, yes, w: !yes && rule.noRingW && u.cell !== c ? rule.noRingW : 1 });
      }
    }
    ev.sort((x, y) => x.t - y.t);
    const tMin = ts + (rule.minWait || 0), tMax = Math.min(ts + rule.expire, HORIZON);
    const WIN = rule.win;
    const tally = (t, inScope, anc) => {
      const m = new Map(); let raw = 0;
      for (let j = ev.length - 1; j >= 0; j--) {
        const e = ev[j]; if (e.t > t) continue; if (e.t <= t - WIN) break;
        if (!inScope(e.u)) continue;
        const k = pkey(e.u, def); let v = m.get(k);
        if (!v) { v = { yes: false, anyNo: false, noW: 0, anc: false }; m.set(k, v); }
        if (e.yes) { raw++; v.yes = true; if (anc(e.u)) v.anc = true; } else { v.anyNo = true; v.noW = Math.max(v.noW, e.w); }
      }
      let yesP = 0, nw = 0, anchors = 0;
      for (const v of m.values()) { if (v.anyNo) nw += v.noW; else if (v.yes) { yesP++; if (v.anc) anchors++; } }   // en grupos mixtos gana el "no"
      return { yesP, raw, anchors, ok: yesP >= K && yesP / (yesP + nw) >= RATIO };
    };
    const ancCell = (u) => u.cell === c && (!rule.ageFilter || u.old);
    const ancKids = (u) => kids.has(u.cell) && (!rule.ageFilter || u.old);
    const nightOk = (t, r) => {
      if (!rule.night || !isNight(clockMin(ctx, t))) return true;
      const np = rule.nightP ?? NIGHT_PERSONS;
      return rule.night === 'or' ? (r.yesP >= np || r.anchors >= NIGHT_ANCHORS) : (r.yesP >= np && r.anchors >= NIGHT_ANCHORS);
    };
    const anchorOk = (r) => !rule.anchor || r.anchors >= 1;
    const checks = [tMin, ...ev.filter((e) => e.yes && e.t >= tMin && e.t <= tMax).map((e) => e.t)].filter((t) => t <= tMax);
    for (const t of checks) {
      let zone = null;
      if (rule.scope === 'cell') { const r = tally(t, cellScope, cellScope); if (r.ok) zone = 'r8'; }
      else {
        const r8 = tally(t, diskScope, ancCell);
        if (ctx.stat) { ctx.stat.raw = r8.raw; ctx.stat.p = r8.yesP; }
        if (r8.ok && anchorOk(r8) && nightOk(t, r8)) zone = 'r8';
        else if (rule.parent) { const r7 = tally(t, allScope, ancKids); if (r7.ok && anchorOk(r7) && nightOk(t, r7)) zone = 'r7'; }
      }
      if (zone) return { c, tc: t, tp: rule.bucket ? Math.ceil(t / rule.bucket) * rule.bucket : t, zone, ts, ev, pool };
    }
    tStart = ts + rule.expire;       // el sospechado expiro sin confirmar; puede nacer otro
    if (tStart > HORIZON) return null;
  }
}

// celdas publicadas en el instante tau
function publishedSet(pubs, tau) {
  const s = new Set();
  for (const p of pubs) { if (p.tp > tau) continue; if (p.zone === 'r8') s.add(p.c); else for (const k of kidsOf(p.c)) s.add(k); }
  return s;
}
// celdas pintadas SOLO por una zona res 7 (no por una celda res 8 propia)
function paintedOnlyBy7(pubs, tau) {
  const s8 = new Set(pubs.filter((p) => p.tp <= tau && p.zone === 'r8').map((p) => p.c)), s = new Set();
  for (const p of pubs) if (p.tp <= tau && p.zone === 'r7') for (const k of kidsOf(p.c)) if (!s8.has(k)) s.add(k);
  return s;
}

// ---------- Experimento 1: corte real (visibilidad, cobertura, celdas sin corte pintadas) ----------
const SCEN = [['1 celda', 0], ['7 celdas', 1], ['sector grande (37 celdas)', 3]];
const ADOPT = [0.001, 0.005, 0.01, 0.03];

function realOutage(kA, adopt, q, r, ids, o = {}) {
  const A = new Set(gridDisk(CENTER, kA)), evalCells = gridDisk(CENTER, kA + 1), wcells = gridDisk(CENTER, kA + 3);
  const out = {}; for (const id of ids) out[id] = { vis: TAUS.map(() => 0), cov: TAUS.map(() => 0), fp: TAUS.map(() => 0), fp7: 0, fpAny: TAUS.map(() => 0), raw: 0, p: 0 };
  for (let tr = 0; tr < TRIALS; tr++) {
    setSeed(seedFor(kA, adopt * 1000, q * 100, r * 100, o.salt ?? 0, tr));
    const W = genWorld(wcells, { adopt, aff: A, r, pMobile: o.pMobile, netPool: o.netPool, share: o.share, adoptCounted: o.adoptCounted, meanAns: o.meanAns, meanRep: o.meanRep });
    for (const id of ids) {
      const rule = RULES[id], base = { q, clock0: o.clock0 ?? 720 };
      const pubs = []; let st = null;
      for (const c of evalCells) {
        const cx = (o.stats && c === CENTER) ? { ...base, stat: {} } : base;
        const res = evalCell(c, W, rule, cx); if (res) pubs.push(res);
        if (cx.stat) st = cx.stat;
      }
      const R = out[id];
      if (st && st.raw) { R.raw += st.raw; R.p += st.p; }
      TAUS.forEach((tau, i) => {
        const s = publishedSet(pubs, tau); let inA = 0, outA = 0;
        for (const x of s) { if (A.has(x)) inA++; else outA++; }
        if (inA > 0) R.vis[i]++;
        R.cov[i] += inA / A.size; R.fp[i] += outA; if (outA > 0) R.fpAny[i]++;
        if (i === 2) { for (const x of paintedOnlyBy7(pubs, tau)) if (!A.has(x)) R.fp7++; }
      });
    }
  }
  for (const id of ids) { const R = out[id]; R.vis = R.vis.map((x) => x / TRIALS); R.cov = R.cov.map((x) => x / TRIALS); R.fp = R.fp.map((x) => x / TRIALS); R.fp7 /= TRIALS; R.fpAny = R.fpAny.map((x) => x / TRIALS); }
  return out;
}
const pct = (x, w = 3) => String(Math.round(x * 100)).padStart(w);
const num = (x, d = 1, w = 5) => x.toFixed(d).padStart(w);
const hdr = (ids) => ids.map((id) => id.padStart(4)).join(' ');
const line = (label, ids, h, fn) => console.log('   ' + label.padEnd(44) + ids.map((id) => fn(h[id]).padStart(4)).join(' '));
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(0);

console.log(`SIMULACION v2 DE UMBRALES  (repeticiones=${TRIALS}, ataque=${ATK_TRIALS}, retraccion=${RET_TRIALS}, semilla=${SEED}${FULL ? ', --full' : ''})`);
console.log('Pareada: en cada repeticion todas las reglas ven el mismo mundo. Cifras en % salvo que se indique.');
for (const id of ALL) console.log(`  regla ${id.padEnd(3)}: ${RULES[id].label}`);
console.log('');

console.log('############ 1. CORTE REAL: visibilidad, cobertura y celdas sin corte pintadas (dia, 12:00) ############');
const combosFor = () => {
  if (!FULL) return { central: [0.4, 0.05], baja: [0.2, 0.02], alta: [0.6, 0.15] };
  const o = {}; for (const q of [0.2, 0.4, 0.6]) for (const r of [0.02, 0.05, 0.15]) o[q === 0.4 && r === 0.05 ? 'central' : `resp${q * 100}_esp${r * 100}`] = [q, r]; return o;
};
for (const [sname, kA] of SCEN) {
  console.log(`\n== Corte: ${sname} ==`);
  for (const ad of ADOPT) {
    console.log(`\n  -- adopcion ${(ad * 100).toFixed(1)}% (veteranos; +${NEW_FRAC * 100}% cuentas nuevas) --`);
    const res = {};
    for (const [cn, [q, r]] of Object.entries(combosFor())) res[cn] = realOutage(kA, ad, q, r, cn === 'central' ? ALL : MAIN);
    const h = res.central;
    console.log('   CASO CENTRAL (resp 40%, espontaneo 5%)          ' + hdr(MAIN));
    line('visible a 30 min', MAIN, h, (R) => pct(R.vis[1]));
    line('visible a 60 min', MAIN, h, (R) => pct(R.vis[2]));
    line('visible a 120 min', MAIN, h, (R) => pct(R.vis[3]));
    line('cobertura a 60 min (% celdas con corte)', MAIN, h, (R) => pct(R.cov[2]));
    line('cobertura a 120 min', MAIN, h, (R) => pct(R.cov[3]));
    line('celdas SIN corte pintadas a 60 (prom.)', MAIN, h, (R) => num(R.fp[2], 1, 4));
    line('   de ellas, pintadas por una zona res 7', MAIN, h, (R) => num(R.fp7, 1, 4));
    line('% pruebas con alguna celda sin corte, 60', MAIN, h, (R) => pct(R.fpAny[2]));
    for (const [cn, hh] of Object.entries(res)) {
      if (cn === 'central') continue;
      line(`visible a 60 min, caso ${cn} (otras respuestas)`, MAIN, hh, (R) => pct(R.vis[2]));
    }
    console.log('   variantes de f (caso central)                   ' + hdr(VARS));
    line('visible a 60 min', VARS, h, (R) => pct(R.vis[2]));
    line('visible a 120 min', VARS, h, (R) => pct(R.vis[3]));
    line('cobertura a 120 min', VARS, h, (R) => pct(R.cov[3]));
  }
}
console.log(`\n(tiempo seccion 1: ${secs()} s)\n`);

// ---------- Ataque (compartido por secciones 2 y 4) ----------
const centers = [];
for (const c of gridDisk(CENTER, 30)) { if (centers.every((o) => gridDistance(o, c) >= 8)) centers.push(c); if (centers.length >= 10) break; }
const CELL_KM2 = 0.737;
function attackOne(N, gs, strat, nets, adoptH, ids, o = {}) {
  const G = Math.floor(N / gs); const R = {}; for (const id of ids) R[id] = { z: 0, area: 0, any: 0 };
  for (let tr = 0; tr < ATK_TRIALS; tr++) {
    const zs = {}, as = {}; for (const id of ids) { zs[id] = 0; as[id] = 0; }
    for (let g = 0; g < G; g++) {
      setSeed(seedFor(N, gs, strat === 'juntas' ? 1 : 2, nets, adoptH * 1000, o.clock0 ?? 720, o.aged === false ? 7 : 3, g, tr, o.salt ?? 0));
      const ctr = centers[g], ring = gridDisk(ctr, 1).slice(1);
      const W = genWorld(gridDisk(ctr, 3), { adopt: adoptH, aff: null, r: 0 });
      const spots = strat === 'juntas' ? Array(gs).fill(ctr) : [ctr, ring[0], ring[1]].slice(0, gs);
      W.adoptCounted = adoptH + (o.aged === false ? 0 : gs / (7 * POP_CELL));
      addUsers(W, spots.map((cell, k) => mkFake(cell, g * gs + k, nets, o.aged !== false)));
      for (const id of ids) {
        const rule = RULES[id], ctx = { q: 0.4, clock0: o.clock0 ?? 720 };
        const r8 = new Set(), r7 = new Set();
        for (const c of gridDisk(ctr, 1)) { const res = evalCell(c, W, rule, ctx); if (res) { if (res.zone === 'r7') r7.add(cellToParent(c, 7)); else r8.add(c); } }
        for (const c of [...r8]) if (r7.has(cellToParent(c, 7))) r8.delete(c);
        zs[id] += r8.size + r7.size; as[id] += r8.size + 7 * r7.size;
      }
    }
    for (const id of ids) { R[id].z += zs[id]; R[id].area += as[id]; if (zs[id] > 0) R[id].any++; }
  }
  for (const id of ids) { R[id].z /= ATK_TRIALS; R[id].area /= ATK_TRIALS; R[id].any /= ATK_TRIALS; }
  return R;
}

// ---------- Experimento 2: horario (dia / noche) ----------
console.log('############ 2. HORARIO: corte real de dia y de noche (central, resp 40%, espontaneo 5%) ############');
console.log('Reglas: a e fd(f con regla de dia) f(noche: 5 personas o 2 anclas) fs(5 personas Y 2 anclas) fs8(8 personas Y 2 anclas) fn(f sin compuerta).');
console.log('Sin preguntas push de 23:00 a 06:00 (luz y agua se preguntan hasta las 23:00). Reporte espontaneo igual que de dia (SUPUESTO optimista).');
const NIGHT_IDS = ['a', 'e', 'fd', 'f', 'fs', 'fs8', 'fn'];
for (const [sname, kA] of SCEN) for (const ad of [0.01, 0.03]) {
  console.log(`\n== ${sname}, adopcion ${(ad * 100).toFixed(0)}%  (visible a 60 / a 120 min) ==`);
  console.log('   hora de inicio del corte                          ' + NIGHT_IDS.map((id) => id.padStart(7)).join(' '));
  for (const [lab, clk] of [['12:00 (dia)', 720], ['22:30 (preguntas hasta 23:00)', 1350], ['23:00 (sin preguntas)', 1380], ['02:00 (sin preguntas)', 120]]) {
    const h = realOutage(kA, ad, 0.4, 0.05, NIGHT_IDS, { clock0: clk, salt: clk });
    console.log('   ' + lab.padEnd(44) + NIGHT_IDS.map((id) => (pct(h[id].vis[2]) + '/' + pct(h[id].vis[3]).trim()).padStart(7)).join(' '));
  }
}
console.log('\n== ATAQUE DE NOCHE vs DE DIA: cuentas falsas (con >24 h, una red distinta cada una), juntas en una celda ==');
console.log('   Cifra = % de pruebas en que se publica una zona falsa (promedio de zonas entre parentesis). Reglas: e fd f fs fs8 h w');
const ATK_NIGHT_IDS = ['e', 'fd', 'f', 'fs', 'fs8', 'h', 'w'];
console.log('   cuentas | hora  | honestos |   ' + ATK_NIGHT_IDS.map((x) => x.padStart(10)).join(' '));
for (const gs of [3, 5, 8]) for (const [lab, clk] of [['12:00', 720], ['02:00', 120]]) for (const ad of [0.01, 0.03]) {
  const R = attackOne(gs, gs, 'juntas', 0, ad, ATK_NIGHT_IDS, { clock0: clk, salt: 11 });
  console.log(`   ${String(gs).padStart(7)} | ${lab} | ${(ad * 100).toFixed(0).padStart(7)}% |   ` + ATK_NIGHT_IDS.map((id) => `${pct(R[id].any)}%(${R[id].z.toFixed(1)})`.padStart(10)).join(' '));
}
console.log(`\n(tiempo acumulado: ${secs()} s)\n`);

// ---------- Experimento 3: retraccion ----------
console.log('############ 3. RETRACCION tras confirmar (N "no" de la celda propia y proporcion sí/(sí+no) < 0,4) ############');
console.log(`Despues de confirmar se pregunta "¿Ya volvio?" a suscritos del disco que no votaron: primera ronda a los ${RET_WAVE_FIRST} min y luego cada ${RET_WAVE_EVERY} min (hasta ${ASK_MAX} por ronda, celda propia primero). Error honesto de respuesta: 5%. Seguimiento: ${RET_SPAN / 60} h.`);
const CRIT = [{ N: 2, own: false }, { N: 3, own: false }, { N: 5, own: false }, { N: 3, own: true }, { N: 3, both: true }];
function retractTimes(res, c, q, Ns) {
  const evs = res.ev.slice(), voted = new Set(evs.map((e) => e.u.id)), diskSet = diskSetOf(c);
  const base = res.pool.filter((u) => diskSet.has(u.cell));
  for (let k = 0; RET_WAVE_FIRST + RET_WAVE_EVERY * k <= RET_SPAN; k++) {
    const tw = res.tc + RET_WAVE_FIRST + RET_WAVE_EVERY * k;
    let cand = base.filter((u) => !voted.has(u.id));
    cand = cand.filter((u) => u.cell === c).concat(cand.filter((u) => u.cell !== c));
    for (const u of cand.slice(0, ASK_MAX)) {
      if (!u.home || !(((u.respU2 + k * 0.6180339887) % 1) < q)) continue;
      const yes = (u.aff || u.fake) !== u.wrong;
      evs.push({ t: tw + u.delay2, u, yes, w: !yes && u.cell !== c ? RING_NO_W : 1 });
      voted.add(u.id);
    }
  }
  evs.sort((x, y) => x.t - y.t);
  const hit = Ns.map(() => Infinity);
  for (let i = 0; i < evs.length; i++) {
    const t = evs[i].t; if (t < res.tc) continue; if (t > res.tc + RET_SPAN) break;
    const m = new Map();
    for (let j = 0; j <= i; j++) {
      const e = evs[j], k = 'n' + e.u.net; let v = m.get(k); if (!v) { v = { yes: false, anyNo: false, noW: 0, own: false, ownCell: false }; m.set(k, v); }
      if (e.u.cell === c) v.ownCell = true;
      if (e.yes) v.yes = true; else { v.anyNo = true; v.noW = Math.max(v.noW, e.w); if (e.u.cell === c) v.own = true; }
    }
    let yw = 0, nw = 0, own = 0, yo = 0, no = 0;
    for (const v of m.values()) {
      if (v.anyNo) { nw += v.noW; if (v.own) own++; if (v.ownCell) no++; } else if (v.yes) { yw++; if (v.ownCell) yo++; }
    }
    const ratio = yw + nw > 0 ? yw / (yw + nw) : 1, ratioOwn = yo + no > 0 ? yo / (yo + no) : 1;
    Ns.forEach((cr, k) => { if (hit[k] === Infinity && own >= cr.N && (cr.both ? (ratio < RET_RATIO && ratioOwn < RET_RATIO) : (cr.own ? ratioOwn : ratio) < RET_RATIO)) hit[k] = Math.ceil(t / BUCKET) * BUCKET - res.tp; });
  }
  return hit;
}
const NS = CRIT;
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const p90 = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : NaN; };
console.log('\n== 3a. Incidente FALSO publicado por un atacante (cuentas con >24 h, juntas en una celda, cada una en una red distinta) ==');
console.log('   Solo cuentan las pruebas en que el atacante logro publicar. Sin retraccion: 720 min (12 h, cierre por inactividad) si el atacante no renueva; sin limite si renueva.');
console.log('   Cada celda = % retractado en 12 h / mediana de minutos desde la publicacion / percentil 90.');
console.log('   cuentas honest. | publicadas    |  N=2                |  N=3                |  N=5                |  N=3 proporcion solo de la celda propia | N=3 ambas proporciones');
for (const gs of [3, 5]) for (const ad of [0.01, 0.03]) {
  const times = NS.map(() => []); let pub = 0, tot = 0;
  for (let tr = 0; tr < RET_TRIALS * 5 && pub < 200; tr++) {
    tot++; setSeed(seedFor(gs, ad * 1000, 99, tr));
    const W = genWorld(gridDisk(CENTER, 3), { adopt: ad, aff: null, r: 0, err: 0.05 });
    addUsers(W, Array.from({ length: gs }, (_, k) => mkFake(CENTER, k, 0, true)));
    const res = evalCell(CENTER, W, RULES.f, { q: 0.4, clock0: 720 }); if (!res) continue;
    pub++; retractTimes(res, CENTER, 0.4, NS).forEach((h, k) => times[k].push(h));
  }
  const cell = (k) => { const ok = times[k].filter((x) => x < Infinity); return `${pct(ok.length / Math.max(1, pub))}% / ${isNaN(med(ok)) ? '-' : med(ok)} / ${isNaN(p90(ok)) ? '-' : p90(ok)}`; };
  console.log(`   ${String(gs).padStart(5)} ${(ad * 100).toFixed(0).padStart(3)}% | ${String(pub).padStart(4)} de ${String(tot).padStart(4)} | ${cell(0).padEnd(19)} | ${cell(1).padEnd(19)} | ${cell(2).padEnd(19)} | ${cell(3).padEnd(19)} | ${cell(4)}`);
}
console.log('\n== 3b. Corte REAL confirmado legitimamente: % retractado por error en 12 h (falsos retractados) ==');
console.log('   pAfec = fraccion de usuarios de la celda propia que de verdad perdieron el servicio (parcial = transformador).');
console.log('   corte    adop pAfec | publicados | retractado N=2  N=3  N=5  N=3(solo celda propia)  N=3(ambas)');
for (const [sname, kA] of [['1 celda', 0], ['7 celdas', 1]]) for (const ad of [0.01, 0.03]) for (const pA of [1, 0.85, 0.6, 0.4]) {
  const A = new Set(gridDisk(CENTER, kA)); const times = NS.map(() => []); let pub = 0;
  for (let tr = 0; tr < RET_TRIALS; tr++) {
    setSeed(seedFor(kA, ad * 1000, pA * 100, 77, tr));
    const W = genWorld(gridDisk(CENTER, kA + 3), { adopt: ad, aff: A, r: 0.05, pAff: pA, err: 0.05 });
    const res = evalCell(CENTER, W, RULES.f, { q: 0.4, clock0: 720 }); if (!res) continue;
    pub++; retractTimes(res, CENTER, 0.4, NS).forEach((h, k) => times[k].push(h));
  }
  const f = (k) => pct(times[k].filter((x) => x < Infinity).length / Math.max(1, pub)).padStart(5);
  console.log(`   ${sname.padEnd(8)} ${(ad * 100).toFixed(0).padStart(3)}% ${pct(pA).padStart(4)}% | ${String(pub).padStart(5)}      |   ${f(0)} ${f(1)} ${f(2)} ${f(3).padStart(8)} ${f(4).padStart(11)}`);
}
console.log(`\n(tiempo acumulado: ${secs()} s)\n`);

// ---------- Experimento 4: acaparar preguntas y atacante disperso ----------
console.log('############ 4. ATACANTE: acaparar preguntas, negar un corte real y zonas dispersas ############');
console.log('== 4a. Acaparar las 40 preguntas: cuentas del atacante suscritas en la celda objetivo (honestos 3%) ==');
console.log('   Preguntas (de 40) que caen en cuentas del atacante, y si un corte real de 1 celda sigue visible a 60 min cuando esas cuentas responden "no".');
function hoardRun(M, aged, nNets) {
  const A = new Set([CENTER]); const st = { asked: 0, hoard: 0 }; let vis = 0; const T = Math.min(TRIALS, 300);
  for (let tr = 0; tr < T; tr++) {
    setSeed(seedFor(M, aged ? 1 : 2, nNets, 55, tr));
    const W = genWorld(gridDisk(CENTER, 4), { adopt: 0.03, aff: A, r: 0.05 });
    addUsers(W, Array.from({ length: M }, (_, k) => mkHoard(CENTER, k, nNets, aged)));
    const cx = { q: 0.4, clock0: 720, stat: {} }; const res = evalCell(CENTER, W, RULES.f, cx);
    st.asked += cx.stat.asked || 0; st.hoard += cx.stat.hoard || 0;
    if (res && res.tp <= 60) vis++;
  }
  return { slots: st.asked ? 40 * st.hoard / st.asked : 0, vis: vis / T };
}
console.log('   cuentas atacante | tipo          | preguntas ocupadas (de 40) | origen visible a 60 min');
for (const M of [0, 50, 200, 1000]) for (const aged of M === 0 ? [true] : [false, true]) {
  const R = hoardRun(M, aged, 5);
  console.log(`   ${String(M).padStart(16)} | ${(M === 0 ? 'ninguna' : aged ? 'con >24 h' : 'nuevas <24 h').padEnd(13)} | ${num(R.slots, 1, 14)}             | ${pct(R.vis).padStart(5)}%`);
}
console.log('   (las cuentas del atacante usan 5 redes distintas; con la dedup. por red valen como maximo 5 "no")');

console.log('\n== 4b. Zonas falsas visibles (promedio de zonas; entre parentesis km2 aprox.) con N cuentas del atacante, grupos de 3 ==');
console.log('   Cuentas del atacante con >24 h (peor caso para f), cada cuenta en una red distinta. a b d e: reglas v1 (sin edad ni dedup. por red).');
console.log('   f = v2 final (preguntas al azar en toda la zona res 7); h = f con preguntas primero a la celda propia; w = la mitad a la celda propia; n = sin compuerta de adopcion.');
const ATK_IDS = ['a', 'b', 'd', 'e', 'f', 'fn', 'w', 'wn', 'h', 'hn'];
for (const ad of [0.001, 0.005, 0.01]) for (const strat of ['juntas', 'dispersas']) {
  console.log(`\n   -- honestos ${(ad * 100).toFixed(1)}%, estrategia ${strat} --`);
  console.log('   cuentas |' + ATK_IDS.map((x) => x.padStart(9)).join(' ') + ' | f(1 red) f(2 redes) f(cuentas nuevas)');
  for (const N of [3, 12, 30]) {
    const many = attackOne(N, 3, strat, 0, ad, ATK_IDS, { salt: 5 });
    const one = attackOne(N, 3, strat, 1, ad, ['f'], { salt: 5 });
    const two = attackOne(N, 3, strat, 2, ad, ['f'], { salt: 5 });
    const nw = attackOne(N, 3, strat, 0, ad, ['f'], { salt: 5, aged: false });
    const z = (R, id) => `${R[id].z.toFixed(1)}(${(R[id].area * CELL_KM2).toFixed(0)})`.padStart(9);
    console.log(`   ${String(N).padStart(7)} |${ATK_IDS.map((id) => z(many, id)).join(' ')} | ${z(one, 'f')} ${z(two, 'f')} ${z(nw, 'f').padStart(14)}`);
  }
}
console.log(`\n== 4c. Compuerta de adopcion: cuentas de >7 dias que necesita un atacante para destrabar una zona res 7 (35.000 habitantes, minimo ${ADOPT_MIN * 100}%) ==`);
for (const ad of [0.001, 0.005]) console.log(`   honestos ${(ad * 100).toFixed(1)}%: faltan ${Math.ceil((ADOPT_MIN - ad) * 7 * POP_CELL)} cuentas de >7 dias (cada una pasa captcha de alta y debe esperar 7 dias).`);
console.log(`\n(tiempo acumulado: ${secs()} s)\n`);

// ---------- Experimento 5: altas honestas en el pico (CGNAT) ----------
console.log('############ 5. ALTAS HONESTAS EN EL PICO (CGNAT): deduplicacion por red, alerta y limite de altas por IP ############');
console.log(`== 5a. Una hora de pico: S altas honestas; las moviles comparten pocas redes /24 (${IPS_PER_NET} IP de salida por /24); limite 60 altas/h por IP (CLAUDE.md §12); alerta con >=5 altas de la misma red/h ==`);
console.log('   redes /24 moviles | % movil | altas/h | % de altas en redes con alerta | alertas/h | % altas bloqueadas por el limite de 60/IP');
function peak(S, mob, pool) {
  let flag = 0, alerts = 0, blocked = 0; const REP = 300;
  for (let i = 0; i < REP; i++) {
    setSeed(seedFor(S, mob * 100, pool, 13, i));
    const nets = new Map(), ips = new Map();
    for (let s = 0; s < S; s++) if (rng() < mob) { const n = Math.floor(rng() * pool); nets.set(n, (nets.get(n) || 0) + 1); const ip = n * IPS_PER_NET + Math.floor(rng() * IPS_PER_NET); ips.set(ip, (ips.get(ip) || 0) + 1); }
    for (const v of nets.values()) if (v >= 5) { flag += v; alerts++; }
    for (const v of ips.values()) if (v > 60) blocked += v - 60;
  }
  return { flag: flag / REP / S, alerts: alerts / REP, blocked: blocked / REP / S };
}
for (const S of [20, 1000, 5000, 20000]) for (const mob of [0.6, 0.9]) for (const pool of [20, 100, 500]) {
  const R = peak(S, mob, pool);
  console.log(`   ${String(pool).padStart(17)} | ${pct(mob).padStart(6)}% | ${String(S).padStart(7)} | ${pct(R.flag).padStart(18)}%             | ${num(R.alerts, 1, 9)} | ${num(R.blocked * 100, 1, 12)}%`);
}
console.log('\n== 5b. Costo de la deduplicacion por red en un corte real (adopcion 3%, central): f (con dedup.) vs fx (sin dedup.) ==');
console.log('   Cifra = visible a 60 min / cobertura a 60 min / % de "personas" perdidas en el conteo de la celda de origen.');
console.log('   corte      | % movil | redes /24 |   f: visible/cob/perdidas   |   fx: visible/cob');
for (const [sname, kA] of [['1 celda', 0], ['7 celdas', 1]]) for (const mob of [0.6, 0.9]) for (const pool of [10, 30, 100, 100000]) {
  const h = realOutage(kA, 0.03, 0.4, 0.05, ['f', 'fx'], { pMobile: mob, netPool: pool, salt: pool, stats: true });
  const lost = h.f.raw ? 1 - h.f.p / h.f.raw : 0;
  console.log(`   ${sname.padEnd(10)} | ${pct(mob).padStart(6)}% | ${String(pool === 100000 ? 'una c/u' : pool).padStart(9)} |   ${pct(h.f.vis[2])}% / ${pct(h.f.cov[2])}% / ${pct(lost)}%      |   ${pct(h.fx.vis[2])}% / ${pct(h.fx.cov[2])}%`);
}
console.log(`\n(tiempo acumulado: ${secs()} s)\n`);

// ---------- Experimento 6: internet por proveedor ----------
console.log('############ 6. INTERNET POR PROVEEDOR: la adopcion se reparte entre 5 proveedores ############');
console.log('SUPUESTO: la pregunta solo llega a quien declaro ese proveedor (hoy el modelo de datos no guarda proveedor por usuario: ver riesgos).');
console.log('La compuerta de adopcion se evalua con la adopcion TOTAL de la zona. Cifra = visible a 60 min / cobertura a 60 min.');
const PROVS = [['Netlife (35%)', 0.35], ['CNT (25%)', 0.25], ['Claro (20%)', 0.2], ['proveedor chico (10%)', 0.1]];
for (const [sname, kA] of [['1 celda', 0], ['7 celdas', 1]]) for (const ad of [0.01, 0.03]) {
  console.log(`\n  -- ${sname}, adopcion total ${(ad * 100).toFixed(0)}% --  reglas: a e f fn`);
  for (const [pn, sh] of [['(sin dividir, como luz)', 1], ...PROVS]) {
    const h = realOutage(kA, ad, 0.4, 0.05, ['a', 'e', 'f', 'fn'], { share: sh, adoptCounted: ad, salt: sh * 100 });
    console.log('   ' + pn.padEnd(24) + ['a', 'e', 'f', 'fn'].map((id) => `${pct(h[id].vis[2])}/${pct(h[id].cov[2])}`.padStart(9)).join(' '));
  }
}
// ---------- Experimento 7: respuestas lentas (efecto de 45 vs 60 min) ----------
console.log('\n############ 7. RESPUESTAS LENTAS: sospechado a 45 min (g) vs 60 min (f) ############');
console.log('Supuesto distinto: el reporte espontaneo y la respuesta al push tardan en media 25 min (en vez de 8 y 5). Cifra = visible a 120 min.');
for (const [sname, kA] of [['1 celda', 0], ['7 celdas', 1]]) for (const ad of [0.01, 0.03]) {
  const h = realOutage(kA, ad, 0.4, 0.05, ['f', 'g'], { meanAns: 25, meanRep: 25, salt: 31 });
  console.log(`   ${sname.padEnd(9)} adopcion ${(ad * 100).toFixed(0)}%:  f (60 min) ${pct(h.f.vis[3])}%   g (45 min) ${pct(h.g.vis[3])}%`);
}
console.log(`\nTiempo total: ${secs()} s`);
