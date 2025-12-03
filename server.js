
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

// ---- Config ----
const HOST = process.env.HOST || 'employee-order-list-production.up.railway.app';
const PORT = Number(process.env.PORT) || 3000;
const WS_PATH = process.env.WS_PATH || '/mqtt';
const TOPIC_COMMAND = process.env.TOPIC_COMMAND || 'devices/command';
const TOPIC_STATUS  = process.env.TOPIC || 'devices/status';

const app = express();
app.use(cors());
app.use(express.json());

// ---- In-memory store ----
const DEVICES = [];
const findDevice = (username, empId) =>
  DEVICES.find(d => d.emp_id === empId || d.username.toLowerCase() === (username || '').toLowerCase());

// ---- Health & WS info (for probes) ----
app.get('/health', (_req, res) => {
  res.json({ ok: true, ws_path: WS_PATH, topics: { status: TOPIC_STATUS, command: TOPIC_COMMAND } });
});

// Friendly message if someone does normal GET to /mqtt
app.get(WS_PATH, (_req, res) => {
  res.status(426).send('WebSocket MQTT endpoint. Connect with wss and MQTT over websockets.');
});

// ---- API FIRST (before static) ----

// Create device
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
  // Return 201 + redirect hint
  return res.status(201).json({ ok: true, item, redirect: '/menu' });
});

// List devices (optional)
app.get('/devices', (_req, res) => {
  res.json({ items: DEVICES });
});

// Orders → publish via MQTT
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

// Commands → publish via MQTT
app.post('/command', (req, res) => {
  const payload = JSON.stringify({ ...(req.body || {}), ts: Date.now() });
  broker.publish({ topic: TOPIC_COMMAND, payload, qos: 1, retain: false }, (err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Command publish failed' });
    return res.json({ ok: true });
  });
});

// ---- Static pages AFTER API ----
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Root → index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Menu → menu.html
app.get('/menu', (_req, res) => {
  res.sendFile(path.join(publicDir, 'menu.html'));
});

// Optional: 405 for methods not supported on /devices
app.all('/devices', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  return next();
});

// ---- MQTT broker over WebSocket ----
const broker = aedes();
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
  console.log(`Connect with: wss://${HOST}${WS_PATH}`);
});
``
