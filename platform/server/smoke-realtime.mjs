import { io as createClient } from 'socket.io-client';

const API = process.env.VITE_ARBOR_API_URL || 'http://127.0.0.1:8790';

async function request(path, init = {}) {
  const response = await fetch(API + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${response.status} ${path}: ${text}`);
  return data;
}

async function login(login) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ login }),
  });
  return {
    token: data.token,
    user: data.user,
    headers: { Authorization: `Bearer ${data.token}` },
  };
}

function connectRealtime(token) {
  return createClient(API, {
    auth: token ? { token } : {},
    autoConnect: false,
    reconnection: false,
    transports: ['websocket'],
    timeout: 3000,
  });
}

function once(socket, eventName, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(eventName, onEvent);
      socket.off('connect_error', onError);
    };
    const onEvent = (payload) => {
      cleanup();
      resolve(payload);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    socket.once(eventName, onEvent);
    socket.once('connect_error', onError);
  });
}

function connectError(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for connect_error'));
    }, 3000);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    };
    const onConnect = () => {
      cleanup();
      reject(new Error('Unauthenticated socket connected'));
    };
    const onError = (error) => {
      cleanup();
      resolve(error);
    };
    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
  });
}

function emitWithAck(socket, eventName, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(3000).emit(eventName, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

async function main() {
  const unauthenticated = connectRealtime();
  const authErrorPromise = connectError(unauthenticated);
  unauthenticated.connect();
  const authError = await authErrorPromise;
  unauthenticated.close();
  if (!String(authError.message).includes('Unauthorized')) throw new Error(`Unexpected auth error: ${authError.message}`);

  const manager = await login('kierownik');
  const lead = await login('brygadzista');

  const managerSocket = connectRealtime(manager.token);
  const leadSocket = connectRealtime(lead.token);
  const managerReadyPromise = once(managerSocket, 'realtime.ready');
  const leadReadyPromise = once(leadSocket, 'realtime.ready');
  managerSocket.connect();
  leadSocket.connect();
  const managerReady = await managerReadyPromise;
  const leadReady = await leadReadyPromise;

  if (!managerReady.allowedChannels.includes('branch:krk:orders')) throw new Error('Manager must see branch order channel');
  if (!managerReady.allowedChannels.includes('invoices')) throw new Error('Manager must see invoice channel');
  if (leadReady.allowedChannels.includes('invoices')) throw new Error('Lead must not see invoice channel');

  const leadSub = await emitWithAck(leadSocket, 'subscribe', ['invoices', 'team:team-a1']);
  if (!leadSub.accepted.includes('team:team-a1') || !leadSub.rejected.includes('invoices')) {
    throw new Error(`Lead subscription scoping failed: ${JSON.stringify(leadSub)}`);
  }

  const managerSub = await emitWithAck(managerSocket, 'subscribe', ['branch:krk:orders', 'invoices']);
  if (!managerSub.accepted.includes('branch:krk:orders') || !managerSub.accepted.includes('invoices')) {
    throw new Error(`Manager subscription failed: ${JSON.stringify(managerSub)}`);
  }

  const eventPromise = once(managerSocket, 'arbor.event');
  const order = await request('/api/orders', {
    method: 'POST',
    headers: manager.headers,
    body: JSON.stringify({
      clientId: 'c-2',
      type: 'Smoke realtime order',
      scheduledAt: '2026-09-23T09:00:00.000Z',
      priority: 'normalny',
      value: 1111,
      source: 'smoke-realtime',
    }),
  });
  const event = await eventPromise;
  if (event.eventName !== 'order.created' || event.payload.id !== order.id || event.channel !== 'branch:krk:orders') {
    throw new Error(`Unexpected realtime event: ${JSON.stringify(event)}`);
  }

  managerSocket.close();
  leadSocket.close();
  console.log(JSON.stringify({
    ok: true,
    managerChannels: managerReady.allowedChannels,
    leadChannels: leadReady.allowedChannels,
    order: order.id,
    event: event.eventName,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
