/* LAPO KOMBAT — server realtime (Node.js + ws)
   Menyajikan game, menyinkronkan semua pemain (100+ bersamaan), menyimpan pendaftaran.
   Jalankan:  npm install && npm start      (lalu buka http://localhost:3000) */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const MAX_PLAYERS = +process.env.MAX_PLAYERS || 400;          /* per room */
const TICK_MS = +process.env.TICK_MS || 100;                  /* 10 siaran/detik */
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(6).toString('hex');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HTML_FILE = path.join(__dirname, 'lapo-kombat.html');
const TAU = Math.PI * 2;
const EMOTES = ['wave', 'dance', 'cheer'];
const MENU = { babi_panggang: 'food', saksang: 'food', daun_singkong: 'food', sop_babi: 'food', nasgor_babi: 'food', mie_goreng_babi: 'food', tuak: 'drink', air_es: 'drink', mandi: 'drink', badak: 'drink', teh_manis: 'drink' };

/* ---------- registri pendaftaran (disimpan ke berkas JSON) ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const REG_FILE = path.join(DATA_DIR, 'registrations.json');
let registry = {};
try { registry = JSON.parse(fs.readFileSync(REG_FILE, 'utf8')); } catch (e) { registry = {}; }
let regDirty = false;
function saveRegistry() {
  if (!regDirty) return; regDirty = false;
  const tmp = REG_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(registry, null, 1), err => { if (!err) fs.rename(tmp, REG_FILE, () => {}); });
}
setInterval(saveRegistry, 5000);
process.on('SIGTERM', () => { saveRegistry(); setTimeout(() => process.exit(0), 300); });
process.on('SIGINT', () => { saveRegistry(); setTimeout(() => process.exit(0), 300); });

/* ---------- utilitas ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanName = s => clean(s, 40).replace(/[^\p{L}\p{N} .'\-]/gu, '');
const norm = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

/* ---------- room ---------- */
const rooms = new Map();
function getRoom(name) {
  let r = rooms.get(name);
  if (!r) { r = { name, clients: new Map(), seats: new Map(), nextId: 1, table: new Map(), oseq: 1 }; rooms.set(name, r); }
  return r;
}
function newId(room) {
  for (let i = 0; i < 65535; i++) { const id = room.nextId; room.nextId = room.nextId % 65534 + 1; if (!room.clients.has(id)) return id; }
  return 0;
}
const pub = c => ({ id: c.id, cname: c.cname, marga: c.marga, kind: c.kind, av: c.av, peer: c.peer, x: c.st.x, z: c.st.z, yaw: c.st.yaw, sit: c.st.sit, lean: c.st.lean, chair: c.st.chair, emote: c.st.emote, talk: c.st.talk, mic: c.st.mic, cam: c.st.cam, cup: c.st.cup });
function broadcast(room, o, except) { const s = JSON.stringify(o); for (const c of room.clients.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s); }
function freeSeat(room, c) { if (c.st.chair >= 0 && room.seats.get(c.st.chair) === c.id) { room.seats.delete(c.st.chair); room.table.delete(c.st.chair); } }
function removeClient(c) {
  const room = c.room; if (!room || !room.clients.has(c.id)) return;
  freeSeat(room, c); room.clients.delete(c.id); broadcast(room, { t: 'leave', id: c.id });
  if (c.token && registry[c.token]) { registry[c.token].lastSeen = Date.now(); registry[c.token].online = false; regDirty = true; }
  if (!room.clients.size && room.name !== 'LAPO') rooms.delete(room.name);
}

