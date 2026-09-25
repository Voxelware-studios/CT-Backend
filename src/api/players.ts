import { Router } from 'express';
import { pluginSessions } from '../ws/plugin.js';

const router = Router();

function requireServerId(req: any, res: any): string | null {
  const serverId = req.params.serverId;
  if (!serverId) {
    res.status(400).json({ error: 'Missing serverId' });
    return null;
  }
  return serverId;
}

router.get('/api/players/:serverId', async (req, res) => {
  const serverId = requireServerId(req, res);
  if (!serverId) return;

  const { search } = req.query;

  try {
    const result = await pluginSessions.queryPlugin(serverId, 'player_list', {
      search: search || null,
    });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query plugin' });
  }
});

router.get('/api/players/:serverId/search', async (req, res) => {
  const serverId = requireServerId(req, res);
  if (!serverId) return;

  const { q } = req.query;
  if (!q) {
    res.status(400).json({ error: 'Missing search query' });
    return;
  }

  try {
    const result = await pluginSessions.queryPlugin(serverId, 'player_search', {
      query: q,
    });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query plugin' });
  }
});

router.get('/api/players/:serverId/:uuid', async (req, res) => {
  const serverId = requireServerId(req, res);
  if (!serverId) return;

  try {
    const result = await pluginSessions.queryPlugin(serverId, 'player_detail', {
      uuid: req.params.uuid,
    });
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query plugin' });
  }
});

export default router;
