
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import aedes from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';
import url from 'url';

const HOST = process.env.HOST || 'railway-express-starter-production.up.railway.app';
const PORT = Number(process.env.PORT) || 3000;          // Railway sets PORT for you
const WS_PATH = process.env.WS_PATH || '/mqtt';
const TOPIC_COMMAND = process.env.TOPIC_COMMAND || 'devices/command';
const TOPIC_STATUS = process.env.TOPIC || 'devices/status';

/* ---------- Express app ---------- */
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/* ---------- In-memory devices store ---------- */
const DEVICES = [];
const findDevice = (username, empId) =>
  DEVICES.find(d => d.emp_id === empId || d.username.toLowerCase() === username.toLowerCase());

/* ---------- MQTT Broker (Aedes) over WebSocket ---------- */
const broker = aedes();

broker.on('clientReady', (client) => {
  console.log(`MQTT client connected: ${client ? client.id : '(no id)'}`);
});
broker.on('publish', (packet, client) => {
  // Log publishes except broker's own retained/empty
  if (packet && packet.topic) {
    console.log(`MQTT publish topic=${packet.topic} length=${packet.payload?.length || 0}`);
  }
});
broker.on('subscribe', (subs, client) => {
  console.log(`MQTT subscribe: ${client?.id} →`, subs.map(s => s.topic).join(', '));
});
broker.on('clientDisconnect', (client) => {
  console.log(`MQTT client disconnected: ${client?.id}`);
});

/* Create HTTP server and bind WS with path filter */
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  // Only accept connections on /mqtt
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
app.get('/devices', (req, res) => {
  res.json({ items: DEVICES });
});

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
  return res.status(201).json({ ok: true, item });
});

app.get('/menu', (req, res) => {
  res.sendFile(new URL('./public/menu.html', import.meta.url).pathname);
});

/* Build the required payload and publish via MQTT */
app.post('/orders', (req, res) => {
  const { name, emp_id, order_list } = req.body || {};
  if (!name || !emp_id || !Array.isArray(order_list)) {
    return res.status(400).json({ ok: false, error: 'Invalid payload. Required: { name, emp_id, order_list[] }' });
  }
  const message = JSON.stringify({
    name,
    emp_id,
    order_list,
    ts: Date.now()
  });

  // Publish to devices/status
  broker.publish({ topic: TOPIC_STATUS, payload: message, qos: 1, retain: false }, (err) => {
    if (err) {
      console.error('MQTT publish error:', err);
      return res.status(500).json({ ok: false, error: 'MQTT publish failed' });
    }
    return res.json({ ok: true });
  });
});

/* Optional: receive commands via REST and publish to MQTT (e.g., control messages) */
app.post('/command', (req, res) => {
  const payload = JSON.stringify(req.body || { cmd: 'noop', ts: Date.now() });
  broker.publish({ topic: TOPIC_COMMAND, payload, qos: 1, retain: false }, (err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Command publish failed' });
    return res.json({ ok: true });
  });
});

/* ---------- Start ---------- */
httpServer.listen(PORT, () => {
  console.log(`HTTP + WS server listening on PORT=${PORT}`);
  console.log(`WS MQTT path: ${WS_PATH}`);
  console.log(`Use wss://${HOST}${WS_PATH} to connect from clients`);
});
``