/* ---------- pendaftaran & masuk ---------- */
function handleHello(c, m) {
  if (c.joined) return;
  const token = clean(m.token, 64), real = cleanName(m.real), cname = cleanName(m.cname).slice(0, 18);
  const marga = cleanName(m.marga).slice(0, 24), kind = m.kind === 'boru' ? 'boru' : 'marga';
  const roomName = (clean(m.room, 8).toUpperCase().replace(/[^A-Z0-9]/g, '')) || 'LAPO';
  const deny = reason => { send(c.ws, { t: 'denied', reason }); setTimeout(() => c.ws.close(4000, 'denied'), 100); };
  if (token.length < 16) return deny('Perangkat tidak dikenali. Muat ulang halaman.');
  if (real.length < 2) return deny('Nama asli wajib diisi.');
  if (cname.length < 2) return deny('Nama karakter wajib diisi (minimal 2 huruf).');
  if (marga.length < 2) return deny('Marga / Boru wajib diisi.');
  if (!m.av || typeof m.av !== 'object' || JSON.stringify(m.av).length > 1800) return deny('Karakter belum dibuat.');
  /* nama karakter harus unik */
  const key = norm(cname);
  for (const [tk, r] of Object.entries(registry)) if (tk !== token && norm(r.cname) === key) return deny(`Nama karakter "${cname}" sudah dipakai pemain lain. Pilih nama lain.`);
  const room = getRoom(roomName);
  if (room.clients.size >= MAX_PLAYERS) return deny(`Room penuh (${MAX_PLAYERS} pemain). Coba room lain.`);
  /* tendang sesi ganda dengan token yang sama */
  for (const o of room.clients.values()) if (o.token === token) { o.kicked = true; send(o.ws, { t: 'denied', reason: 'Akunmu masuk dari perangkat/tab lain.' }); o.ws.close(4001); removeClient(o); }
  const now = Date.now(), prev = registry[token];
  registry[token] = { real, cname, marga, kind, created: prev?.created || now, lastSeen: now, online: true, room: roomName, joins: (prev?.joins || 0) + 1 };
  regDirty = true;
  c.joined = true; c.token = token; c.room = room; c.id = newId(room); c.cname = cname; c.marga = marga; c.kind = kind; c.real = real;
  c.av = m.av; c.peer = clean(m.peer, 64) || null;
  c.st = { x: 0, z: 11, yaw: Math.PI, sit: 0, lean: 0, chair: -1, emote: null, talk: 0, mic: 0, cam: 0, cup: 0 }; c.dirty = true;
  room.clients.set(c.id, c);
  send(c.ws, { t: 'welcome', id: c.id, room: room.name, max: MAX_PLAYERS, players: [...room.clients.values()].filter(o => o !== c).map(pub), table: [...room.table].map(([chair, v]) => ({ chair, food: v.food || null, drink: v.drink || null })) });
  broadcast(room, { t: 'join', p: pub(c) }, c);
}

function handleState(c, m) {
  const s = c.st, room = c.room;
  s.x = clamp(+m.x || 0, -60, 60); s.z = clamp(+m.z || 0, -60, 60);
  s.yaw = (+m.yaw || 0); s.sit = clamp(+m.sit || 0, 0, 1); s.lean = clamp(+m.lean || 0, -.5, .5);
  let chair = Number.isInteger(m.chair) ? m.chair : -1; if (chair < -1 || chair > 1000) chair = -1;
  if (chair !== s.chair) {
    freeSeat(room, c);
    if (chair >= 0) { const owner = room.seats.get(chair); if (owner && owner !== c.id && room.clients.has(owner)) { send(c.ws, { t: 'seatDenied', chair }); chair = -1; } else room.seats.set(chair, c.id); }
  }
  s.chair = chair; s.emote = EMOTES.includes(m.emote) ? m.emote : null;
  s.talk = m.talk ? 1 : 0; s.mic = m.mic ? 1 : 0; s.cam = m.cam ? 1 : 0; s.cup = m.cup ? 1 : 0; c.dirty = true;
}

function handleChat(c, m) {
  const now = Date.now(); if (now - c.lastChat < 600) return; c.lastChat = now;
  const text = clean(m.text, 240); if (!text) return;
  const out = JSON.stringify({ t: 'chat', id: c.id, name: c.cname, marga: c.marga, kind: c.kind, text });
  const range = m.near ? clamp(+m.range || 14, 4, 60) : 0;
  for (const o of c.room.clients.values()) {
    if (o.ws.readyState !== 1) continue;
    if (range && o !== c && Math.hypot(o.st.x - c.st.x, o.st.z - c.st.z) > range) continue;
    o.ws.send(out);
  }
}

