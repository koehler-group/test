'use strict';

// ============================================================
//  München Turbo – mit dem Porsche vom Marienplatz zum Olympiapark
// ============================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = 960, H = 540;
const DPR = Math.min(2, window.devicePixelRatio || 1);
canvas.width = W * DPR;
canvas.height = H * DPR;

const PIXEL = '"Press Start 2P", monospace';
const SANS = '"Segoe UI", system-ui, sans-serif';

let FINISH = 60000;
const CITY_BASE = 345;
const ROAD_TOP = 372, ROAD_BOTTOM = 522;
const laneY = l => 405 + l * 45;
const laneScale = l => 0.86 + l * 0.08;
const PX_TO_KMH = 0.2;
const CAR_HALF = 52;
const GRAVITY = 1600;
const JUMP_V = 520;

const ZONES = [
  { x: 0, name: 'Marienplatz' },
  { x: 9000, name: 'Odeonsplatz' },
  { x: 18000, name: 'Englischer Garten' },
  { x: 30000, name: 'Leopoldstraße' },
  { x: 42000, name: 'Schwabing' },
  { x: 50000, name: 'Olympiapark' },
];
const MAIBAEUME = [2500, 24000, 46000];

// Stadt-Hintergrund (Parallax-Ebene)
const CITY_PARALLAX = 0.35;
const LANDMARKS = [
  { x: 430, w: 240, draw: drawRathaus },
  { x: 1790, w: 180, draw: drawFrauenkirche },
  { x: 3890, w: 220, draw: drawTheatiner },
  { x: 7740, w: 140, draw: drawChinaTurm },
  { x: 11590, w: 210, draw: drawSiegestor },
  { x: 20800, w: 360, draw: drawOlympia },
  { x: 21250, w: 320, draw: drawArena },
];
const PARK = [7000, 9000]; // Englischer Garten: Bäume statt Häuser

// Streckenlänge: alle Positionen oben gelten für die Grundstrecke und werden mitskaliert.
// 1 px = 1/18 m (passend zu PX_TO_KMH), Grundstrecke 60000 px ≈ 3333 m.
const PX_PER_M = 3.6 / PX_TO_KMH;
const BASE_FINISH = FINISH;
const BASE_POS = {
  zones: ZONES.map(z => z.x), maibaeume: [...MAIBAEUME], landmarks: LANDMARKS.map(l => l.x), park: [...PARK],
};
let trackLengthM = Math.round(BASE_FINISH / PX_PER_M);
function applyTrackLength() {
  FINISH = Math.round(clamp(trackLengthM, 2000, 10000) * PX_PER_M);
  const s = FINISH / BASE_FINISH;
  ZONES.forEach((z, i) => { z.x = BASE_POS.zones[i] * s; });
  LANDMARKS.forEach((l, i) => { l.x = BASE_POS.landmarks[i] * s; });
  BASE_POS.maibaeume.forEach((x, i) => { MAIBAEUME[i] = x * s; });
  BASE_POS.park.forEach((x, i) => { PARK[i] = x * s; });
}

// ---------- Hilfsfunktionen ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const pick = (rnd, arr) => arr[(rnd() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

function tri(x1, y1, x2, y2, x3, y3, col) {
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
}
function circle(x, y, r, col) {
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
function archWindow(x, y, w, h) {
  ctx.fillRect(x, y + w / 2, w, h - w / 2);
  ctx.beginPath(); ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); ctx.fill();
}
function text(str, x, y, size, fill = '#fff', align = 'center', font = PIXEL) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size / 4);
  ctx.strokeStyle = '#10202f';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(str, x, y);
}
function panel(x, y, w, h, alpha = 0.72) {
  ctx.fillStyle = `rgba(16,32,47,${alpha})`;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
}
function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
function loadHigh() { try { return +localStorage.getItem('muc-turbo-high') || 0; } catch { return 0; } }
function saveHigh(v) { try { localStorage.setItem('muc-turbo-high', String(v)); } catch { /* egal */ } }
function loadName() { try { return localStorage.getItem('muc-turbo-name') || ''; } catch { return ''; } }
function saveName(v) { try { localStorage.setItem('muc-turbo-name', v); } catch { /* egal */ } }

// ---------- Online-Bestenliste (Supabase) ----------
const SB = window.SUPABASE_CONFIG || {};
const ONLINE = !!(SB.url && SB.anonKey);
let leaderboard = [], lbStatus = ONLINE ? 'loading' : 'off';
let entry = null; // Namenseingabe nach dem Rennen: { name, state: 'typing' | 'sending' | 'done' | 'skipped' | 'error' }

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SB.url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB.anonKey, 'Content-Type': 'application/json', ...opts.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 || res.status === 201 ? null : res.json();
}

async function loadLeaderboard() {
  if (!ONLINE) return;
  try {
    leaderboard = await sbFetch('highscores?select=name,score,race_time,place&order=score.desc,race_time.asc&limit=10');
    lbStatus = 'ok';
  } catch (e) {
    console.warn('Bestenliste konnte nicht geladen werden:', e);
    lbStatus = 'error';
  }
}

// Spiel-Einstellungen aus der Tabelle "config" (key → value)
async function loadConfig() {
  if (!ONLINE) return;
  try {
    const rows = await sbFetch('config?select=key,value');
    const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
    if (Number.isFinite(+cfg.track_length_m)) trackLengthM = +cfg.track_length_m;
    if (state === 'menu') setupRace();
  } catch (e) {
    console.warn('Config konnte nicht geladen werden, nutze Standardwerte:', e);
  }
}

async function submitScore() {
  const name = entry.name.trim();
  entry.state = 'sending';
  try {
    await sbFetch('highscores', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        name, score: result.total, race_time: +result.time.toFixed(2), place: result.place,
        track_length_m: Math.round(FINISH / PX_PER_M),
      }),
    });
    saveName(name);
    entry.state = 'done';
    await loadLeaderboard();
  } catch (e) {
    console.warn('Highscore konnte nicht gespeichert werden:', e);
    entry.state = 'error';
  }
}

// Tastatur während der Namenseingabe; true = Taste wurde verbraucht
function handleNameKey(e) {
  if (state !== 'results' || !entry || !['typing', 'error'].includes(entry.state)) return false;
  if (e.key === 'Enter') { if (entry.name.trim()) submitScore(); return true; }
  if (e.key === 'Escape') { entry.state = 'skipped'; return true; }
  if (e.key === 'Backspace') { e.preventDefault(); entry.name = entry.name.slice(0, -1); return true; }
  if (e.key.length === 1) {
    e.preventDefault();
    if (/[\p{L}\p{N} ._-]/u.test(e.key) && entry.name.length < 12) entry.name += e.key;
    entry.state = 'typing';
    return true;
  }
  return false;
}

