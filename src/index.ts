import express from 'express';
import cors from 'cors';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { config } from './config/index.js';
import { pluginSessions } from './ws/plugin.js';
import editorRoutes from './api/editor.js';
import healthRoutes from './api/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));

const server = config.ssl
  ? https.createServer(config.ssl, app)
  : http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  pluginSessions.handleConnection(ws, req);
});

app.use(editorRoutes);
app.use(healthRoutes);

const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (_req, res) => {
    const indexPath = path.resolve(frontendDist, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Not Found' });
    }
  });
} else {
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });
}

const protocol = config.ssl ? 'https' : 'http';
server.listen(config.port, config.host, () => {
  console.log(`CoreTuff Web Editor (${protocol}) listening on ${config.host}:${config.port}`);
});

function shutdown() {
  wss.close();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
