// Fight Omniversal — servidor multiplayer
// Serve o jogo (pasta /public) e faz o relay entre o HOST (P1) e o GUEST (P2) por código de sala.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC = __dirname; // ficheiros soltos na mesma pasta; só index.html é público
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
               '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/health') { res.writeHead(200); return res.end('ok'); }
  if (url === '/') url = '/index.html';
  if (url !== '/index.html') { res.writeHead(404); return res.end('Nao encontrado'); }
  const file = path.join(PUBLIC, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Nao encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
const rooms = new Map(); // code -> { host, guest }
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join(''); }
  while (rooms.has(c));
  return c;
}
const sendJSON = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function leave(ws) {
  const code = ws._room;
  if (!code) return;
  const room = rooms.get(code);
  ws._room = null;
  if (!room) return;
  if (room.host === ws) {
    sendJSON(room.guest, { type: 'left' });
    if (room.guest) room.guest._room = null;
    rooms.delete(code);
  } else if (room.guest === ws) {
    room.guest = null;
    sendJSON(room.host, { type: 'left' });
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let m; try { m = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!m || typeof m.type !== 'string') return;

    if (m.type === 'create') {
      leave(ws);
      const code = newCode();
      rooms.set(code, { host: ws, guest: null });
      ws._room = code;
      sendJSON(ws, { type: 'created', code });
    } else if (m.type === 'join') {
      leave(ws);
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return sendJSON(ws, { type: 'error', msg: 'Sala não encontrada.' });
      if (room.guest) return sendJSON(ws, { type: 'error', msg: 'A sala já está cheia.' });
      room.guest = ws; ws._room = code;
      sendJSON(room.host, { type: 'paired', role: 'host' });
      sendJSON(ws, { type: 'paired', role: 'guest' });
    } else if (m.type === 'data') {
      const room = rooms.get(ws._room);
      if (!room) return;
      const other = room.host === ws ? room.guest : room.host;
      sendJSON(other, { type: 'data', d: m.d });
    } else if (m.type === 'leave') {
      leave(ws);
    }
  });

  ws.on('close', () => leave(ws));
  ws.on('error', () => {});
});

// Remove ligações mortas
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 20000);

server.listen(PORT, () => console.log('Fight Omniversal a correr na porta ' + PORT));