// ---------- Sound ----------
let actx = null, engine = null, muted = false;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sawtooth'; o.frequency.value = 50; g.gain.value = 0;
    o.connect(g).connect(actx.destination); o.start();
    engine = { o, g };
  } catch { actx = null; }
}
function beep(freq, dur = 0.1, type = 'square', vol = 0.07, slideTo) {
  if (!actx || muted) return;
  const t = actx.currentTime;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function updateEngineSound() {
  if (!engine) return;
  const t = actx.currentTime;
  const on = state === 'race' && !paused && !muted;
  engine.o.frequency.setTargetAtTime(45 + Math.abs(player.speed) * 0.11 + (player.turbo > 0 ? 40 : 0), t, 0.05);
  engine.g.gain.setTargetAtTime(on ? 0.022 : 0, t, 0.08);
}

// ---------- Eingabe ----------
const keys = {};
const GAME_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
addEventListener('keydown', e => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  if (handleNameKey(e)) return;
  if (!keys[e.code]) onPress(e.code);
  keys[e.code] = true;
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

const gasDown = () => keys.ArrowRight || keys.KeyD;
const backDown = () => keys.ArrowLeft || keys.KeyA;

function onPress(code) {
  if (code === 'KeyM') { muted = !muted; return; }
  if (state === 'menu' || state === 'results') {
    if (entry && entry.state === 'sending') return;
    if (code === 'Enter' || code === 'Space') startRace();
    return;
  }
  if (code === 'KeyP' || code === 'Escape') { paused = !paused; return; }
  if (code === 'KeyR') { startRace(); return; }
  if (paused || state !== 'race' || player.finished) return;
  if (code === 'ArrowUp' || code === 'KeyW') changeLane(player, -1);
  if (code === 'ArrowDown' || code === 'KeyS') changeLane(player, 1);
  if (code === 'Space') jump(player);
}

// ---------- Spielzustand ----------
let state = 'menu', paused = false;
let player, racers, items, traffic, fx, floats, finishOrder;
let score, brezn, time, countdown, lastCount, goTimer, resultTimer, shake;
let zoneIndex, zoneBanner, result, menuT = 0, highscore = loadHigh();

function makeCar(name, kind, lane, x, color, max, skill = 1) {
  return {
    name, kind, lane, laneF: lane, x, speed: 0, max, color, skill,
    z: 0, vz: 0, turbo: 0, stun: 0, bumpCd: 0, aiCool: 0, wander: 2 + Math.random() * 3,
    finished: false, finishTime: 0, isPlayer: false,
  };
}

function setupRace() {
  applyTrackLength();
  const rnd = mulberry32((Math.random() * 1e9) | 0);
  player = makeCar('Du (Porsche)', 'porsche', 1, 0, '#d4101e', 920);
  player.isPlayer = true;
  racers = [
    player,
    makeCar('Taxi', 'taxi', 0, 90, '#efe6c4', 850, 0.8),
    makeCar('Weiß-Blau', 'sedan', 2, 90, '#2b6fdc', 880, 0.9),
    makeCar('Schwarzer SUV', 'suv', 1, -150, '#2a2c31', 830, 0.75),
  ];
  items = []; traffic = []; fx = []; floats = []; finishOrder = [];
  generateTrack(rnd);
  score = 0; brezn = 0; time = 0;
  countdown = 3.99; lastCount = 4; goTimer = 0; resultTimer = 0; shake = 0;
  zoneIndex = 0; zoneBanner = null; result = null; paused = false;
}

function startRace() {
  setupRace();
  state = 'countdown';
  zoneBanner = { name: ZONES[0].name, t: 3.5 };
}

function generateTrack(rnd) {
  let x = 1200;
  while (x < FINISH - 600) {
    const r = rnd(), lane = (rnd() * 3) | 0;
    if (r < 0.40) {
      // Reihe Brezn (manchmal in der Luft – Sprung nötig)
      const n = 3 + ((rnd() * 4) | 0), high = rnd() < 0.2;
      for (let i = 0; i < n; i++) items.push({ type: 'brezn', x: x + i * 70, lane, z: high ? 60 : 0 });
      x += n * 70;
    } else if (r < 0.62) {
      items.push({ type: 'cone', x, lane });
      if (rnd() < 0.35) items.push({ type: 'cone', x, lane: (lane + 1 + ((rnd() * 2) | 0)) % 3 });
    } else if (r < 0.72) {
      // Pylone mit Brezn darüber – drüberspringen!
      items.push({ type: 'cone', x, lane });
      items.push({ type: 'brezn', x, lane, z: 75 });
    } else if (r < 0.80) {
      items.push({ type: 'turbo', x, lane, z: 0 });
    } else {
      const bus = rnd() < 0.4;
      traffic.push({
        kind: bus ? 'bus' : 'car', x, lane, len: bus ? 170 : 105,
        speed: bus ? 260 + rnd() * 80 : 320 + rnd() * 160,
        color: pick(rnd, ['#7a8b99', '#c9c9c9', '#8e3b46', '#3d6b4f', '#d9a441']),
      });
    }
    x += 280 + rnd() * 380;
  }
}

// ---------- Fahrzeuglogik ----------
function occupied(lane, x, self) {
  return racers.some(c => c !== self && Math.round(c.laneF) === lane && Math.abs(c.x - x) < CAR_HALF * 2) ||
    traffic.some(t => t.lane === lane && Math.abs(t.x - x) < t.len / 2 + CAR_HALF);
}

function changeLane(c, d) {
  const target = clamp(c.lane + d, 0, 2);
  if (target === c.lane) return;
  if (occupied(target, c.x, c)) {
    if (c.isPlayer) { beep(140, 0.08, 'square', 0.05); shake = 3; }
    return;
  }
  c.lane = target;
  if (c.isPlayer) beep(520, 0.05, 'triangle', 0.05);
}

function jump(c) {
  if (c.z > 0 || c.vz > 0) return;
  c.vz = JUMP_V;
  if (c.isPlayer) beep(330, 0.25, 'square', 0.06, 880);
}

function controlCar(c, gas, back, dt, mod) {
  const max = c.max * mod * (c.turbo > 0 ? 1.45 : 1) * (c.stun > 0 ? 0.55 : 1);
  if (gas) c.speed += (c.speed < 0 ? 1400 : 520) * dt;
  else if (back) c.speed -= (c.speed > 0 ? 1100 : 420) * dt;
  else c.speed -= Math.sign(c.speed) * Math.min(Math.abs(c.speed), 260 * dt);
  if (c.speed > max) c.speed = Math.max(max, c.speed - 900 * dt);
  c.speed = Math.max(c.speed, -260);
  c.turbo = Math.max(0, c.turbo - dt);
  c.stun = Math.max(0, c.stun - dt);
  c.bumpCd = Math.max(0, c.bumpCd - dt);
}

function blocked(lane, x, dist) {
  return items.some(i => i.type === 'cone' && !i.taken && i.lane === lane && i.x > x && i.x < x + dist) ||
    traffic.some(t => t.lane === lane && t.x + t.len / 2 > x - 20 && t.x - t.len / 2 < x + dist);
}
function coneAhead(lane, x, dist) {
  return items.some(i => i.type === 'cone' && !i.taken && i.lane === lane && i.x > x && i.x < x + dist);
}

function ai(c, dt) {
  if (c.finished) { controlCar(c, false, false, dt, 1); return; }
  c.aiCool -= dt;
  c.wander -= dt;
  const look = 180 + c.speed * 0.35;
  if (c.aiCool <= 0 && blocked(c.lane, c.x, look)) {
    c.aiCool = 0.35;
    if (Math.random() < c.skill) {
      const opts = [c.lane - 1, c.lane + 1].filter(l => l >= 0 && l < 3 && !blocked(l, c.x - 60, look) && !occupied(l, c.x, c));
      if (opts.length) c.lane = opts[(Math.random() * opts.length) | 0];
      else if (coneAhead(c.lane, c.x, 140)) jump(c);
    }
  } else if (c.wander <= 0) {
    c.wander = 2 + Math.random() * 3;
    const l = clamp(c.lane + (Math.random() < 0.5 ? -1 : 1), 0, 2);
    if (!blocked(l, c.x - 60, look) && !occupied(l, c.x, c)) c.lane = l;
  }
  // leichtes Gummiband, damit das Rennen spannend bleibt
  const gap = c.x - player.x;
  const mod = gap > 1200 ? 0.93 : gap < -1200 ? 1.08 : 1;
  controlCar(c, true, false, dt, mod);
}

function physics(c, dt) {
  c.laneF += (c.lane - c.laneF) * Math.min(1, dt * 9);
  c.x += c.speed * dt;
  if (c.x < -400) { c.x = -400; c.speed = Math.max(0, c.speed); }
  if (c.z > 0 || c.vz > 0) {
    c.vz -= GRAVITY * dt;
    c.z += c.vz * dt;
    if (c.z <= 0) { c.z = 0; c.vz = 0; }
  }
}

function collisions() {
  for (const c of racers) {
    const gy = laneY(c.laneF);
    // Gegenstände
    for (const it of items) {
      if (it.taken || Math.abs(it.x - c.x) > CAR_HALF + 14 || Math.abs(it.lane - c.laneF) > 0.5) continue;
      if (it.type === 'brezn') {
        if (c.isPlayer && Math.abs(c.z - it.z) < 45) {
          it.taken = true; brezn++; score += 10;
          sparkle(it.x, gy - 20 - it.z, '#ffd84a');
          floatText('+10', it.x, gy - 50 - it.z, '#ffd84a');
          beep(988, 0.08, 'square', 0.05, 1480);
        }
      } else if (it.type === 'turbo') {
        if (c.isPlayer && c.z < 40) {
          it.taken = true; c.turbo = 2.5;
          floatText('WEISSWURST-TURBO!', it.x, gy - 60, '#7fe3ff');
          beep(300, 0.45, 'sawtooth', 0.06, 1200);
        }
      } else if (it.type === 'cone' && c.z < 22) {
        it.taken = true;
        c.speed *= 0.4; c.stun = 0.7;
        fx.push({ type: 'cone', x: it.x, y: gy + 10, vx: Math.max(150, c.speed * 0.6 + 150), vy: -320, g: 1200, life: 1.2, max: 1.2, rot: 0, vr: 12, s: laneScale(it.lane) });
        if (c.isPlayer) { shake = 8; floatText('Autsch!', c.x, gy - 60, '#ff8a5c'); beep(110, 0.2, 'sawtooth', 0.08, 60); }
      }
    }
    // Stadtverkehr
    for (const t of traffic) {
      if (Math.abs(t.lane - c.laneF) > 0.5 || c.z > 35) continue;
      const minD = t.len / 2 + CAR_HALF, dx = c.x - t.x;
      if (Math.abs(dx) >= minD) continue;
      if (dx < 0) { c.x = t.x - minD; c.speed = Math.min(c.speed, t.speed * 0.5); }
      else { c.x = t.x + minD; c.speed = Math.max(c.speed, t.speed); }
      c.stun = 0.5;
      if (c.isPlayer && c.bumpCd <= 0) { c.bumpCd = 0.4; shake = 10; beep(90, 0.22, 'sawtooth', 0.09, 50); floatText('Rumms!', c.x, gy - 60, '#ff8a5c'); }
    }
  }
  // Rennwagen untereinander
  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i], b = racers[j];
      if (Math.abs(a.laneF - b.laneF) > 0.5 || Math.abs(a.z - b.z) > 30) continue;
      const dx = b.x - a.x, minD = CAR_HALF * 2 - 6;
      if (Math.abs(dx) >= minD) continue;
      const [back, front] = dx > 0 ? [a, b] : [b, a];
      const overlap = minD - Math.abs(dx);
      back.x -= overlap / 2; front.x += overlap / 2;
      back.speed = Math.min(back.speed, front.speed * 0.9);
      if ((a.isPlayer || b.isPlayer) && player.bumpCd <= 0) { player.bumpCd = 0.4; shake = 6; beep(150, 0.12, 'square', 0.06, 80); }
    }
  }
}