/* ---------- pesanan makanan/minuman: harus sedang duduk; disiarkan ke semua klien ---------- */
function handleOrder(c, m) {
  const cat = MENU[m.item]; if (!cat) return;
  const now = Date.now(); if (now - (c.lastOrder || 0) < 1500) return; c.lastOrder = now;
  const chair = c.st.chair; if (chair < 0 || c.st.sit < 0.5) return;
  const room = c.room, t = room.table.get(chair) || {}; t[cat] = m.item; room.table.set(chair, t);
  broadcast(room, { t: 'order', oid: room.oseq++, from: c.id, item: m.item, chair });
}

/* ---------- siaran status (biner, sekali per tick untuk seluruh room) ---------- */
function encodeStates(list) {
  const buf = Buffer.allocUnsafe(3 + list.length * 12); buf[0] = 1; buf.writeUInt16LE(list.length, 1); let o = 3;
  for (const c of list) {
    const s = c.st; buf.writeUInt16LE(c.id, o); buf.writeInt16LE(Math.round(s.x * 100), o + 2); buf.writeInt16LE(Math.round(s.z * 100), o + 4);
    buf[o + 6] = Math.round((((s.yaw % TAU) + TAU) % TAU) / TAU * 255); buf[o + 7] = Math.round(s.sit * 255);
    buf.writeInt8(Math.round(s.lean * 254), o + 8); buf.writeInt16LE(s.chair, o + 9);
    buf[o + 11] = (s.talk ? 1 : 0) | (s.mic ? 2 : 0) | (s.cam ? 4 : 0) | (s.cup ? 8 : 0) | ((EMOTES.indexOf(s.emote) + 1) << 4);
    o += 12; c.dirty = false;
  }
  return buf;
}
let ticks = 0, bytesOut = 0;
setInterval(() => {
  for (const room of rooms.values()) {
    const list = []; for (const c of room.clients.values()) if (c.dirty) list.push(c);
    if (!list.length) continue;
    const buf = encodeStates(list);
    for (const c of room.clients.values()) if (c.ws.readyState === 1 && c.ws.bufferedAmount < 512 * 1024) { c.ws.send(buf, { binary: true }); bytesOut += buf.length; }
  }
  ticks++;
}, TICK_MS);

