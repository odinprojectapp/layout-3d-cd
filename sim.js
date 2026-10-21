// Simulación de procesos: montacargas, camiones y tráfico sobre el plano.
// Coordenadas en unidades del plano (puntos de Excel, origen arriba-izquierda); y del plano = z del mundo.
import * as THREE from 'three';

const PALLET = { A: '#7cc24a', B: '#e8c93a', C: '#f0903a', E: '#6b9bd1' };

// ---------- modelos (frente hacia +x) ----------
const mats = {};
const mat = c => (mats[c] ??= new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.1 }));
const box = (w, h, d, c, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
  m.position.set(x, y, z); m.castShadow = true; return m;
};
const wheel = (r, w, x, y, z) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 12), mat('#1b1b1b'));
  m.rotation.x = Math.PI / 2; m.position.set(x, y, z); m.castShadow = true; return m;
};

function forklift() {
  const g = new THREE.Group();
  g.add(box(20, 7, 13, '#f2b705', 0, 5.5, 0), box(5, 9, 12, '#3a3a3a', -9, 6.5, 0), box(5, 4, 6, '#222', -2, 11, 0));
  for (const [x, z] of [[-6, 5.5], [-6, -5.5], [4, 5.5], [4, -5.5]]) g.add(box(0.9, 12, 0.9, '#222', x, 15, z));
  g.add(box(12, 0.8, 12, '#222', -1, 21, 0));
  g.add(box(1.2, 26, 1.2, '#444', 10.5, 13, 4.5), box(1.2, 26, 1.2, '#444', 10.5, 13, -4.5));
  for (const [x, z] of [[-6.5, 6.5], [-6.5, -6.5], [6.5, 6.5], [6.5, -6.5]]) g.add(wheel(2.6, 2.2, x, 2.6, z));
  const carriage = new THREE.Group();
  carriage.add(box(1, 6, 10, '#555', 11.6, 3, 0), box(12, 0.8, 1.6, '#666', 17.5, 0.4, 3), box(12, 0.8, 1.6, '#666', 17.5, 0.4, -3));
  const load = new THREE.Group();
  load.add(box(12, 1.2, 12, '#8a6a3c', 17.5, 1.4, 0));
  const cargo = box(11, 6, 11, '#7cc24a', 17.5, 5, 0); load.add(cargo);
  load.visible = false; carriage.add(load);
  carriage.position.y = 1.6; g.add(carriage);
  g.userData = { carriage, load, cargo };
  return g;
}

function truck(L = 124, cab = '#c0392b', trailer = '#d9d9d9') {
  const g = new THREE.Group();
  g.add(box(L - 6, 3, 18, '#2a2a2a', -3, 5, 0));
  g.add(box(22, 24, 25, cab, L / 2 - 11, 17, 0), box(1, 9, 22, '#1d2b38', L / 2 + 0.2, 22, 0));
  g.add(box(L - 26, 30, 26, trailer, -13, 21.5, 0));
  for (const x of [L / 2 - 14, -L / 2 + 14, -L / 2 + 26, 0]) { g.add(wheel(4, 3, x, 4, 11.5), wheel(4, 3, x, 4, -11.5)); }
  return g;
}

function car(c = '#3d6fa8') {
  const g = new THREE.Group();
  g.add(box(40, 8, 18, c, 0, 6, 0), box(20, 7, 16, c, -2, 13.5, 0), box(0.6, 5, 14, '#1d2b38', 8.3, 13.5, 0));
  for (const x of [12, -12]) g.add(wheel(3.2, 2, x, 3.2, 8.5), wheel(3.2, 2, x, 3.2, -8.5));
  return g;
}

function barge() {
  const g = new THREE.Group();
  g.add(box(150, 6, 34, '#5a3a2a', 0, 3, 0), box(150, 1, 30, '#3a3a3a', 0, 6.5, 0));
  for (const [x, c] of [[-40, '#b33a2e'], [-12, '#2e5c8a'], [16, '#c9a227']]) g.add(box(24, 10, 24, c, x, 12, 0));
  g.add(box(18, 16, 22, '#e0e0e0', 58, 14, 0));
  return g;
}

// suaviza esquinas (Chaikin) para vehículos de calle; conserva extremos
function smooth(pts, it = 2) {
  for (let k = 0; k < it; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
    }
    out.push(pts[pts.length - 1]); pts = out;
  }
  return pts;
}

