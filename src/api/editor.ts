import { Router } from 'express';
import type { WebSocket } from 'ws';
import { sessionStore } from '../sessions/store.js';
import { pluginSessions } from '../ws/plugin.js';

const router = Router();

router.post('/api/editor/create', (req, res) => {
  const { session_id, server_name, plugin_version, server_id, expires_in_minutes, schema, values } = req.body;

  if (!session_id || !server_name || !server_id || !schema || !values) {
    res.status(400).json({ error: 'Missing required fields: session_id, server_name, server_id, schema, values' });
    return;
  }

  if (sessionStore.get(session_id)) {
    res.status(409).json({ error: 'Session ID already exists' });
    return;
  }

  const session = sessionStore.create({
    sessionId: session_id,
    serverName: server_name,
    pluginVersion: plugin_version || 'unknown',
    pluginAddress: '',
    serverId: server_id,
    schema,
    values,
  });

  pluginSessions.registerSession(session_id, server_id);

  res.status(201).json({
    session_id: session.sessionId,
    expires_at: session.expiresAt,
    url: `/e/${session.sessionId}`,
  });
});

router.get('/api/editor/status', (req, res) => {
  const sessionId = req.query.session_id as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: 'Missing session_id query parameter' });
    return;
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    res.status(404).json({ valid: false, reason: 'not_found_or_expired' });
    return;
  }

  res.json({
    valid: true,
    server_name: session.serverName,
    expires_at: session.expiresAt,
  });
});

router.get('/api/editor/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const claimToken = (req.query.claim_token as string) || '';
  const session = sessionStore.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  if (session.claimToken !== null && session.claimToken !== claimToken) {
    sessionStore.delete(sessionId);
    res.status(409).json({ error: 'Session terminated: opened in another tab' });
    return;
  }

  session.claimToken = claimToken || crypto.randomUUID();

  res.json({
    session_id: session.sessionId,
    server_name: session.serverName,
    server_id: session.serverId,
    plugin_version: session.pluginVersion,
    expires_at: session.expiresAt,
    schema: session.schema,
    values: session.values,
  });
});

router.post('/api/editor/:sessionId/release', (req, res) => {
  const { sessionId } = req.params;
  const claimToken = (req.query.claim_token as string) || (req.body?.claim_token as string) || '';
  const session = sessionStore.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }
  if (session.claimToken !== null && session.claimToken !== claimToken) {
    res.status(403).json({ error: 'Not the session owner' });
    return;
  }
  session.claimToken = null;
  res.json({ status: 'released' });
});

router.post('/api/editor/apply', async (req, res) => {
  const { session_id, patch } = req.body;

  if (!session_id || !patch || !Array.isArray(patch)) {
    res.status(400).json({ error: 'Missing session_id or patch' });
    return;
  }

  const session = sessionStore.get(session_id);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  const sent = pluginSessions.sendBySessionId(session_id, { type: 'apply', session_id, patch });

  if (!sent) {
    res.status(502).json({
      error: 'Bad Gateway',
      message: 'Plugin not connected via WebSocket',
    });
    return;
  }

  const result = await new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ results: [], status: 'timeout', error: 'Plugin did not respond in time' });
    }, 15000);

    const conn = (pluginSessions as any).byServerId.get(session.serverId);
    if (!conn) {
      clearTimeout(timer);
      resolve({ results: [], status: 'error', error: 'Plugin connection lost' });
      return;
    }

    const ws = conn.ws as WebSocket;
    const handler = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'apply_result' && msg.session_id === session_id) {
          clearTimeout(timer);
          resolve(msg);
        }
      } catch {}
    };
    ws.on('message', handler);
    setTimeout(() => ws.removeListener('message', handler), 16000);
  });

  const responseData = result as any;

  if (responseData.status !== 'timeout' && responseData.status !== 'error') {
    if (responseData.status === 'applied' || responseData.results?.every?.((r: any) => r.success)) {
      for (const op of patch) {
        const parts = (op.path as string).replace(/^\//, '').split('/');
        if (parts.length === 2) {
          const [mod, key] = parts;
          if (!session.values[mod]) session.values[mod] = {};
          (session.values[mod] as Record<string, unknown>)[key] = op.value;
        }
      }
      sessionStore.touch(session_id);
    }
  }

  res.status(responseData.error ? 502 : 200).json(responseData);
});

router.post('/api/editor/cancel', (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    res.status(400).json({ error: 'Missing session_id' });
    return;
  }

  const session = sessionStore.get(session_id);
  if (!session) {
    res.status(404).json({ error: 'Session not found or expired' });
    return;
  }

  pluginSessions.sendBySessionId(session_id, { type: 'cancel', session_id });
  sessionStore.delete(session_id);
  res.json({ status: 'cancelled' });
});

export default router;
