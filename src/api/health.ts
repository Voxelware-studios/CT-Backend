import { Router } from 'express';
import { pluginSessions } from '../ws/plugin.js';
import { sessionStore } from '../sessions/store.js';

const router = Router();

router.get('/api/health/servers', (_req, res) => {
  const servers = pluginSessions.getConnectedServers();
  res.json({ servers });
});

router.get('/api/health/:serverId', (req, res) => {
  const { serverId } = req.params;
  const health = pluginSessions.getHealthByServerId(serverId);
  const status = pluginSessions.getServerStatus(serverId);

  if (status === 'disconnected' && !health) {
    res.status(404).json({ error: 'No health data available for this server' });
    return;
  }

  if (!health) {
    res.json({
      overall_state: 'PENDING',
      timestamp: Date.now(),
      components: [],
      server_info: {},
      server_status: status,
      message: 'Waiting for health data from server...',
    });
    return;
  }

  res.json({ ...health as object, server_status: status });
});

router.get('/api/session/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;
  const session = sessionStore.get(sessionId);
  if (!session) {
    res.status(404).json({ valid: false, reason: 'not_found_or_expired' });
    return;
  }
  const serverConnected = pluginSessions.isConnected(sessionId);
  const serverStatus = pluginSessions.getServerStatus(session.serverId);
  res.json({
    valid: true,
    server_id: session.serverId,
    server_name: session.serverName,
    server_connected: serverConnected,
    server_status: serverStatus,
    expires_at: session.expiresAt,
  });
});

export default router;