// ---------- actor: ejecuta un guion de pasos en bucle ----------
class Actor {
  constructor(sim, obj, o) {
    Object.assign(this, { sim, obj, kind: o.kind, name: o.name, process: o.process, turnInPlace: !!o.turnInPlace });
    this.pos = [...o.at]; this.head = Math.atan2(o.dir?.[1] ?? 0, o.dir?.[0] ?? 1);
    this.steps = o.steps || []; this.i = 0; this.cur = null; this.state = o.state || '';
    this.info = o.info; this.scale = o.hidden ? 0 : 1; this.targetScale = this.scale;
    this.mode = o.mode || 'idle'; this.carry = false; this.moved = 0;
    obj.userData.actor = this; obj.traverse(m => { if (m.isMesh) m.userData.owner = obj; });
    sim.world.add(obj); this.sync();
  }
  sync() {
    const { cx, cz } = this.sim;
    this.obj.position.set(this.pos[0] - cx, 0, this.pos[1] - cz);
    this.obj.rotation.y = -this.head;
    this.obj.scale.setScalar(Math.max(this.scale, 0.001));
    this.obj.visible = this.scale > 0.01;
  }
  update(dt) {
    this.scale += (this.targetScale - this.scale) * Math.min(1, dt * 6);
    this.moved = 0;
    if (this.delay > 0) { this.delay -= dt; this.obj.userData.animate?.(this, dt); return this.sync(); }
    let budget = 8;            // pasos instantáneos por cuadro
    while (this.steps.length && budget-- > 0) {
      if (!this.cur) this.cur = this.begin(this.steps[this.i]);
      if (!this.run(this.cur, dt)) break;
      this.cur = null; this.i = (this.i + 1) % this.steps.length; dt = 0;
    }
    this.obj.userData.animate?.(this, dt);
    this.sync();
  }
  begin(s) {
    s = typeof s === 'function' ? s(this) : s;
    const c = { ...s };
    if (c.t === 'move') { c.pts = c.smooth ? smooth([this.pos, ...c.pts]).slice(1) : c.pts.map(p => [...p]); c.k = 0; }
    if (c.t === 'wait' || c.t === 'work') c.left = c.s;
    if (c.t === 'work') this.mode = 'work';
    if (c.state) this.state = c.state;
    return c;
  }
  // devuelve true cuando el paso terminó
  run(c, dt) {
    const u = this.obj.userData;
    switch (c.t) {
      case 'move': {
        let travel = (c.speed || 40) * dt;
        while (c.k < c.pts.length) {
          const p = c.pts[c.k], dx = p[0] - this.pos[0], dy = p[1] - this.pos[1], d = Math.hypot(dx, dy);
          if (d < 0.01) { c.k++; continue; }
          let want = Math.atan2(dy, dx) + (c.rev ? Math.PI : 0);
          let diff = Math.atan2(Math.sin(want - this.head), Math.cos(want - this.head));
          const rate = (this.turnInPlace ? 3.2 : 2.2) * dt * Math.max(1, (c.speed || 40) / 40);
          if (this.turnInPlace && Math.abs(diff) > 0.15) { this.head += Math.sign(diff) * Math.min(Math.abs(diff), rate); return false; }
          this.head += Math.sign(diff) * Math.min(Math.abs(diff), this.turnInPlace ? rate : rate * 2.5);
          if (travel <= 0) return false;
          const s = Math.min(travel, d);
          this.pos[0] += dx / d * s; this.pos[1] += dy / d * s; travel -= s; this.moved += s;
          if (s < d) return false;
          c.k++;
        }
        return true;
      }
      case 'wait': c.left -= dt; return c.left <= 0;
      case 'work': c.left -= dt; if (c.left <= 0) { this.mode = 'idle'; return true; } return false;
      case 'mode': this.mode = c.m; return true;
      case 'carry': this.carry = c.on; return true;
      case 'until': return c.fn(this);
      case 'fork': {
        const cur = u.carriage.position.y, tgt = 1.6 + c.h, step = 14 * dt;
        u.carriage.position.y = Math.abs(tgt - cur) <= step ? tgt : cur + Math.sign(tgt - cur) * step;
        return u.carriage.position.y === tgt;
      }
      case 'load': u.load.visible = true; u.cargo.material = mat(PALLET[c.cls || 'A']); c.fn?.(this); return true;
      case 'unload': u.load.visible = false; c.fn?.(this); return true;
      case 'tp': this.pos = [...c.p]; this.head = Math.atan2(c.dir[1], c.dir[0]); return true;
      case 'show': this.targetScale = 1; return true;
      case 'hide': this.targetScale = 0; return true;
      case 'do': c.fn(this); return true;
      case 'state': return true;
    }
    return true;
  }
}

