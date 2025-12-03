
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

/* ---------- Config ---------- */
const HOST = process.env.HOST || 'employee-order-list-production.up.railway.app';
const PORT = Number(process.env.PORT) || 3000;   // Railway sets PORT
const WS_PATH = process.env.WS_PATH || '/mqtt';
const TOPIC_COMMAND = process.env.TOPIC_COMMAND || 'devices/command';
const TOPIC_STATUS  = process.env.TOPIC || 'devices/status';

/* ---------- Express ---------- */
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Serve static files from /public (index.html, menu.html)
app.use(express.static(path.join(__dirname, 'public')));

/* Root route MUST serve index.html */
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* Health endpoint for platform probes */
app.get('/health', (_req, res) => {
  res.json({ ok: true, ws_path: WS_PATH, topics: { status: TOPIC_STATUS, command: TOPIC_COMMAND } });
});

/* If someone hits /mqtt with normal HTTP */
app.get(WS_PATH, (_req, res) => {
  res.status(426).send('WebSocket MQTT endpoint. Use wss and MQTT over websockets.');
});

/* ---------- In-memory data ---------- */
const DEVICES = [];
const findDevice = (username, empId) =>
  DEVICES.find(d => d.emp_id === empId || d.username.toLowerCase() === (username || '').toLowerCase());

/* ---------- Aedes MQTT broker over WebSocket ---------- */
const broker = aedes();
broker.on('clientReady', (client) => console.log('MQTT client connected:', client?.id));
broker.on('publish', (packet) => packet?.topic && console.log('MQTT publish', packet.topic));
broker.on('subscribe', (subs, client) => console.log('MQTT subscribe', client?.id, subs.map(s => s.topic)));
broker.on('clientDisconnect', (client) => console.log('MQTT client disconnected:', client?.id));

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

/* ---------- REST API ---------- */
app.get('/devices', (_req, res) => res.json({ items: DEVICES }));

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

/* Menu route MUST serve menu.html */
app.get('/menu', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'menu.html'));
});

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

app.post('/command', (req, res) => {
  const payload = JSON.stringify({ ...(req.body || {}), ts: Date.now() });
  broker.publish({ topic: TOPIC_COMMAND, payload, qos: 1, retain: false }, (err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Command publish failed' });
    return res.json({ ok: true });
  });
});

/* ---------- Start ---------- */
httpServer.listen(PORT, () => {
  console.log(`HTTP + WS server listening on PORT=${PORT}`);
  console.log(`Static dir: ${path.join(__dirname, 'public')}`);
  console.log(`Root: GET / → index.html  console.log(`Root: GET / → index.html`);
  console.log(`Menu: GET /menu → menu.html`);
  console.log(`WS MQTT path: ${WS_PATH} (connect wss://${HOST}${WS_PATH})`);