function onPlayerFinish() {
  const place = finishOrder.indexOf(player) + 1;
  const placeBonus = [500, 300, 150, 50][place - 1];
  const timeBonus = Math.max(0, Math.round((120 * FINISH / BASE_FINISH - time) * 10));
  const total = score + placeBonus + timeBonus;
  const isNew = total > highscore;
  if (isNew) { highscore = total; saveHigh(total); }
  result = { place, placeBonus, timeBonus, total, isNew, time };
  entry = ONLINE ? { name: loadName(), state: 'typing' } : null;
  [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => beep(f, 0.2, 'square', 0.06), i * 140));
}

// ---------- Effekte ----------
function sparkle(x, y, color) {
  for (let i = 0; i < 12; i++) fx.push({ type: 'spark', x, y, vx: rand(-160, 160), vy: rand(-220, -40), g: 500, life: 0.6, max: 0.6, color });
}
function floatText(str, x, y, color) { floats.push({ str, x, y, color, life: 1 }); }

function spawnExhaust(c, dt) {
  const s = laneScale(c.laneF), gy = laneY(c.laneF) + 14 - c.z;
  const rearX = c.x - 56 * s;
  if (c.turbo > 0 && Math.random() < dt * 60) {
    fx.push({ type: 'flame', x: rearX, y: gy - 9 * s, vx: -200, vy: rand(-20, 20), life: 0.15, max: 0.15, size: 7 * s });
  }
  const accel = c.isPlayer ? gasDown() : true;
  if (accel && c.speed > 30 && Math.random() < dt * (c.isPlayer ? 25 : 10)) {
    fx.push({ type: 'smoke', x: rearX, y: gy - 7 * s, vx: rand(-40, 0), vy: rand(-30, -10), life: 0.6, max: 0.6, size: 4 * s });
  }
}

function updateFx(dt) {
  for (const p of fx) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.g) p.vy += p.g * dt;
    if (p.vr) p.rot += p.vr * dt;
  }
  fx = fx.filter(p => p.life > 0);
  for (const f of floats) { f.life -= dt; f.y -= 40 * dt; }
  floats = floats.filter(f => f.life > 0);
  shake = Math.max(0, shake - dt * 30);
  if (zoneBanner && (zoneBanner.t -= dt) <= 0) zoneBanner = null;
  goTimer = Math.max(0, goTimer - dt);
}

// ---------- Update ----------
function update(dt) {
  if (state === 'menu') { menuT += dt; return; }
  updateFx(dt);
  if (state === 'countdown') {
    countdown -= dt;
    const c = Math.ceil(countdown);
    if (c !== lastCount) { lastCount = c; if (c > 0) beep(440, 0.15); }
    if (countdown <= 0) { state = 'race'; goTimer = 0.9; beep(880, 0.4); }
    return;
  }
  if (state !== 'race') return;

  time += dt;
  controlCar(player, !player.finished && gasDown(), !player.finished && backDown(), dt, 1);
  for (const c of racers) if (!c.isPlayer) ai(c, dt);
  for (const t of traffic) if (racers.some(c => Math.abs(t.x - c.x) < 1800)) t.x += t.speed * dt;
  for (const c of racers) { physics(c, dt); spawnExhaust(c, dt); }
  collisions();

  for (const c of racers) {
    if (!c.finished && c.x >= FINISH) {
      c.finished = true; c.finishTime = time; finishOrder.push(c);
      if (c.isPlayer) onPlayerFinish();
    }
  }
  if (zoneIndex + 1 < ZONES.length && player.x >= ZONES[zoneIndex + 1].x) {
    zoneIndex++;
    zoneBanner = { name: ZONES[zoneIndex].name, t: 2.5 };
  }
  if (player.finished && (resultTimer += dt) > 2.5) state = 'results';
}

function ranking() {
  return [...racers].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.x - a.x;
  });
}

// ============================================================
//  Zeichnen
// ============================================================
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const cam = state === 'menu' ? (menuT * 160) % (FINISH - 2000) - 300 : player.x - 300;

  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  drawSky(cam);
  drawAlps(cam);
  drawCity(cam);
  drawStreet(cam);
  drawRoad(cam);
  drawEntities(cam);
  drawFx(cam);
  ctx.restore();

  if (state === 'menu') return drawMenu();
  drawHud();
  if (state === 'countdown') drawCountdown();
  if (goTimer > 0) text('LOS!', W / 2, H / 2 - 40, 64, '#7CFC00');
  if (state === 'results') drawResults();
  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    text('PAUSE', W / 2, H / 2 - 10, 40);
    text('P zum Weiterfahren', W / 2, H / 2 + 40, 12);
  }
}