// ---------- escenarios por CD ----------
export function createSim(ctx) {
  const { site, world } = ctx;
  const sim = { world, cx: site.W / 2, cz: site.H / 2, actors: [], bays: [], props: [], sectorInfo: {}, t: 0 };
  const block = name => site.blocks.find(b => b.name === name);
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const add = (obj, o) => { const a = new Actor(sim, obj, o); sim.actors.push(a); return a; };
  const between = (b, pad = 10) => b.bbox[0] + pad + rnd() * (b.bbox[2] - b.bbox[0] - pad * 2);
  const cls = () => 'ABC'[Math.floor(rnd() * 3)];

  // Bahía: camión que llega, se carga/descarga con montacargas y sale. mode: 'cargue' | 'descargue'
  function bay(o) {
    const b = { ...o, load: o.mode === 'cargue' ? 0 : o.cap, ready: false, trucks: 0, moved: 0 };
    sim.bays.push(b);
    const t = add(truck(o.L, o.cab, '#e6e6e6'), {
      kind: 'Camión', name: `Camión ${o.label}`, process: `${o.mode === 'cargue' ? 'Cargue' : 'Descargue'} · ${o.label}`,
      at: o.spawn, dir: [0, -1], hidden: true, steps: [
        { t: 'tp', p: o.spawn, dir: o.spawnDir },
        { t: 'do', fn: () => { b.load = o.mode === 'cargue' ? 0 : o.cap; } },
        { t: 'show', state: 'Ingresando' },
        { t: 'move', pts: o.arrive, speed: 70, smooth: true },
        { t: 'move', pts: o.backIn, speed: 22, rev: true, smooth: true, state: 'Retrocediendo a bahía' },
        { t: 'do', fn: () => { b.ready = true; }, state: o.mode === 'cargue' ? 'Cargando' : 'Descargando' },
        { t: 'until', fn: () => o.mode === 'cargue' ? b.load >= o.cap : b.load <= 0 },
        { t: 'do', fn: () => { b.ready = false; b.trucks++; }, state: o.mode === 'cargue' ? 'Despachando' : 'Saliendo vacío' },
        { t: 'wait', s: 2 },
        { t: 'move', pts: o.depart, speed: 60, smooth: true },
        { t: 'hide', state: 'Fuera del CD' },
        { t: 'wait', s: 4 },
      ],
      info: () => [['Estibas en camión', `${b.load} / ${o.cap}`], ['Camiones atendidos', b.trucks]],
      bar: () => b.load / o.cap,
    });
    t.bay = b;
    return b;
  }

  // Montacargas que alterna entre rack y bahía
  function bayForklift(b, o) {
    const S = o.stage, U = o.unload, Upre = [U[0], U[1] + o.side * 22];
    const steps = b.mode === 'cargue' ? [
      { t: 'until', fn: () => b.ready && b.load < b.cap, state: 'Esperando camión' },
      a => { a.rx = o.rackX(); return { t: 'move', pts: [S, [a.rx, o.rackPre]], speed: 42, state: 'Hacia rack' }; },
      a => ({ t: 'move', pts: [[a.rx, o.rackPick]], speed: 12, state: 'Tomando estiba' }),
      { t: 'fork', h: 5 }, a => ({ t: 'load', cls: cls() }), { t: 'fork', h: 2 },
      a => ({ t: 'move', pts: [[a.rx, o.rackPre]], speed: 16, rev: true }),
      { t: 'move', pts: [S, Upre], speed: 42, state: 'Llevando a bahía' },
      { t: 'until', fn: () => b.ready, state: 'Esperando camión' },
      { t: 'fork', h: 8 }, { t: 'move', pts: [U], speed: 10, state: 'Cargando camión' },
      { t: 'unload', fn: () => { b.load = Math.min(b.cap, b.load + 1); b.moved++; } },
      { t: 'move', pts: [Upre], speed: 14, rev: true }, { t: 'fork', h: 0 },
    ] : [
      { t: 'until', fn: () => b.ready && b.load > 0, state: 'Esperando camión' },
      { t: 'move', pts: [S, Upre], speed: 42, state: 'Hacia bahía' },
      { t: 'fork', h: 7 }, { t: 'move', pts: [U], speed: 10, state: 'Descargando camión' },
      { t: 'until', fn: () => b.ready && b.load > 0 },
      a => ({ t: 'load', cls: cls(), fn: () => { b.load--; } }), { t: 'fork', h: 9 },
      { t: 'move', pts: [Upre], speed: 14, rev: true }, { t: 'fork', h: 2 },
      a => { a.rx = o.rackX(); return { t: 'move', pts: [S, [a.rx, o.rackPre]], speed: 42, state: 'Llevando a rack' }; },
      { t: 'fork', h: 5 }, a => ({ t: 'move', pts: [[a.rx, o.rackPick]], speed: 12, state: 'Ubicando estiba' }),
      { t: 'unload', fn: () => { b.moved++; } }, { t: 'fork', h: 3 },
      a => ({ t: 'move', pts: [[a.rx, o.rackPre]], speed: 16, rev: true }), { t: 'fork', h: 0 },
    ];
    const f = add(forklift(), {
      kind: 'Montacargas', name: o.name, process: `${b.mode === 'cargue' ? 'Cargue' : 'Descargue'} · ${b.label}`,
      at: S, dir: [0, o.side], turnInPlace: true, steps,
      info: () => [['Bahía', b.label], ['Estibas movidas', b.moved], ['Camión', b.ready ? `${b.load} / ${b.cap}` : 'sin camión']],
    });
    return f;
  }

  // Montacargas lanzadera entre dos puntos (recoge en A, deja en B)
  function shuttle(o) {
    let moved = 0;
    return add(forklift(), {
      kind: 'Montacargas', name: o.name, process: o.process, at: o.home, dir: [1, 0], turnInPlace: true,
      steps: [
        a => { a.p = o.pick(); return { t: 'move', pts: [...(o.via || []), a.p.pre], speed: 40, state: o.go }; },
        a => ({ t: 'move', pts: [a.p.at], speed: 12 }), { t: 'fork', h: 4 }, a => ({ t: 'load', cls: o.cls ?? cls() }), { t: 'fork', h: 2 },
        a => ({ t: 'move', pts: [a.p.pre], speed: 16, rev: true }),
        a => { a.d = o.drop(); return { t: 'move', pts: [...(o.via || []), a.d.pre], speed: 40, state: o.back }; },
        a => ({ t: 'move', pts: [a.d.at], speed: 12 }), { t: 'unload', fn: () => moved++ }, { t: 'fork', h: 0 },
        a => ({ t: 'move', pts: [a.d.pre], speed: 16, rev: true }), { t: 'wait', s: 1 + rnd() * 2 },
      ],
      info: () => [['Estibas movidas', moved]],
    });
  }

  // Vehículo de paso que recorre una ruta y vuelve a empezar
  function passer(obj, o) {
    return add(obj, {
      kind: o.kind, name: o.name, process: o.process, at: o.route[0], hidden: true, steps: [
        { t: 'wait', s: o.delay ?? 0 },
        { t: 'tp', p: o.route[0], dir: [o.route[1][0] - o.route[0][0], o.route[1][1] - o.route[0][1]] },
        { t: 'show', state: 'En tránsito' }, { t: 'move', pts: o.route.slice(1), speed: o.speed, smooth: o.smooth },
        { t: 'hide' }, { t: 'wait', s: o.gap ?? 3 },
      ],
      info: () => [['Ruta', o.process]],
    });
  }

  if (site.id === 'corozal') {
    const IN = [828, 1990], OUT = [755, 1990];
    const bays = [
      { label: 'Bahía 1', x: 609, mode: 'cargue', rack: 'B01', cab: '#c0392b' },
      { label: 'Bahía 2', x: 804, mode: 'descargue', rack: 'C01', cab: '#2e5c8a' },
      { label: 'Bahía 3', x: 1098, mode: 'cargue', rack: 'D01', cab: '#e0e0e0' },
    ];
    bays.forEach((d, i) => {
      const x = d.x, rear = 648, L = 200;
      const b = bay({
        label: d.label, mode: d.mode, cap: 8, L, cab: d.cab, spawn: IN, spawnDir: [0, -1],
        arrive: [[828, 1060], [x + 95, 1040], [x + 95, 950], [x + 45, 912], [x, 950], [x, 1000]],
        backIn: [[x, rear + L / 2]],
        depart: [[x, 1000], [x, 1030], [755, 1075], [755, 1990]],
      });
      const rk = block(d.rack);
      for (let k = 0; k < (i === 0 ? 2 : 1); k++) {
        bayForklift(b, {
          name: `MC-0${sim.actors.filter(a => a.kind === 'Montacargas').length + 1}`,
          stage: [x + (k ? 22 : -10), 600], unload: [x + (k ? 6 : -6), rear - 16], side: -1,
          rackX: () => between(rk, 12), rackPre: rk.bbox[3] + 32, rackPick: rk.bbox[3] + 14,
        });
      }
      sim.actors.find(a => a.bay === b).delay = 2 + i * 9;   // arranque escalonado
    });

    // parqueadero de camiones: puestos ocupados + camiones que entran y salen
    const east = { 32: 742, 31: 785, 30: 820, 29: 863, 28: 901, 27: 944, 26: 984, 25: 1029, 24: 1071, 23: 1130, 22: 1188, 21: 1235, 20: 1297, 19: 1348, 18: 1398, 17: 1449, 16: 1505, 15: 1555, 14: 1601, 13: 1642 };
    const check = { 1: 1119, 2: 1170, 3: 1224, 4: 1277, 5: 1328, 6: 1381, 7: 1439, 8: 1486, 9: 1541, 10: 1586, 11: 1638, 12: 1682 };
    const cabs = ['#c0392b', '#2e5c8a', '#e0e0e0', '#2f7d4a', '#7a7a7a'];
    const parked = (x, y, n) => add(truck(118, cabs[Math.floor(rnd() * cabs.length)]), {
      kind: 'Camión', name: `Camión parqueado`, process: `Parqueadero · puesto ${n}`, at: [x, y], dir: [1, 0], state: 'Parqueado',
      info: () => [['Puesto', n], ['Estado', 'En espera de turno']],
    });
    for (const [n, y] of Object.entries(east)) if (+n !== 20 && +n !== 25 && rnd() < 0.6) parked(1490, y, n);
    for (const [n, y] of Object.entries(check)) if (+n !== 6 && +n < 11 && rnd() < 0.5) parked(975, y, n);
    const visit = (n, y, x, wait, delay, cab) => add(truck(118, cab), {
      kind: 'Camión', name: `Camión visitante`, process: `Parqueadero · puesto ${n}`, at: IN, hidden: true, steps: [
        { t: 'wait', s: delay }, { t: 'tp', p: IN, dir: [0, -1] }, { t: 'show', state: 'Ingresando por portería' },
        { t: 'move', pts: x > 1100 ? [[828, 1080], [1330, 1080], [1330, y - 30], [1350, y], [x, y]] : [[828, y + 70], [850, y], [x, y]], speed: 60, smooth: true },
        { t: 'wait', s: wait, state: 'Parqueado' },
        { t: 'move', pts: [[x > 1100 ? 1340 : 850, y]], speed: 20, rev: true, state: 'Saliendo' },
        { t: 'move', pts: x > 1100 ? [[1330, y - 40], [1330, 1080], [755, 1080], OUT] : [[828, y - 60], [790, 1075], [755, 1110], OUT], speed: 60, smooth: true },
        { t: 'hide', state: 'Fuera del CD' }, { t: 'wait', s: 6 },
      ],
      info: () => [['Puesto', n]],
    });
    visit(20, 1297, 1490, 14, 5, '#2f7d4a');
    visit(25, 1029, 1490, 20, 16, '#7a7a7a');
    visit(6, 1381, 975, 10, 26, '#c0392b');

    // sorting y envase
    const env = site.blocks.filter(b => b.name === 'Zona de envase');
    shuttle({
      name: 'MC-05', process: 'Sorting de envase', home: [240, 960], go: 'Recogiendo envase', back: 'Llevando a sorting', cls: 'E',
      pick: () => { const x = between(env[0]); return { pre: [x, env[0].bbox[1] - 34], at: [x, env[0].bbox[1] - 14] }; },
      drop: () => ({ pre: [262, 880], at: [236, 880] }),
    });
    const carpa = ['E01', 'E02', 'E03', 'E05', 'E06', 'E07', 'E08', 'E09'].map(block).filter(Boolean);
    shuttle({
      name: 'MC-06', process: 'Reubicación carpa → envase', home: [420, 1430], go: 'Hacia carpa', back: 'Hacia zona de envase', cls: 'E',
      pick: () => { const b = carpa[Math.floor(rnd() * 4)]; const x = between(b, 8); return { pre: [x, b.bbox[1] - 30], at: [x, b.bbox[1] - 13] }; },
      drop: () => { const b = env[Math.floor(rnd() * env.length)]; const y = (b.bbox[1] + b.bbox[3]) / 2; return { pre: [b.bbox[2] + 34, y], at: [b.bbox[2] + 14, y] }; },
    });
  }

  if (site.id === 'magangue') {
    const x = 407, rear = 352, L = 160;
    const b = bay({
      label: 'T1', mode: 'cargue', cap: 8, L, cab: '#c0392b', spawn: [10, 74], spawnDir: [1, 0],
      arrive: [[300, 74], [480, 74]],
      backIn: [[440, 90], [x, 140], [x, rear - L / 2]],
      depart: [[x, 110], [x - 30, 55], [300, 40], [10, 40]],
    });
    const a1 = block('A1');
    bayForklift(b, {
      name: 'MC-01', stage: [398, 398], unload: [398, rear + 16], side: 1,
      rackX: () => between(a1, 10), rackPre: a1.bbox[1] - 32, rackPick: a1.bbox[1] - 14,
    });
    const env = site.blocks.filter(bb => bb.name === 'Zona de envase');
    shuttle({
      name: 'MC-02', process: 'Envase → sorting', home: [500, 300], go: 'Recogiendo envase', back: 'Llevando a sorting', cls: 'E',
      pick: () => { const bb = env[1]; const y = bb.bbox[1] + 10 + rnd() * (bb.bbox[3] - bb.bbox[1] - 20); return { pre: [bb.bbox[0] - 32, y], at: [bb.bbox[0] - 14, y] }; },
      drop: () => ({ pre: [500, 165], at: [520, 150] }),
    });
    const bs = ['B3', 'B4', 'B5', 'B6'].map(block);
    shuttle({
      name: 'MC-03', process: 'Picking bodega 2 → MKTP', home: [180, 520], go: 'Picking', back: 'Llevando a marketplace',
      pick: () => { const bb = bs[Math.floor(rnd() * bs.length)]; const y = between({ bbox: [bb.bbox[1], 0, bb.bbox[3]] }, 8); return { pre: [bb.bbox[2] + 34, y], at: [bb.bbox[2] + 13, y] }; },
      drop: () => ({ pre: [180, 425], at: [158, 425] }),
    });
    // calle y río
    const cols = ['#3d6fa8', '#b8b8b8', '#8c2f2f', '#2b2b2b', '#c9a227'];
    for (let i = 0; i < 4; i++) passer(car(cols[i]), { kind: 'Vehículo', name: 'Vehículo', process: 'Vía principal (occidente)', route: [[620, 40], [8, 40]], speed: 70 + rnd() * 30, delay: i * 4.5 + rnd() * 2, gap: 6 + rnd() * 6 });
    for (let i = 0; i < 3; i++) passer(i === 1 ? truck(110, '#2e5c8a') : car(cols[i + 2]), { kind: 'Vehículo', name: 'Vehículo', process: 'Vía principal (oriente)', route: [[8, 74], [620, 74]], speed: 60 + rnd() * 30, delay: 3 + i * 6, gap: 8 + rnd() * 6 });
    passer(barge(), { kind: 'Barcaza', name: 'Barcaza', process: 'Río Magdalena', route: [[80, 858], [550, 858]], speed: 14, gap: 5 });
  }

  populateSectors(sim, site, add, rnd);

  sim.update = dt => { sim.t += dt; for (const a of sim.actors) a.update(dt); for (const f of sim.props) f(sim.t, dt); };
  sim.pickables = () => sim.actors.filter(a => a.obj.visible).map(a => a.obj);
  return sim;
}

