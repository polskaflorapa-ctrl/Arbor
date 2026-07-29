const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const logger = require('../config/logger');

let wss = null;

function tokenFromRequest(req) {
  const protocols = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (protocols[0] === 'arbor-phone' && protocols[1]) return protocols[1];
  return null;
}

function canReceive(client, event) {
  if (!client.user) return false;
  if (!event.oddzial_id) return true;
  const globalRoles = new Set(['Prezes', 'Dyrektor', 'Administrator']);
  return globalRoles.has(client.user.rola) || Number(client.user.oddzial_id) === Number(event.oddzial_id);
}

function attachPhoneRealtime(server) {
  if (wss) return wss;
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname !== '/api/telephony/realtime') return;
    try {
      const token = tokenFromRequest(req);
      if (!token) throw new Error('missing token');
      req.phoneUser = jwt.verify(token, env.JWT_SECRET);
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });

  wss.on('connection', (ws, req) => {
    ws.user = req.phoneUser;
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type: 'phone.ready', at: new Date().toISOString() }));
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((client) => {
      if (!client.isAlive) return client.terminate();
      client.isAlive = false;
      client.ping();
    });
  }, 30000);
  heartbeat.unref?.();
  wss.on('close', () => clearInterval(heartbeat));
  logger.info('Telefon realtime WebSocket uruchomiony', { path: '/api/telephony/realtime' });
  return wss;
}

function publishPhoneEvent(event) {
  if (!wss) return 0;
  const payload = JSON.stringify({ ...event, at: event.at || new Date().toISOString() });
  let delivered = 0;
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN || !canReceive(client, event)) return;
    client.send(payload);
    delivered += 1;
  });
  return delivered;
}

function closePhoneRealtime() {
  if (!wss) return;
  wss.clients.forEach((client) => client.close(1001, 'server shutdown'));
  wss.close();
  wss = null;
}

module.exports = { attachPhoneRealtime, publishPhoneEvent, closePhoneRealtime };