// ---------- Himmel & Berge ----------
function drawSky(cam) {
  const g = ctx.createLinearGradient(0, 0, 0, CITY_BASE);
  g.addColorStop(0, '#3f91e0');
  g.addColorStop(1, '#d4ecff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, CITY_BASE);
  circle(820, 80, 34, 'rgba(255,240,170,0.35)');
  circle(820, 80, 24, '#fff3b0');

  const off = cam * 0.06, start = Math.floor(off / 260) - 1;
  for (let k = start; k < start + 6; k++) {
    const x = k * 260 - off + hash(k) * 120, y = 40 + hash(k + 50) * 90, s = 0.7 + hash(k + 9) * 0.6;
    circle(x, y, 18 * s, '#fff');
    circle(x + 22 * s, y - 8 * s, 22 * s, '#fff');
    circle(x + 46 * s, y, 18 * s, '#fff');
    ctx.fillRect(x, y, 46 * s, 18 * s);
  }
}

function drawAlps(cam) {
  const off = cam * 0.03, base = 335, start = Math.floor(off / 160) - 2;
  for (let k = start; k < start + 10; k++) {
    const px = k * 160 - off + hash(k) * 60, h = 90 + hash(k + 11) * 110;
    tri(px - 150, base, px, base - h, px + 150, base, '#8fa7c4');
    const sh = h * 0.3, sw = 150 * sh / h;
    tri(px - sw, base - h + sh, px, base - h, px + sw, base - h + sh, '#f4f8ff');
  }
  ctx.fillStyle = 'rgba(220,236,255,0.35)';
  ctx.fillRect(0, 230, W, 115);
}

// ---------- Stadt ----------
const HOUSE_COLORS = ['#e9d8a6', '#f2c6a0', '#d9e4c8', '#f4e3d7', '#e8c07d', '#cfd8e3', '#f0d0c8', '#e6e0cf'];

function drawCity(cam) {
  const off = cam * CITY_PARALLAX, HW = 110, start = Math.floor(off / HW) - 1;
  for (let k = start; k < start + W / HW + 3; k++) {
    const lx = k * HW;
    if (lx + HW > PARK[0] && lx < PARK[1]) { drawParkTrees(lx - off, k); continue; }
    if (LANDMARKS.some(l => lx + HW > l.x - l.w / 2 && lx < l.x + l.w / 2)) continue;
    drawHouse(lx - off, k);
  }
  for (const l of LANDMARKS) {
    const sx = l.x - off;
    if (sx > -300 && sx < W + 300) l.draw(sx, CITY_BASE);
  }
}

function drawHouse(x, k) {
  const B = CITY_BASE, w = 98, h = 80 + hash(k * 7) * 80;
  ctx.fillStyle = HOUSE_COLORS[(hash(k * 3) * HOUSE_COLORS.length) | 0];
  ctx.fillRect(x, B - h, w, h);
  tri(x - 4, B - h, x + w / 2, B - h - 20 - hash(k) * 16, x + w + 4, B - h, '#a24c35');
  for (let wy = B - h + 14; wy < B - 30; wy += 24) {
    for (let wx = x + 12; wx < x + w - 14; wx += 22) {
      ctx.fillStyle = '#3d5a78'; ctx.fillRect(wx, wy, 10, 14);
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(wx - 1, wy + 14, 12, 2);
    }
  }
  ctx.fillStyle = '#6b4a35';
  ctx.fillRect(x + w / 2 - 8, B - 24, 16, 24);
}

function drawParkTrees(x, k) {
  const B = CITY_BASE;
  for (let i = 0; i < 2; i++) {
    const tx = x + 25 + i * 55, h = 40 + hash(k * 5 + i) * 30;
    ctx.fillStyle = '#5b3d25'; ctx.fillRect(tx - 4, B - h, 8, h);
    circle(tx, B - h - 10, 26 + hash(k + i) * 10, i ? '#3f7d3a' : '#4d8f45');
  }
}

function drawRathaus(x, B) {
  const c = '#8d8476';
  ctx.fillStyle = c; ctx.fillRect(x - 115, B - 130, 230, 130);
  for (let i = 0; i < 6; i++) {
    const gx = x - 115 + i * (230 / 6);
    tri(gx, B - 130, gx + 230 / 12, B - 152, gx + 230 / 6, B - 130, c);
  }
  ctx.fillStyle = '#3b3a40';
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 10; i++) {
      const wx = x - 107 + i * 21.5;
      if (Math.abs(wx + 4 - x) < 26) continue;
      archWindow(wx, B - 120 + row * 28, 9, 17);
    }
  }
  ctx.fillStyle = '#756d60'; ctx.fillRect(x - 20, B - 255, 40, 255);
  ctx.fillStyle = '#3b3a40';
  for (let wy = B - 160; wy < B - 30; wy += 30) archWindow(x - 5, wy, 10, 20);
  // Glockenspiel
  ctx.fillStyle = '#b9a77a'; ctx.fillRect(x - 25, B - 192, 50, 18);
  ['#c0392b', '#1c6fc9', '#f1c40f', '#c0392b', '#1c6fc9'].forEach((col, i) => circle(x - 18 + i * 9, B - 183, 3, col));
  // Uhr
  circle(x, B - 222, 11, '#f5f0e1');
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, B - 222); ctx.lineTo(x, B - 230); ctx.moveTo(x, B - 222); ctx.lineTo(x + 6, B - 220); ctx.stroke();
  tri(x - 24, B - 255, x, B - 312, x + 24, B - 255, '#4e5a52');
  tri(x - 28, B - 255, x - 22, B - 278, x - 16, B - 255, '#4e5a52');
  tri(x + 16, B - 255, x + 22, B - 278, x + 28, B - 255, '#4e5a52');
  circle(x, B - 316, 4, '#d4af37');
}

function drawFrauenkirche(x, B) {
  const brick = '#a4553f', dome = '#4f8f6f';
  ctx.fillStyle = '#8a4433'; ctx.fillRect(x - 80, B - 95, 160, 95);
  tri(x - 84, B - 95, x, B - 150, x + 84, B - 95, '#7a3a2c');
  for (const tx of [x - 46, x + 46]) {
    ctx.fillStyle = brick; ctx.fillRect(tx - 22, B - 215, 44, 215);
    ctx.fillStyle = '#3a2a28';
    for (let wy = B - 200; wy < B - 40; wy += 34) archWindow(tx - 4, wy, 8, 20);
    ctx.fillStyle = dome;
    ctx.beginPath();
    ctx.moveTo(tx - 22, B - 215);
    ctx.bezierCurveTo(tx - 28, B - 245, tx - 10, B - 262, tx, B - 268);
    ctx.bezierCurveTo(tx + 10, B - 262, tx + 28, B - 245, tx + 22, B - 215);
    ctx.closePath(); ctx.fill();
    ctx.fillRect(tx - 3, B - 280, 6, 14);
    circle(tx, B - 282, 4, dome);
    ctx.fillStyle = '#d4af37'; ctx.fillRect(tx - 1, B - 296, 2, 11);
  }
  ctx.fillStyle = '#3a2a28'; archWindow(x - 10, B - 40, 20, 40);
}

function drawTheatiner(x, B) {
  const yel = '#e3b23c', yel2 = '#c9962a', green = '#55705f';
  ctx.fillStyle = yel2; ctx.fillRect(x - 30, B - 165, 60, 30);
  ctx.fillStyle = green; ctx.beginPath(); ctx.arc(x, B - 165, 34, Math.PI, 0); ctx.fill();
  ctx.fillRect(x - 4, B - 212, 8, 16);
  circle(x, B - 214, 5, green);
  ctx.fillStyle = yel; ctx.fillRect(x - 62, B - 130, 124, 130);
  tri(x - 66, B - 130, x, B - 162, x + 66, B - 130, yel2);
  for (const tx of [x - 84, x + 84]) {
    ctx.fillStyle = yel; ctx.fillRect(tx - 18, B - 190, 36, 190);
    ctx.fillStyle = green;
    ctx.beginPath(); ctx.ellipse(tx, B - 190, 20, 22, 0, Math.PI, 0); ctx.fill();
    ctx.fillRect(tx - 2, B - 222, 4, 12);
    ctx.fillStyle = '#5b4520';
    for (let wy = B - 175; wy < B - 30; wy += 36) archWindow(tx - 5, wy, 10, 20);
  }
  ctx.fillStyle = '#5b4520';
  archWindow(x - 12, B - 50, 24, 50);
  for (const wx of [x - 45, x + 33]) archWindow(wx, B - 110, 12, 26);
}

