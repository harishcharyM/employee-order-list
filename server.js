
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

// ---- Health & WS info ----
app.get('/health', (_req, res) => {
  res.json({ ok: true, ws_path: WS_PATH, topics: { status: TOPIC_STATUS, command: TOPIC_COMMAND } });
});

// Friendly message if someone does normal GET to /mqtt
app.get(WS_PATH, (_req, res) => {
  res.status(426).send('WebSocket MQTT endpoint. Connect with wss and MQTT over websockets.');
});

// ---- Static AFTER API ----
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Root → index.html (Register page)
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Home → menu.html (your food menu “home” page)
app.get('/home', (_req, res) => {
  res.sendFile(path.join(publicDir, 'menu.html'));
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

// ---- Orders API (kept as-is) ----
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

// ---- Start ----
httpServer.listen(PORT, () => {
  console.log(`HTTP + WS server listening on PORT=${PORT}`);
  console.log(`Static dir: ${publicDir}`);
  console.log(`Root: GET / → index.html`);
  console.log(`Home: GET /home → menu.html`);
  console.log(`WS MQTT path: ${WS_PATH}  console.log(`WS MQTT path: ${WS_PATH} (connect wss://${HOST}${WS_PATH})`);