/* ---------- HTTP: game + admin ---------- */
let htmlGz = null, htmlMtime = 0;
function serveHtml(req, res) {
  try {
    const st = fs.statSync(HTML_FILE);
    if (!htmlGz || st.mtimeMs !== htmlMtime) { htmlGz = zlib.gzipSync(fs.readFileSync(HTML_FILE), { level: 9 }); htmlMtime = st.mtimeMs; }
    const h = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
    if (/gzip/.test(req.headers['accept-encoding'] || '')) { h['Content-Encoding'] = 'gzip'; res.writeHead(200, h); res.end(htmlGz); }
    else { res.writeHead(200, h); res.end(zlib.gunzipSync(htmlGz)); }
  } catch (e) { res.writeHead(500); res.end('lapo-kombat.html tidak ditemukan di folder server.'); }
}
const online = () => { let n = 0; for (const r of rooms.values()) n += r.clients.size; return n; };
function adminPage(res) {
  const rows = Object.values(registry).sort((a, b) => b.lastSeen - a.lastSeen);
  const fmt = t => t ? new Date(t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : '-';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Pendaftar Lapo Kombat</title>
<style>body{font:14px system-ui;margin:24px;background:#1b130e;color:#f5ead8}table{border-collapse:collapse;width:100%}th,td{padding:8px 10px;border-bottom:1px solid #3a2a20;text-align:left}th{background:#2a1d15;position:sticky;top:0}a{color:#ff9a4d}.on{color:#6fe08a}</style>
<h2>Pendaftar Lapo Kombat</h2><p>Total terdaftar: <b>${rows.length}</b> · Sedang online: <b>${online()}</b> · <a href="/admin.csv?key=${esc(ADMIN_KEY)}">Unduh CSV</a></p>
<table><tr><th>#</th><th>Nama asli</th><th>Nama karakter</th><th>Marga/Boru</th><th>Room</th><th>Daftar</th><th>Terakhir</th><th></th></tr>
${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.real)}</td><td>${esc(r.cname)}</td><td>${r.kind === 'boru' ? 'Boru' : 'Marga'} ${esc(r.marga)}</td><td>${esc(r.room)}</td><td>${fmt(r.created)}</td><td>${fmt(r.lastSeen)}</td><td class=on>${r.online ? '● online' : ''}</td></tr>`).join('')}</table>`);
}
function adminCsv(res) {
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [['nama_asli', 'nama_karakter', 'jenis', 'marga_boru', 'room', 'daftar', 'terakhir_online'].join(',')];
  for (const r of Object.values(registry)) rows.push([q(r.real), q(r.cname), r.kind, q(r.marga), q(r.room), new Date(r.created).toISOString(), new Date(r.lastSeen).toISOString()].join(','));
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="pendaftar-lapo-kombat.csv"' });
  res.end('\ufeff' + rows.join('\n'));
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/lapo-kombat.html') return serveHtml(req, res);
  if (u.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, online: online(), rooms: rooms.size, ticks, bytesOut, cpuMs: Math.round((process.cpuUsage().user + process.cpuUsage().system) / 1000), rssMb: Math.round(process.memoryUsage().rss / 1048576) })); }
  if (u.pathname === '/admin' || u.pathname === '/admin.csv') {
    if (u.searchParams.get('key') !== ADMIN_KEY) { res.writeHead(403); return res.end('Kunci admin salah'); }
    return u.pathname === '/admin' ? adminPage(res) : adminCsv(res);
  }
  res.writeHead(404); res.end('Tidak ditemukan');
});

/* ---------- WebSocket ---------- */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192, perMessageDeflate: false });
wss.on('connection', (ws, req) => {
  const c = { ws, joined: false, id: 0, lastChat: 0, bucket: 40, bt: Date.now(), alive: true, kicked: false, st: null };
  ws.on('pong', () => { c.alive = true; });
  ws.on('message', (data, isBin) => {
    if (isBin) return;
    const now = Date.now(); c.bucket = Math.min(60, c.bucket + (now - c.bt) / 1000 * 30); c.bt = now;       /* batas ~30 pesan/detik */
    if (--c.bucket < 0) return;
    let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') return handleHello(c, m);
    if (!c.joined) return;
    switch (m.t) {
      case 's': handleState(c, m); break;
      case 'chat': handleChat(c, m); break;
      case 'order': handleOrder(c, m); break;
      case 'av': if (m.av && typeof m.av === 'object' && JSON.stringify(m.av).length < 1800) { c.av = m.av; broadcast(c.room, { t: 'av', id: c.id, av: c.av }, c); } break;
      case 'peer': c.peer = clean(m.peer, 64) || null; broadcast(c.room, { t: 'peer', id: c.id, peer: c.peer }, c); break;
    }
  });
  ws.on('close', () => { if (c.joined && !c.kicked) removeClient(c); });
  ws.on('error', () => {});
});
setInterval(() => { for (const ws of wss.clients) { const c = ws; if (c.isAlive === false) { ws.terminate(); continue; } c.isAlive = false; ws.ping(); } }, 25000);
wss.on('connection', ws => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
setInterval(() => console.log(`[${new Date().toISOString()}] online=${online()} rooms=${rooms.size} terdaftar=${Object.keys(registry).length} rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`), 60000);

server.listen(PORT, () => {
  console.log(`LAPO KOMBAT berjalan di http://localhost:${PORT}`);
  console.log(`Halaman admin pendaftar:  http://localhost:${PORT}/admin?key=${ADMIN_KEY}`);
});