function drawChinaTurm(x, B) {
  for (let i = -2; i <= 2; i++) circle(x + i * 55, B - 40 - hash(i + 3) * 20, 38, '#3f7d3a');
  for (let i = 0; i < 5; i++) {
    const w = 92 - i * 16, by = B - i * 30;
    ctx.fillStyle = '#7a4a2a'; ctx.fillRect(x - w / 2 + 8, by - 26, w - 16, 26);
    ctx.fillStyle = '#2f3a33';
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 6, by - 22); ctx.lineTo(x + w / 2 + 6, by - 22);
    ctx.lineTo(x + w / 2 - 8, by - 34); ctx.lineTo(x - w / 2 + 8, by - 34);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#2f3a33'; ctx.fillRect(x - 2, B - 175, 4, 26);
  circle(x, B - 177, 4, '#d4af37');
}

function drawSiegestor(x, B) {
  const stone = '#ddd2b8', shade = '#bfb294';
  ctx.fillStyle = stone; ctx.fillRect(x - 95, B - 120, 190, 120);
  ctx.fillStyle = shade; ctx.fillRect(x - 100, B - 132, 200, 14);
  ctx.fillRect(x - 80, B - 150, 160, 18);
  ctx.fillStyle = '#4a4a52';
  archWindow(x - 22, B - 82, 44, 82);
  archWindow(x - 73, B - 62, 26, 62);
  archWindow(x + 47, B - 62, 26, 62);
  ctx.fillStyle = shade;
  for (const cx of [-90, -40, 30, 80]) ctx.fillRect(x + cx, B - 118, 10, 118);
  // Quadriga mit Bavaria
  ctx.fillStyle = '#3d5a4c';
  for (let i = 0; i < 4; i++) {
    const hx = x - 36 + i * 18;
    ctx.fillRect(hx, B - 166, 16, 9);
    ctx.fillRect(hx + 12, B - 174, 5, 9);
    ctx.fillRect(hx + 1, B - 158, 3, 8); ctx.fillRect(hx + 11, B - 158, 3, 8);
  }
  ctx.fillRect(x + 32, B - 178, 8, 26);
  circle(x + 36, B - 182, 5, '#3d5a4c');
}

function drawOlympia(x, B) {
  ctx.fillStyle = 'rgba(190,225,255,0.55)';
  ctx.strokeStyle = 'rgba(110,140,170,0.9)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + 20, B);
  ctx.quadraticCurveTo(x + 40, B - 95, x + 90, B - 62);
  ctx.quadraticCurveTo(x + 125, B - 105, x + 170, B - 50);
  ctx.lineTo(x + 175, B);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  for (let i = 1; i < 8; i++) { ctx.moveTo(x + 20 + i * 20, B); ctx.lineTo(x + 30 + i * 18, B - 70); }
  ctx.stroke();
  ctx.fillStyle = '#c9cdd2'; ctx.fillRect(x - 7, B - 300, 14, 300);
  ctx.fillStyle = '#aeb3ba';
  ctx.beginPath(); ctx.ellipse(x, B - 262, 27, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7e8a96'; ctx.fillRect(x - 25, B - 266, 50, 5);
  ctx.fillStyle = '#aeb3ba';
  ctx.beginPath(); ctx.ellipse(x, B - 244, 21, 8, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#e0322f';
    ctx.fillRect(x - 2, B - 360 + i * 10, 4, 10);
  }
}

function drawArena(x, B) {
  ctx.save();
  ctx.beginPath(); ctx.ellipse(x, B - 42, 150, 50, 0, 0, Math.PI * 2); ctx.clip();
  const g = ctx.createLinearGradient(0, B - 92, 0, B);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#f07a86');
  ctx.fillStyle = g; ctx.fillRect(x - 150, B - 92, 300, 100);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = -12; i < 12; i++) {
    ctx.moveTo(x + i * 24, B - 92); ctx.lineTo(x + i * 24 + 60, B);
    ctx.moveTo(x + i * 24, B - 92); ctx.lineTo(x + i * 24 - 60, B);
  }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(40,40,50,0.55)';
  ctx.beginPath(); ctx.ellipse(x, B - 88, 100, 5, 0, 0, Math.PI * 2); ctx.fill();
}

// ---------- Gehweg & Straße ----------
function drawStreet(cam) {
  ctx.fillStyle = '#c4beb2'; ctx.fillRect(0, CITY_BASE, W, ROAD_TOP - CITY_BASE);
  ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = Math.floor(cam / 40); k * 40 - cam < W; k++) {
    const sx = k * 40 - cam;
    ctx.moveTo(sx, CITY_BASE); ctx.lineTo(sx - 8, ROAD_TOP);
  }
  ctx.stroke();
  ctx.fillStyle = '#8f8a80'; ctx.fillRect(0, ROAD_TOP - 4, W, 4);

  const step = 320;
  for (let k = Math.floor((cam - 50) / step); k * step - cam < W + 50; k++) drawLamp(k * step - cam);
  for (const mx of MAIBAEUME) { const sx = mx - cam; if (sx > -60 && sx < W + 60) drawMaibaum(sx); }
  for (const z of ZONES) { const sx = z.x + 420 - cam; if (sx > -120 && sx < W + 120) drawSign(sx, z.name); }
}

function drawLamp(sx) {
  ctx.fillStyle = '#2e3b35';
  ctx.fillRect(sx - 2, 285, 4, 83);
  ctx.fillRect(sx - 2, 285, 16, 3);
  ctx.fillRect(sx + 9, 288, 10, 6);
  ctx.fillStyle = '#fff6c9'; ctx.fillRect(sx + 10, 294, 8, 3);
}

function drawMaibaum(sx) {
  const top = 140, bot = 368;
  ctx.save();
  ctx.beginPath(); ctx.rect(sx - 4, top, 8, bot - top); ctx.clip();
  ctx.fillStyle = '#fff'; ctx.fillRect(sx - 4, top, 8, bot - top);
  ctx.fillStyle = '#1c6fc9';
  for (let y = top - 10; y < bot; y += 18) {
    ctx.beginPath(); ctx.moveTo(sx - 4, y); ctx.lineTo(sx + 4, y - 8); ctx.lineTo(sx + 4, y + 1); ctx.lineTo(sx - 4, y + 9); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = '#2f6b2f'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(sx, top + 20, 16, 4, 0, 0, Math.PI * 2); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const y = top + 60 + i * 50;
    ctx.fillStyle = '#2b2b2b'; ctx.fillRect(sx - 30, y, 60, 2);
    ctx.fillStyle = i % 2 ? '#1c6fc9' : '#fff';
    ctx.fillRect(sx - 36, y + 4, 14, 12); ctx.fillRect(sx + 22, y + 4, 14, 12);
  }
  circle(sx, top - 4, 6, '#2f6b2f');
}

function drawSign(sx, name) {
  ctx.fillStyle = '#555'; ctx.fillRect(sx - 2, 300, 4, 68);
  ctx.font = `bold 13px ${SANS}`;
  const w = ctx.measureText(name).width + 20;
  ctx.fillStyle = '#1d4f9c';
  ctx.beginPath(); ctx.roundRect(sx - w / 2, 280, w, 24, 3); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(sx - w / 2 + 3, 283, w - 6, 18, 2); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, sx, 292);
}

function drawRoad(cam) {
  ctx.fillStyle = '#43464c'; ctx.fillRect(0, ROAD_TOP, W, ROAD_BOTTOM - ROAD_TOP);
  ctx.fillStyle = '#e9e9e9';
  ctx.fillRect(0, ROAD_TOP + 5, W, 3);
  ctx.fillRect(0, ROAD_BOTTOM - 8, W, 3);
  for (const y of [427, 472]) {
    for (let k = Math.floor(cam / 80); k * 80 - cam < W; k++) ctx.fillRect(k * 80 - cam, y - 2, 40, 4);
  }
  ctx.fillStyle = '#9a958c'; ctx.fillRect(0, ROAD_BOTTOM, W, 6);
  ctx.fillStyle = '#5f9b4a'; ctx.fillRect(0, ROAD_BOTTOM + 6, W, H - ROAD_BOTTOM - 6);

  drawCheckered(60 - cam, false);
  drawCheckered(FINISH - cam, true);
}