// ---------- personas, equipos y actividad por sector ----------
const SKIN = ['#8d5a3b', '#b07850', '#c99a6e', '#6e4630'];
let skinIx = 0;
function person(vest = '#ff7a1a', helmet = '#f5f5f5') {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const limb = (y, z, h, c) => { const p = new THREE.Group(); p.position.set(0, y, z); p.add(box(2.2, h, 2.2, c, 0, -h / 2, 0)); body.add(p); return p; };
  const L = [limb(9, 1.4, 9, '#2b3a55'), limb(9, -1.4, 9, '#2b3a55')];
  const A = [limb(15.6, 4, 7.5, vest), limb(15.6, -4, 7.5, vest)];
  body.add(box(3.6, 7, 6, vest, 0, 12.5, 0), box(3.7, 0.9, 6.1, '#e6e6e6', 0, 11.2, 0));
  const head = new THREE.Mesh(new THREE.SphereGeometry(2.3, 12, 10), mat(SKIN[skinIx++ % SKIN.length]));
  head.position.y = 18.4; head.castShadow = true;
  const hat = new THREE.Mesh(new THREE.SphereGeometry(2.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(helmet));
  hat.position.y = 18.9; body.add(head, hat);
  const carry = box(5, 4, 6, '#a07a4a', 4.6, 12.5, 0); carry.visible = false; body.add(carry);
  let phase = Math.random() * 6;
  g.userData = { carry, animate(a) {
    const t = a.sim.t;
    carry.visible = a.carry; body.position.y = 0;
    let l = 0, a0 = 0, a1 = 0;
    if (a.mode === 'sit') { body.position.y = -4.5; L[0].rotation.z = L[1].rotation.z = 1.5; A[0].rotation.z = A[1].rotation.z = 0.5; return; }
    if (a.moved > 0) { phase += a.moved * 0.33; const s = Math.sin(phase); l = s * 0.6; a0 = -s * 0.5; a1 = s * 0.5; }
    else if (a.mode === 'work') { a0 = 1 + Math.sin(t * 7) * 0.45; a1 = 1 + Math.sin(t * 7 + 1.6) * 0.45; }
    else if (a.mode === 'talk') { a0 = 0.7 + Math.sin(t * 3) * 0.5; }
    if (a.carry || a.push) a0 = a1 = a.push ? 1 : 1.3;
    L[0].rotation.z = l; L[1].rotation.z = -l; A[0].rotation.z = a0; A[1].rotation.z = a1;
  } };
  return g;
}

// operario empujando estibador manual (gato)
function jackOperator(vest) {
  const g = new THREE.Group(), p = person(vest);
  p.position.x = -9; g.add(p);
  const handle = box(1, 12, 1, '#333', -4, 6, 0); handle.rotation.z = -0.35;
  g.add(handle, box(3, 3, 9, '#c62828', -2, 2, 0), box(16, 1.2, 2, '#c62828', 6.5, 1, 3), box(16, 1.2, 2, '#c62828', 6.5, 1, -3));
  const load = new THREE.Group(), cargo = box(13, 8, 11, '#7cc24a', 6.5, 7.2, 0);
  load.add(box(14, 1.4, 12, '#8a6a3c', 6.5, 2.4, 0), cargo); load.visible = false; g.add(load);
  g.userData = { load, cargo, animate(a, dt) { a.push = true; p.userData.animate(a, dt); } };
  return g;
}

const cyl = (r, h, c, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), mat(c)); m.position.set(x, y, z); m.castShadow = true; return m;
};
function table(w = 30) {
  const g = new THREE.Group();
  g.add(box(w, 1.2, 10, '#9aa3ab', 0, 8, 0));
  for (const [x, z] of [[w / 2 - 1, 4], [w / 2 - 1, -4], [-w / 2 + 1, 4], [-w / 2 + 1, -4]]) g.add(box(1, 8, 1, '#555', x, 4, z));
  for (let i = 0; i < 3; i++) g.add(box(5, 3, 5, ['#c9a227', '#3a7d44', '#8a6a3c'][i], -w / 2 + 6 + i * 9, 10.1, 0));
  return g;
}
const palletStackMeshes = (g, n, x = 0) => Array.from({ length: n }, (_, i) => { const m = box(12, 1.6, 12, '#8a6a3c', x, 0.8 + i * 1.9, 0); g.add(m); return m; });

