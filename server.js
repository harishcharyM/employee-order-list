
// server.js
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import aedes from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';
import url from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const HOST = process.env.HOST || 'employee-order-list-production.up.railway.app';
const PORT = Number(process.env.PORT) || 3000;
const WS_PATH = process.env.WS_PATH || '/mqtt';
const TOPIC_COMMAND = process.env.TOPIC_COMMAND || 'devices/command';
const TOPIC_STATUS  = process.env.TOPIC || 'devices/status';

const app = express();
app.use(cors());
app.use(express.json()); // <-- body parser

/* Health & info */
app.get('/health', (_req, res) => {
  res.json({ ok: true, ws_path: WS_PATH, topics: { status: TOPIC_STATUS, command: TOPIC_COMMAND } });
});
app.get(WS_PATH, (_req, res) => {
  res.status(426).send('WebSocket MQTT endpoint. Connect with wss and MQTT over websockets.');
});

/* In-memory data */
const DEVICES = [];
const findDevice = (username, empId) =>
  DEVICES.find(d => d.emp_id === empId || d.username.toLowerCase() === (username || '').toLowerCase());

/* ---- API ROUTES FIRST ---- */
app.post('/devices', (req, res) => {
  const { username, empId } = req.body || {};
  if (!username || !empId) {
    return res.status(400).json({ ok: false, error: 'username and empId are required' });
  }
  const existing = findDevice(username, empId);
  if (existing) {
    return res.status(409).json({ ok: false, error: 'Device already exists', existing });
  }
  const item = { username, emp_id: empId, created_at: Date.now() };
  DEVICES.push(item);
  return res.status(201).json({ ok: true, item, redirect: '/menu' });
});

app.get('/devices', (_req, res) => res.json({ items: DEVICES }));

/* Orders → publish via MQTT */
const broker = aedes();
app.post('/orders', (req, res) => {
  const { name, emp_id, order_list } = req.body || {};
  if (!name || !emp_id || !Array.isArray(order_list)) {
    return res.status(400).json({ ok: false, error: 'Invalid payload. Required: { name, emp_id, order_list[] }' });
  }
  const message = JSON.stringify({ name, emp_id, order_list, ts: Date.now() });
  broker.publish({ topic: TOPIC_STATUS, payload: message, qos: 1, retain: false }, (err) => {
    if (err) return res.status(500).json({ ok: false, error: 'MQTT publish failed' });
    return res.json({ ok: true });
  });
});

/* ---- STATIC AFTER API ---- */
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});
app.get('/menu', (_req, res) => {
  res.sendFile(path.join(publicDir, 'menu.html'));
});

/* ---- MQTT broker over WebSocket ---- */
broker.on('clientReady', (c) => console.log('MQTT connected:', c?.id));
broker.on('publish', (p) => p?.topic && console.log('MQTT publish', p.topic));
broker.on('subscribe', (subs, c) => console.log('MQTT subscribe', c?.id, subs.map(s => s.topic)));
broker.on('clientDisconnect', (c) => console.log('MQTT disconnected:', c?.id));

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });
wss.on('connection', (ws, req) => {
  const pathname = url.parse(req.url).pathname;
  if (pathname !== WS_PATH) {
    console.log('WS rejected (wrong path):', pathname);
    ws.close();
    return;
  }
  const stream = createWebSocketStream(ws, { encoding: 'binary' });
  broker.handle(stream);
});

httpServer.listen(PORT, () => {
  console.log(`HTTP + WS server listening on PORT=${PORT}`);
  console.log(`Static dir: ${publicDir}`);
  console.log(`Root: GET / → index.html`);
  console.log(`Menu: GET /menu → menu.html`);
  console.log(`WS MQTT path: ${WS_PATH} (connect wss://${HOST}${WS_PATH})`);
});
``