function drawCheckered(sx, isFinish) {
  if (sx < -120 || sx > W + 120) return;
  const sq = 10;
  for (let row = 0; (row + 1) * sq <= ROAD_BOTTOM - ROAD_TOP; row++) {
    for (let col = 0; col < 2; col++) {
      ctx.fillStyle = (row + col) % 2 ? '#111' : '#fff';
      ctx.fillRect(sx + col * sq - sq, ROAD_TOP + row * sq, sq, sq);
    }
  }
  ctx.fillStyle = '#555'; ctx.fillRect(sx - 3, 200, 6, 170);
  const label = isFinish ? 'ZIEL' : 'START';
  ctx.fillStyle = '#1d4f9c';
  ctx.beginPath(); ctx.roundRect(sx - 75, 196, 150, 40, 6); ctx.fill();
  for (let i = 0; i < 15; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#111';
    ctx.fillRect(sx - 75 + i * 10, 196, 10, 5);
    ctx.fillStyle = i % 2 ? '#111' : '#fff';
    ctx.fillRect(sx - 75 + i * 10, 231, 10, 5);
  }
  text(label, sx, 217, 14);
}

// ---------- Fahrzeuge & Gegenstände ----------
function drawEntities(cam) {
  const t = performance.now() / 1000;
  const list = [];
  for (const it of items) {
    if (it.taken) continue;
    const sx = it.x - cam;
    if (sx > -60 && sx < W + 60) list.push({ y: laneY(it.lane), draw: () => drawItem(it, sx, t) });
  }
  for (const tr of traffic) {
    const sx = tr.x - cam;
    if (sx > -120 && sx < W + 120) list.push({ y: laneY(tr.lane) + 0.1, draw: () => drawTraffic(tr, sx) });
  }
  for (const c of racers) {
    const sx = c.x - cam;
    if (sx > -80 && sx < W + 80) list.push({ y: laneY(c.laneF) + 0.2, draw: () => drawRacer(c, sx, t) });
  }
  list.sort((a, b) => a.y - b.y);
  for (const e of list) e.draw();
}

function drawShadow(sx, gy, w, h) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(sx, gy, w, h, 0, 0, Math.PI * 2); ctx.fill();
}

function drawRacer(c, sx, t) {
  const s = laneScale(c.laneF), gy = laneY(c.laneF) + 14;
  drawShadow(sx, gy, 54 * s * (1 - Math.min(c.z, 100) / 250), 7 * s);
  ctx.save();
  ctx.translate(sx, gy - c.z);
  ctx.scale(s, s);
  if (c.stun > 0) ctx.rotate(Math.sin(t * 40) * 0.04);
  else if (c.z > 0) ctx.rotate(-c.vz / 6000);
  drawVehicle(c.kind, c.color, c.x / 10);
  ctx.restore();

  const tagY = gy - c.z - 58 * s;
  if (c.isPlayer) {
    tri(sx - 7, tagY - 8, sx + 7, tagY - 8, sx, tagY, '#ffd84a');
    text('DU', sx, tagY - 18, 10, '#ffd84a');
  } else {
    ctx.font = `bold 11px ${SANS}`;
    const w = ctx.measureText(c.name).width + 10;
    ctx.fillStyle = 'rgba(16,32,47,0.7)';
    ctx.beginPath(); ctx.roundRect(sx - w / 2, tagY - 14, w, 16, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(c.name, sx, tagY - 6);
  }
}

function drawTraffic(tr, sx) {
  const s = laneScale(tr.lane), gy = laneY(tr.lane) + 14;
  drawShadow(sx, gy, (tr.len / 2 + 4) * s, 7 * s);
  ctx.save();
  ctx.translate(sx, gy); ctx.scale(s, s);
  if (tr.kind === 'bus') drawBus(tr.x / 10); else drawSedan(tr.color, tr.x / 10);
  ctx.restore();
}

function drawVehicle(kind, color, wr) {
  if (kind === 'porsche') drawPorsche(color, wr);
  else if (kind === 'taxi') drawTaxi(color, wr);
  else if (kind === 'suv') drawSUV(color, wr);
  else drawSedan(color, wr);
}

function drawWheel(x, wr, r = 10) {
  circle(x, -r + 2, r, '#151515');
  circle(x, -r + 2, r * 0.6, '#c8ccd2');
  ctx.strokeStyle = '#7d838c'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = wr + i * Math.PI * 2 / 5;
    ctx.moveTo(x, -r + 2); ctx.lineTo(x + Math.cos(a) * r * 0.55, -r + 2 + Math.sin(a) * r * 0.55);
  }
  ctx.stroke();
  circle(x, -r + 2, 2, '#555');
}

// Porsche 911 (Seitenansicht, fährt nach rechts)
function drawPorsche(col, wr) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-55, -8);
  ctx.lineTo(-57, -16);
  ctx.quadraticCurveTo(-56, -24, -46, -28);
  ctx.bezierCurveTo(-34, -34, -22, -41, -6, -41);
  ctx.bezierCurveTo(6, -41, 14, -36, 22, -27);
  ctx.lineTo(50, -21);
  ctx.quadraticCurveTo(58, -19, 57, -12);
  ctx.lineTo(56, -8);
  ctx.closePath();
  ctx.fill();
  // Kotflügel-Wölbungen
  ctx.beginPath(); ctx.ellipse(36, -20, 16, 5, 0, Math.PI, 0); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-34, -24, 18, 6, -0.15, Math.PI, 0); ctx.fill();
  // Schweller
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-55, -12, 111, 4);
  // Radkästen
  circle(-34, -8, 13, '#111'); circle(36, -8, 13, '#111');
  ctx.fillStyle = col; ctx.fillRect(-56, -8, 113, 1);
  // Fenster
  ctx.fillStyle = '#24384f';
  ctx.beginPath();
  ctx.moveTo(-37, -29);
  ctx.bezierCurveTo(-26, -36, -16, -38, -6, -38);
  ctx.bezierCurveTo(4, -38, 10, -34, 17, -28);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.moveTo(2, -37); ctx.lineTo(8, -35); ctx.lineTo(2, -29); ctx.lineTo(-3, -29); ctx.closePath(); ctx.fill();
  ctx.fillStyle = col; ctx.fillRect(-6, -38, 3, 10);
  // Tür, Griff
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-6, -27); ctx.lineTo(-6, -12); ctx.moveTo(18, -27); ctx.lineTo(19, -12); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-1, -24, 6, 2);
  // Startnummer
  circle(6, -18, 6, '#fff');
  ctx.fillStyle = '#111'; ctx.font = `bold 6px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('911', 6, -18);
  // Lichter & Heckspoiler
  circle(49, -21, 3.5, '#fff7c2');
  ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-58, -20, 4, 5);
  ctx.fillStyle = '#111'; ctx.fillRect(-59, -31, 14, 3);
  ctx.fillRect(-52, -29, 3, 3);
  drawWheel(-34, wr); drawWheel(36, wr);
}

function drawSedan(col, wr, h = 0) {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-55, -8); ctx.lineTo(-56, -22 - h * 0.3); ctx.lineTo(-40, -25 - h * 0.3);
  ctx.lineTo(-28, -38 - h); ctx.lineTo(14, -38 - h); ctx.lineTo(28, -25 - h * 0.3);
  ctx.lineTo(53, -21); ctx.lineTo(56, -9); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-55, -12, 111, 4);
  circle(-34, -8, 12, '#111'); circle(34, -8, 12, '#111');
  ctx.fillStyle = '#2b3d52';
  ctx.beginPath();
  ctx.moveTo(-36, -26 - h * 0.3); ctx.lineTo(-26, -35 - h); ctx.lineTo(12, -35 - h); ctx.lineTo(23, -26 - h * 0.3);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = col; ctx.fillRect(-8, -36 - h, 3, 11 + h * 0.7);
  circle(51, -18, 3, '#fff7c2');
  ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-57, -20, 3, 5);
  drawWheel(-34, wr); drawWheel(34, wr);
}

function drawTaxi(col, wr) {
  drawSedan(col, wr);
  ctx.fillStyle = '#f7d038'; ctx.fillRect(-12, -45, 22, 7);
  ctx.fillStyle = '#111'; ctx.font = `bold 6px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('TAXI', -1, -41.5);
}

