
import express from 'express';

const app = express();

app.use(express.json());
app.use(express.static('public'));  // serves /index.html, /menu.html, css/js, etc.

// In-memory store for devices (replace with DB later)
const devices = [];

function findDevice({ username, empId }) {
  return devices.find(
    (d) => d.empId === empId || d.username.toLowerCase() === username.toLowerCase()
  );
}

app.get('/devices', (req, res) => {
  res.json({ items: devices });
});

app.post('/devices', (req, res) => {
  const { username, empId } = req.body || {};
  if (!username || !empId) {
    return res.status(400).json({ ok: false, error: 'username and empId are required' });
  }

  const existing = findDevice({ username, empId });
  if (existing) {
    return res.status(409).json({
      ok: false,
      error: 'Device already exists for this username or empId',
      existing
    });
  }

  const item = { username, empId, createdAt: Date.now() };
  devices.push(item);
  return res.status(201).json({ ok: true, item });
});

// Fallback
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Broker + UI + Login listening on PORT=${port}`);
});