function populateSectors(sim, site, add, rnd) {
  const R = site.id === 'magangue' ? 14 : 34;
  const place = (obj, x, y, rot = 0) => { obj.position.set(x - sim.cx, 0, y - sim.cz); obj.rotation.y = rot; sim.world.add(obj); return obj; };
  const roles = {};
  const NORTH = Math.PI / 2;   // rotación de un modelo para mirar hacia -y del plano
  for (const sec of site.sectors) {
    const nm = sec.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const P = (dx, dy) => [sec.x + dx * R, sec.y + dy * R];
    const crew = [];
    let act = 'Operación del área';
    const who = (role, vest, helmet, o) => {
      const a = add(o.jack ? jackOperator(vest) : person(vest, helmet), {
        kind: role, name: `${role} ${(roles[role] = (roles[role] || 0) + 1)}`, process: `${sec.n}. ${sec.name}`,
        at: o.at, dir: o.dir || [1, 0], turnInPlace: true, mode: o.mode, state: o.state || 'En el puesto', steps: o.steps || [],
        info: () => [['Sector', `${sec.n}. ${sec.name}`], ['Actividad', act]],
      });
      if (o.carryColor) a.obj.userData.carry.material = mat(o.carryColor);
      crew.push(role); return a;
    };
    const walk = (pts, state, speed = 15) => ({ t: 'move', pts, speed, state });
    const work = (s, state) => ({ t: 'work', s, state });
    const wait = (s, state) => ({ t: 'wait', s, state });
    const carrier = (role, vest, from, to, sGo, sBack, color) => who(role, vest, '#f5f5f5', {
      at: from, carryColor: color, steps: [work(2 + rnd() * 2, 'Tomando carga'), { t: 'carry', on: true }, walk([to], sGo),
        { t: 'carry', on: false }, work(1.5, 'Descargando'), walk([from], sBack), wait(1 + rnd() * 2, 'En el puesto')],
    });
    const station = (role, vest, at, rot, n, state) => {
      place(table(30), at[0], at[1], rot);
      const c = Math.cos(rot), s = Math.sin(rot);   // ejes locales de la mesa en el plano
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1, along = -9 + Math.floor(i / 2) * 14 + (i % 2) * 5;
        const x = at[0] + c * along - s * side * 9, y = at[1] - s * along - c * side * 9;
        who(role, vest, '#f5f5f5', { at: [x, y], dir: [s * side, c * side], steps: [work(4 + rnd() * 3, state), wait(0.6 + rnd(), state)] });
      }
    };
    const patrol = (role, vest, helmet, pts, speed, stops) => who(role, vest, helmet, {
      at: pts[0], steps: pts.slice(1).concat([pts[0]]).flatMap((p, i) => [walk([p], stops[0], speed), i % 2 ? work(2.5, stops[1]) : wait(1.5, stops[0])]),
    });

    if (/vigilancia|garita/.test(nm)) {
      act = 'Ronda de vigilancia';
      patrol('Vigilante', '#1f2a44', '#1f2a44', [P(-1.5, 0.3), P(1.5, 0.3), P(1.5, 1.2), P(-1.5, 1.2)], 11, ['Ronda', 'Observando']);
    } else if (/sorting/.test(nm)) {
      act = 'Clasificación de envase';
      station('Operario de sorting', '#ff7a1a', P(1.4, 0.5), 0, 3, 'Clasificando');
      carrier('Auxiliar de sorting', '#ff7a1a', P(2.9, 0.5), P(2.9, 1.9), 'Llevando canasta', 'Regresando', '#c9a227');
    } else if (/reempaque/.test(nm)) {
      act = 'Reempaque de producto';
      const rot = site.id === 'corozal' ? NORTH : 0;
      station('Operario de reempaque', '#ff7a1a', P(site.id === 'corozal' ? -0.8 : 0.9, 0.9), rot, 2, 'Reempacando');
      carrier('Auxiliar de reempaque', '#ff7a1a', P(-0.2, 2.2), P(-0.2, 3.2), 'Llevando cajas', 'Regresando', '#a07a4a');
    } else if (/estibadores|picking|cambios|devoluci|marketplace/.test(nm)) {
      act = { estibadores: 'Movimiento con estibador manual', picking: 'Picking con estibador manual', cambios: 'Cambios de producto', devoluci: 'Recepción de devoluciones', marketplace: 'Alistamiento marketplace' }[nm.match(/estibadores|picking|cambios|devoluci|marketplace/)[0]];
      who('Auxiliar de bodega', '#ff7a1a', '#f5f5f5', { jack: true, at: P(-1.6, 0.7), steps: [
        () => ({ t: 'load', cls: 'ABC'[Math.floor(rnd() * 3)] }), walk([P(1.6, 0.7)], 'Trasladando estiba', 12), { t: 'unload' },
        wait(2, 'Ubicando estiba'), walk([P(-1.6, 0.7)], 'Regresando', 15), wait(2, 'Tomando estiba')] });
      if (/devoluci/.test(nm)) who('Supervisor', '#2e5c8a', '#f5f5f5', { at: P(0, -0.8), dir: [0, 1], steps: [work(3, 'Verificando devolución'), wait(2, 'Verificando devolución')] });
    } else if (/parqueadero de flt/.test(nm)) {
      act = 'Parqueo y carga de montacargas';
      for (let i = 0; i < 3; i++) {
        const f = place(forklift(), sec.x + (i - 1) * 18, sec.y + 32, NORTH);
        if (i === 2) {
          const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), new THREE.MeshStandardMaterial({ color: '#ff8a00', emissive: '#ff8a00' }));
          beacon.position.set(-1, 22.6, 0); f.add(beacon);
          sim.props.push(t => { beacon.material.emissiveIntensity = Math.sin(t * 6) > 0 ? 1.6 : 0.1; });
          f.add(box(5, 9, 5, '#2b6cb0', -14, 4.5, 0));   // cargador
        }
      }
      who('Operador de montacargas', '#2f7d4a', '#f2c200', { at: P(1.9, 0.6), steps: [walk([[sec.x - 18, sec.y + 52]], 'Hacia montacargas'),
        work(4, 'Inspección preoperacional'), walk([P(1.9, 0.6)], 'Regresando'), wait(5, 'En espera')] });
    } else if (/flt|taller monta|mtto/.test(nm)) {
      act = 'Mantenimiento autónomo de montacargas';
      const fx = sec.x + 30, fy = sec.y, f = place(forklift(), fx, fy, 0);
      sim.props.push(t => { f.userData.carriage.position.y = 1.6 + (Math.sin(t * 0.8) + 1) * 9; });
      place(box(8, 5, 5, '#c62828', 0, 2.5, 0), fx - 6, fy + 16);
      who('Mecánico', '#1d4f91', '#f5f5f5', { at: [fx - 2, fy + 14], dir: [0, -1], steps: [work(5, 'Ajustando'), walk([[fx + 14, fy + 12]], 'Revisando', 10),
        work(4, 'Lubricando'), walk([[fx - 2, fy + 14]], 'Revisando', 10)] });
    } else if (/t2/.test(nm)) {
      if (/auxiliar/.test(nm)) {
        act = 'Parqueo de camiones T2';
        [1447, 1536, 1584].forEach(x => place(truck(118, '#e0e0e0'), x + 14, 250, -NORTH));
        patrol('Conductor', '#3a3a3a', '#3a3a3a', [[1470, 330], [1470, 180], [1560, 180]], 13, ['Caminando', 'Revisando camión']);
      } else {
        act = 'Operación autónoma de camión T2';
        const tx = sec.x + 20, ty = sec.y + 2;
        place(truck(118, '#e0e0e0'), tx, ty, 0);
        patrol('Mecánico', '#1d4f91', '#f5f5f5', [[tx - 66, ty - 22], [tx + 66, ty - 22], [tx + 66, ty + 22], [tx - 66, ty + 22]], 10, ['Revisando', 'Revisión de llantas y niveles']);
      }
    } else if (/bloquead|bloqueo|pfn/.test(nm)) {
      act = /pfn/.test(nm) ? 'Revisión de producto fuera de norma' : 'Control de producto bloqueado';
      patrol('Inspector de calidad', '#2e5c8a', '#f5f5f5', [P(-1.2, 0.5), P(1.2, 0.5), P(1.2, 1.2), P(-1.2, 1.2)], 9, ['Inspeccionando', 'Registrando hallazgo']);
    } else if (/^estibas|estibas en buen/.test(nm)) {
      act = 'Clasificación y apilado de estibas';
      const g = place(new THREE.Group(), sec.x, sec.y + R * 0.9);
      const A = palletStackMeshes(g, 10, -R), B = palletStackMeshes(g, 10, R);
      let na = 7, nb = 2;
      const show = () => { A.forEach((m, i) => { m.visible = i < na; }); B.forEach((m, i) => { m.visible = i < nb; }); };
      show();
      const pa = [sec.x - R + 9, sec.y + R * 0.9], pb = [sec.x + R - 9, sec.y + R * 0.9];
      const leg = (from, to, d) => [walk([from], 'Hacia la pila'), work(1.2, 'Tomando estiba'), { t: 'do', fn: () => { na -= d; show(); } },
        { t: 'carry', on: true }, walk([to], 'Llevando estiba', 11), { t: 'carry', on: false }, { t: 'do', fn: () => { nb += d; show(); } }, work(1, 'Apilando')];
      const steps = [];
      for (let i = 0; i < 5; i++) steps.push(...leg(pa, pb, 1));
      for (let i = 0; i < 5; i++) steps.push(...leg(pb, pa, -1));
      who('Auxiliar de estibas', '#ff7a1a', '#f5f5f5', { at: pa, carryColor: '#8a6a3c', steps });
    } else if (/glp|combustible|cilindro/.test(nm)) {
      act = 'Cambio de cilindros de GLP';
      const g = place(new THREE.Group(), sec.x + R, sec.y);
      for (let i = 0; i < 6; i++) g.add(cyl(1.8, 9, '#d35400', -6 + (i % 3) * 5, 4.5, i < 3 ? -3 : 3));
      g.add(box(18, 0.8, 12, '#777', 0, 12, 0));
      carrier('Operario GLP', '#2f7d4a', [sec.x + R, sec.y + 12], P(1, 2), 'Llevando cilindro', 'Regresando', '#d35400');
    } else if (/vertimiento/.test(nm)) {
      act = 'Disposición controlada de líquidos';
      const pivot = place(new THREE.Group(), sec.x + R, sec.y + 6);
      pivot.add(cyl(3.5, 9, '#2e5c8a', 0, 4.5, 0), box(10, 0.4, 10, '#222', 6, 0.2, 0));
      sim.props.push(t => { pivot.rotation.z = -Math.max(0, Math.sin(t * 0.6)) * 0.9; });
      who('Operario ambiental', '#2f7d4a', '#f5f5f5', { at: [sec.x + R - 10, sec.y + 6], dir: [1, 0], steps: [work(6, 'Vertiendo'), wait(3, 'Supervisando')] });
    } else if (/tanque/.test(nm)) {
      act = 'Inspección de tanque de agua';
      const pts = Array.from({ length: 8 }, (_, i) => [sec.x + Math.cos(i * Math.PI / 4) * R * 1.4, sec.y + Math.sin(i * Math.PI / 4) * R * 1.4]);
      patrol('Técnico', '#c62828', '#f5f5f5', pts, 10, ['Ronda', 'Leyendo nivel']);
    } else if (/incendio/.test(nm)) {
      act = 'Inspección de bomba contra incendio';
      const g = place(new THREE.Group(), sec.x + R * 0.8, sec.y + 4);
      const motor = cyl(3.5, 12, '#c62828', 0, 5, 0); motor.rotation.z = Math.PI / 2;
      const rotor = new THREE.Group(); rotor.position.set(8, 5, 0);
      const disc = cyl(4.5, 1.2, '#888'); disc.rotation.z = Math.PI / 2;
      rotor.add(disc, box(1.4, 8, 1.4, '#444', 0.8, 0, 0));
      g.add(box(18, 2, 9, '#555', 0, 1, 0), motor, rotor);
      sim.props.push((t, dt) => { rotor.rotation.x += dt * 9; });
      who('Técnico', '#c62828', '#f5f5f5', { at: [sec.x + R * 0.8 - 4, sec.y + 14], dir: [0, -1], steps: [work(4, 'Leyendo manómetro'), wait(3, 'Verificando bomba')] });
    } else if (/acopio/.test(nm)) {
      act = 'Separación de residuos reciclables';
      ['#2b6cb0', '#7a7a7a', '#2f7d4a'].forEach((c, i) => place(box(7, 9, 7, c, 0, 4.5, 0), sec.x + R + i * 9, sec.y));
      carrier('Operario de acopio', '#2f7d4a', P(-1.2, 0.8), [sec.x + R + 9, sec.y + 9], 'Llevando residuos', 'Regresando', '#e8e8e8');
    } else if (/dado de baja/.test(nm)) {
      act = 'Destrucción de producto dado de baja';
      place(box(30, 14, 14, '#7a2e2e', 0, 7, 0), sec.x - R, sec.y + 4);
      carrier('Operario', '#ff7a1a', P(0.8, 1), [sec.x - R + 18, sec.y + 4], 'Llevando producto', 'Regresando', '#a07a4a');
    } else if (/cigarr|epp/.test(nm)) {
      act = /epp/.test(nm) ? 'Entrega de EPP' : 'Alistamiento de cigarrillos';
      place(box(4, 16, 16, '#6f6f6f', 0, 8, 0), sec.x - R, sec.y);
      carrier(/epp/.test(nm) ? 'Auxiliar SST' : 'Auxiliar de bodega', '#ff7a1a', [sec.x - R + 6, sec.y], P(1, 0.6), 'Llevando cajas', 'Regresando', '#a07a4a');
    } else if (/sustancias|quimic/.test(nm)) {
      act = 'Manejo de sustancias químicas';
      place(cyl(3.5, 9, '#2e5c8a', 0, 4.5, 0), sec.x - R * 0.6, sec.y); place(cyl(3.5, 9, '#2f7d4a', 0, 4.5, 0), sec.x - R * 0.6 + 8, sec.y);
      carrier('Operario', '#7a4fbf', [sec.x - R * 0.6 + 4, sec.y + 9], P(1.2, 1), 'Trasladando sustancia', 'Regresando', '#2e5c8a');
    } else if (/espera conductores/.test(nm)) {
      act = 'Espera de conductores';
      place(box(18, 4, 5, '#7a5a3a', 0, 2, 0), sec.x + R, sec.y + 6);
      for (const dx of [-5, 5]) who('Conductor', '#3a3a3a', '#3a3a3a', { at: [sec.x + R + dx, sec.y + 2], dir: [0, 1], mode: 'sit', state: 'Esperando turno' });
      who('Conductor', '#3a3a3a', '#3a3a3a', { at: P(2.4, 0.5), steps: [walk([P(2.4, -2)], 'Hacia su camión', 13), wait(4, 'Revisando documentos'), walk([P(2.4, 0.5)], 'Regresando', 13), wait(6, 'Esperando turno')] });
    } else if (/primeros auxilios/.test(nm)) {
      act = 'Punto de atención de brigada';
      place(box(6, 6, 3, '#f2f2f2', 0, 10, 0), sec.x + R * 0.6, sec.y);
      patrol('Brigadista', '#c62828', '#f5f5f5', [P(0.6, 0.6), P(-0.8, 0.6)], 8, ['Atento', 'Revisando botiquín']);
    } else if (/cafeter/.test(nm)) {
      act = 'Pausa activa / alimentación';
      for (const dx of [-1, 1]) {
        const tx = sec.x + dx * R, ty = sec.y - R * 0.6;
        place(box(12, 1, 8, '#9a7b55', 0, 7, 0), tx, ty);
        for (const dz of [-1, 1]) who('Colaborador', ['#ff7a1a', '#2f7d4a', '#2e5c8a', '#c9a227'][Math.floor(rnd() * 4)], '#f5f5f5', { at: [tx, ty + dz * 7], dir: [0, -dz], mode: 'sit', state: 'En pausa' });
      }
      who('Colaborador', '#ff7a1a', '#f5f5f5', { at: P(-2, 0.5), steps: [walk([P(2, 0.5)], 'Entrando', 12), wait(5, 'En pausa'), walk([P(-2, 0.5)], 'Saliendo', 12), wait(4, 'Fuera')] });
    } else if (/team room/.test(nm)) {
      act = 'Reunión de equipo';
      const c = P(0.8, 0);
      for (let i = 0; i < 4; i++) {
        const an = i * Math.PI / 2, x = c[0] + Math.cos(an) * 9, y = c[1] + Math.sin(an) * 9;
        who(i ? 'Colaborador' : 'Líder de turno', i ? '#ff7a1a' : '#2e5c8a', '#f5f5f5', { at: [x, y], dir: [-Math.cos(an), -Math.sin(an)], state: 'En reunión',
          steps: i ? [] : [{ t: 'mode', m: 'talk' }, wait(6, 'Presentando indicadores'), { t: 'mode', m: 'idle' }, wait(3, 'Escuchando')] });
      }
    } else if (/oficina/.test(nm)) {
      act = 'Trabajo administrativo';
      place(box(14, 1, 8, '#9a7b55', 0, 8, 0), sec.x + R, sec.y);
      who('Administrativo', '#5b6b7a', '#5b6b7a', { at: [sec.x + R, sec.y + 7], dir: [0, -1], mode: 'sit', state: 'En escritorio' });
      who('Administrativo', '#5b6b7a', '#5b6b7a', { at: P(-1.5, 0.8), steps: [walk([P(1.5, 0.8)], 'Caminando', 12), wait(4, 'Consultando'), walk([P(-1.5, 0.8)], 'Caminando', 12), wait(5, 'En puesto')] });
    } else if (/banos/.test(nm)) {
      act = 'Servicios sanitarios';
      who('Colaborador', '#ff7a1a', '#f5f5f5', { at: P(-1.5, 0.6), steps: [walk([P(0.5, 0.6)], 'Entrando', 12), { t: 'hide' }, wait(6, 'En baño'), { t: 'show' }, walk([P(-1.5, 0.6)], 'Saliendo', 12), wait(8, 'Fuera')] });
    } else if (/banco/.test(nm)) {
      act = 'Atención bancaria';
      for (let i = 0; i < 3; i++) who('Cliente', ['#2e5c8a', '#3a3a3a', '#c9a227'][i], '#f5f5f5', { at: P(-0.6 - i * 0.6, 0.6), dir: [1, 0], state: 'En fila' });
      who('Cliente', '#7a4fbf', '#f5f5f5', { at: P(0.4, 0.6), dir: [1, 0], steps: [wait(5, 'En ventanilla'), walk([P(0.4, 1.6), P(-2.5, 1.6)], 'Saliendo', 12), wait(4, 'Fuera'), walk([P(-2.5, 0.6), P(0.4, 0.6)], 'Regresando', 12)] });
    } else if (/planta electrica/.test(nm)) {
      act = 'Generación de respaldo';
      const g = place(new THREE.Group(), sec.x + R * 0.4, sec.y + 4);
      const gen = box(24, 12, 12, '#4a5a4a', 0, 6, 0); g.add(gen, cyl(1, 8, '#333', 8, 16, 3));
      const puffs = Array.from({ length: 6 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(2, 8, 6), new THREE.MeshBasicMaterial({ color: '#9a9a9a', transparent: true })); g.add(m); return m; });
      sim.props.push(t => {
        gen.position.x = Math.sin(t * 60) * 0.25;
        puffs.forEach((m, i) => { const k = (t * 0.5 + i / 6) % 1; m.position.set(8 + k * 6, 20 + k * 22, 3); m.scale.setScalar(0.6 + k * 2); m.material.opacity = 0.55 * (1 - k); });
      });
      who('Técnico', '#c62828', '#f5f5f5', { at: [sec.x + R * 0.4, sec.y + 18], dir: [0, -1], steps: [work(4, 'Revisando tablero'), wait(4, 'Supervisando')] });
    } else {
      patrol('Operario', '#ff7a1a', '#f5f5f5', [P(-1, 0.6), P(1, 0.6)], 10, ['Recorriendo', 'Trabajando']);
    }
    const count = crew.reduce((m, r) => { m[r] = (m[r] || 0) + 1; return m; }, {});
    const plural = (r, n) => n === 1 ? r : r.replace(/^(\S+)/, w => w + (/[aeiouáéíóú]$/i.test(w) ? 's' : 'es'));
    sim.sectorInfo[sec.n] = { act, crew: Object.entries(count).map(([r, n]) => `${n} ${plural(r, n).toLowerCase()}`).join(' · ') };
  }
}