function drawSUV(col, wr) {
  drawSedan(col, wr, 8);
  ctx.fillStyle = '#888'; ctx.fillRect(-26, -48, 36, 2);
}

function drawBus(wr) {
  ctx.fillStyle = '#1f5fa8';
  ctx.beginPath(); ctx.roundRect(-85, -64, 170, 56, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillRect(-85, -26, 170, 6);
  ctx.fillStyle = '#2b3d52';
  for (let i = 0; i < 6; i++) ctx.fillRect(-76 + i * 25, -56, 20, 22);
  ctx.fillRect(74, -56, 9, 26);
  ctx.fillStyle = '#ffcc33'; ctx.fillRect(-70, -63, 26, 6);
  ctx.fillStyle = '#111'; ctx.font = `bold 6px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('LINIE 58', -57, -60);
  circle(-55, -8, 12, '#111'); circle(55, -8, 12, '#111');
  drawWheel(-55, wr, 11); drawWheel(55, wr, 11);
}

function drawItem(it, sx, t) {
  const s = laneScale(it.lane), gy = laneY(it.lane) + 12;
  const bob = Math.sin(t * 4 + it.x * 0.01) * 3;
  ctx.save();
  if (it.type === 'brezn') {
    drawShadow(sx, gy, 10 * s, 3 * s);
    ctx.translate(sx, gy - 22 - it.z + bob); ctx.scale(s, s);
    circle(0, -2, 16, 'rgba(255,216,74,0.25)');
    drawBrezn();
  } else if (it.type === 'cone') {
    ctx.translate(sx, gy); ctx.scale(s, s);
    drawCone();
  } else if (it.type === 'turbo') {
    drawShadow(sx, gy, 14 * s, 3 * s);
    ctx.translate(sx, gy - 20 + bob); ctx.scale(s, s);
    circle(0, 0, 18 + Math.sin(t * 10) * 3, 'rgba(127,227,255,0.35)');
    ctx.fillStyle = '#f3ece0'; ctx.strokeStyle = '#b7a98f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-16, -6, 32, 12, 6); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#6aa84f'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-8, -3); ctx.lineTo(-6, 3); ctx.moveTo(2, -3); ctx.lineTo(4, 3); ctx.stroke();
    text('TURBO', 0, -16, 7, '#7fe3ff');
  }
  ctx.restore();
}

function drawBrezn() {
  ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.strokeStyle = '#9a5418';
  ctx.beginPath();
  ctx.moveTo(-6, 8);
  ctx.bezierCurveTo(-20, 6, -20, -14, -7, -12);
  ctx.bezierCurveTo(2, -10, 2, 0, 0, 2);
  ctx.bezierCurveTo(-2, 0, -2, -10, 7, -12);
  ctx.bezierCurveTo(20, -14, 20, 6, 6, 8);
  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-6, 8); ctx.lineTo(4, -3); ctx.moveTo(6, 8); ctx.lineTo(-4, -3); ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const [x, y] of [[-12, -4], [11, -6], [-4, -11], [6, 3], [-9, 4]]) ctx.fillRect(x, y, 2, 2);
}

function drawCone() {
  ctx.fillStyle = '#333'; ctx.fillRect(-13, -4, 26, 4);
  tri(-10, -4, 0, -32, 10, -4, '#ff6a13');
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(-6.5, -14); ctx.lineTo(6.5, -14); ctx.lineTo(5, -19); ctx.lineTo(-5, -19); ctx.closePath(); ctx.fill();
}

function drawFx(cam) {
  for (const p of fx) {
    const a = p.life / p.max, sx = p.x - cam;
    if (p.type === 'spark') {
      ctx.fillStyle = p.color; ctx.globalAlpha = a;
      ctx.fillRect(sx - 2, p.y - 2, 4, 4);
    } else if (p.type === 'smoke') {
      ctx.globalAlpha = 0.35 * a;
      circle(sx, p.y, p.size * (1 + (1 - a) * 2), '#9a9a9a');
    } else if (p.type === 'flame') {
      ctx.globalAlpha = a;
      circle(sx, p.y, p.size, '#ff9d1c');
      circle(sx, p.y, p.size * 0.5, '#fff27a');
    } else if (p.type === 'cone') {
      ctx.save(); ctx.translate(sx, p.y); ctx.rotate(p.rot); ctx.scale(p.s, p.s); ctx.translate(0, 16);
      drawCone(); ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  for (const f of floats) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    text(f.str, f.x - cam, f.y, 12, f.color);
    ctx.globalAlpha = 1;
  }
}

// ---------- HUD & Bildschirme ----------
function drawHud() {
  // Punkte
  panel(12, 12, 200, 62);
  text('PUNKTE', 24, 30, 10, '#9fc3e6', 'left');
  text(String(score), 24, 54, 18, '#fff', 'left');
  ctx.save(); ctx.translate(150, 46); ctx.scale(0.9, 0.9); drawBrezn(); ctx.restore();
  text('x' + brezn, 170, 48, 10, '#ffd84a', 'left');

  // Zeit
  panel(W - 172, 12, 160, 62);
  text('ZEIT', W - 160, 30, 10, '#9fc3e6', 'left');
  text(fmtTime(time), W - 160, 54, 16, '#fff', 'left');

  // Platzierung
  const rank = ranking().indexOf(player) + 1;
  panel(W / 2 - 60, 12, 120, 62);
  text('PLATZ', W / 2, 28, 9, '#9fc3e6');
  text(`${rank}/${racers.length}`, W / 2, 54, 22, rank === 1 ? '#ffd84a' : '#fff');

  // Fortschritt
  const x0 = 250, x1 = W - 250, y = 92;
  ctx.fillStyle = 'rgba(16,32,47,0.6)';
  ctx.beginPath(); ctx.roundRect(x0 - 10, y - 9, x1 - x0 + 20, 18, 9); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (const z of ZONES) ctx.fillRect(x0 + (z.x / FINISH) * (x1 - x0) - 1, y - 6, 2, 12);
  for (const c of [...racers].reverse()) {
    const px = x0 + clamp(c.x / FINISH, 0, 1) * (x1 - x0);
    circle(px, y, c.isPlayer ? 7 : 5, '#10202f');
    circle(px, y, c.isPlayer ? 5 : 4, c.color);
  }
  text('🏁', x1 + 18, y, 12, '#fff');

  // Tacho
  const cx = W - 70, cy = H - 66, r = 50;
  circle(cx, cy, r + 6, 'rgba(16,32,47,0.8)');
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 7; i++) {
    const a = Math.PI * 0.75 + i / 7 * Math.PI * 1.5;
    ctx.moveTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.stroke();
  const kmh = Math.abs(player.speed) * PX_TO_KMH;
  const a = Math.PI * 0.75 + clamp(kmh / 280, 0, 1) * Math.PI * 1.5;
  ctx.strokeStyle = player.turbo > 0 ? '#7fe3ff' : '#ff3b3b'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10)); ctx.stroke();
  circle(cx, cy, 4, '#fff');
  text(String(Math.round(kmh)), cx, cy + 22, 12);
  text(player.speed < -5 ? 'R' : 'km/h', cx, cy + 38, 7, player.speed < -5 ? '#ff8a5c' : '#9fc3e6');

  if (player.turbo > 0) {
    panel(W - 270, H - 46, 130, 30);
    ctx.fillStyle = '#7fe3ff'; ctx.fillRect(W - 262, H - 24, 114 * player.turbo / 2.5, 4);
    text('TURBO', W - 205, H - 34, 9, '#7fe3ff');
  }

  // Steuerungshinweis
  ctx.font = `12px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('→ Gas  ← Rückwärts  ↑↓ Spur  Leertaste Sprung  P Pause  M Ton', 14, H - 12);

  if (zoneBanner) {
    ctx.globalAlpha = Math.min(1, zoneBanner.t * 2);
    panel(W / 2 - 170, 120, 340, 44, 0.8);
    text(zoneBanner.name.toUpperCase(), W / 2, 143, 14, '#fff');
    ctx.globalAlpha = 1;
  }
}

function drawCountdown() {
  const n = Math.ceil(countdown);
  const f = countdown - Math.floor(countdown);
  text(String(n), W / 2, H / 2 - 40, 60 + f * 30, '#ffd84a');
}

function drawMenu() {
  ctx.fillStyle = 'rgba(10,25,45,0.55)'; ctx.fillRect(0, 0, W, H);
  text('MÜNCHEN', W / 2, 82, 44, '#fff');
  text('TURBO', W / 2, 138, 44, '#ff3b3b');
  ctx.font = `16px ${SANS}`; ctx.fillStyle = '#e6f0ff'; ctx.textAlign = 'center';
  ctx.fillText('Mit dem Porsche vom Marienplatz zum Olympiapark – schneller als Taxi, SUV & Co.!', W / 2, 182);

  ctx.save(); ctx.translate(W / 2, 262); ctx.scale(1.8, 1.8); drawPorsche('#d4101e', menuT * 8); ctx.restore();

  panel(W / 2 - 250, 290, 500, 160, 0.8);
  const rows = [
    ['→  /  D', 'Vorwärts (Gas)'],
    ['←  /  A', 'Bremsen & Rückwärts'],
    ['↑  /  W', 'Spur nach links'],
    ['↓  /  S', 'Spur nach rechts'],
    ['Leertaste', 'Springen (über Pylonen!)'],
  ];
  rows.forEach(([k, d], i) => {
    text(k, W / 2 - 220, 312 + i * 26, 10, '#ffd84a', 'left');
    ctx.font = `15px ${SANS}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'left';
    ctx.fillText(d, W / 2 - 50, 313 + i * 26);
  });
  ctx.font = `13px ${SANS}`; ctx.fillStyle = '#cfe0f5'; ctx.textAlign = 'center';
  ctx.fillText('Brezn = 10 Punkte · Weißwurst = Turbo · Pylonen & Verkehr bremsen dich aus', W / 2, 470);
  if (Math.floor(menuT * 2) % 2 === 0) text('ENTER DRÜCKEN ZUM STARTEN', W / 2, 500, 14, '#7CFC00');
  if (highscore) text(`HIGHSCORE ${highscore}`, W / 2, 526, 9, '#ffd84a');

  if (ONLINE) {
    panel(W / 2 + 262, 290, 190, 160, 0.8);
    text('ONLINE TOP 5', W / 2 + 357, 308, 8, '#9fc3e6');
    if (lbStatus !== 'ok' || !leaderboard.length) {
      const msg = lbStatus === 'loading' ? 'Lädt…' : lbStatus === 'error' ? 'Nicht erreichbar' : 'Noch keine Einträge';
      ctx.font = `13px ${SANS}`; ctx.fillStyle = '#cfe0f5'; ctx.textAlign = 'center';
      ctx.fillText(msg, W / 2 + 357, 370);
    }
    leaderboard.slice(0, 5).forEach((r, i) => {
      const y = 334 + i * 24;
      ctx.font = `13px ${SANS}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}. ${r.name}`, W / 2 + 274, y);
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffd84a';
      ctx.fillText(String(r.score), W / 2 + 440, y);
    });
  }
}

function drawOnlineTop10(x, y) {
  text('ONLINE TOP 10', x + 155, y + 25, 12, '#9fc3e6');
  if (!leaderboard.length) {
    ctx.font = `14px ${SANS}`; ctx.fillStyle = '#cfe0f5'; ctx.textAlign = 'center';
    ctx.fillText(lbStatus === 'error' ? 'Bestenliste nicht erreichbar' : 'Noch keine Einträge', x + 155, y + 120);
    return;
  }
  const mine = entry && entry.state === 'done' ? entry.name.trim() : null;
  leaderboard.forEach((r, i) => {
    const ry = y + 52 + i * 19;
    const isMe = r.name === mine && r.score === result.total;
    ctx.font = `${isMe ? 'bold ' : ''}13px ${SANS}`; ctx.fillStyle = isMe ? '#ffd84a' : '#fff';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1}. ${r.name}`, x + 20, ry);
    ctx.textAlign = 'right'; ctx.fillStyle = isMe ? '#ffd84a' : '#cfe0f5';
    ctx.fillText(fmtTime(r.race_time), x + 220, ry);
    ctx.fillText(String(r.score), x + 290, ry);
  });
}

function drawNameEntry() {
  panel(W / 2 - 330, 402, 660, 64, 0.85);
  if (entry.state === 'sending') {
    text('WIRD GESPEICHERT…', W / 2, 434, 12, '#9fc3e6');
    return;
  }
  const cursor = Math.floor(performance.now() / 400) % 2 ? '_' : ' ';
  text('DEIN NAME:', W / 2 - 310, 424, 11, '#9fc3e6', 'left');
  text(entry.name + cursor, W / 2 - 160, 424, 14, '#ffd84a', 'left');
  ctx.font = `13px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = entry.state === 'error' ? '#ff8a5c' : '#cfe0f5';
  ctx.fillText(entry.state === 'error'
    ? 'Speichern fehlgeschlagen – Enter für neuen Versuch, Esc zum Überspringen'
    : 'Enter = in die Online-Bestenliste eintragen · Esc = überspringen', W / 2, 451);
}

function drawResults() {
  ctx.fillStyle = 'rgba(10,25,45,0.7)'; ctx.fillRect(0, 0, W, H);
  const r = result;
  text(r.place === 1 ? 'SIEG!' : `PLATZ ${r.place}`, W / 2, 70, 40, r.place === 1 ? '#ffd84a' : '#fff');
  text('Olympiapark erreicht', W / 2, 115, 11, '#9fc3e6');

  panel(W / 2 - 330, 140, 310, 250, 0.85);
  const order = entry && entry.state === 'done' ? [] : [...finishOrder, ...racers.filter(c => !c.finished).sort((a, b) => b.x - a.x)];
  if (order.length) text('ERGEBNIS', W / 2 - 175, 165, 12, '#9fc3e6');
  else drawOnlineTop10(W / 2 - 330, 140);
  order.forEach((c, i) => {
    const y = 205 + i * 44;
    circle(W / 2 - 300, y, 7, c.color);
    ctx.font = `${c.isPlayer ? 'bold ' : ''}15px ${SANS}`; ctx.fillStyle = c.isPlayer ? '#ffd84a' : '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1}. ${c.name}`, W / 2 - 285, y);
    ctx.textAlign = 'right'; ctx.fillStyle = '#cfe0f5';
    ctx.fillText(c.finished ? fmtTime(c.finishTime) : 'unterwegs…', W / 2 - 35, y);
  });

  panel(W / 2 + 20, 140, 310, 250, 0.85);
  text('PUNKTE', W / 2 + 175, 165, 12, '#9fc3e6');
  const lines = [
    [`Brezn (${brezn} × 10)`, score],
    [`Platz ${r.place}`, r.placeBonus],
    [`Zeitbonus (${fmtTime(r.time)})`, r.timeBonus],
  ];
  lines.forEach(([l, v], i) => {
    const y = 205 + i * 36;
    ctx.font = `15px ${SANS}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(l, W / 2 + 40, y);
    ctx.textAlign = 'right'; ctx.fillText('+' + v, W / 2 + 310, y);
  });
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(W / 2 + 40, 310, 270, 2);
  text('GESAMT', W / 2 + 40, 335, 12, '#fff', 'left');
  text(String(r.total), W / 2 + 310, 335, 18, '#ffd84a', 'right');
  text(r.isNew ? 'NEUER HIGHSCORE!' : `Highscore: ${highscore}`, W / 2 + 175, 370, 9, r.isNew ? '#7CFC00' : '#9fc3e6');

  if (entry && ['typing', 'sending', 'error'].includes(entry.state)) drawNameEntry();
  else if (Math.floor(performance.now() / 500) % 2 === 0) text('ENTER FÜR NEUES RENNEN', W / 2, 440, 14, '#7CFC00');
}

// ---------- Hauptschleife ----------
setupRace();
loadConfig();
loadLeaderboard();
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (!paused) update(dt);
  updateEngineSound();
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
