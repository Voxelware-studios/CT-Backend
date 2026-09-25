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

function sanitizePunishment(p: any): any {
  if (!p || typeof p !== 'object') return p;
  return {
    ...p,
    id: p.id ?? 'unknown',
    player: {
      uuid: p.player?.uuid ?? null,
      name: p.player?.name ?? 'Unknown',
    },
    type: p.type ?? 'UNKNOWN',
    status: p.status ?? 'UNKNOWN',
    reason: p.reason ?? null,
    moderator: p.moderator ?? 'Unknown',
    issuedAt: p.issuedAt ?? 0,
    expiresAt: p.expiresAt ?? -1,
    duration: p.duration ?? null,
    ip: p.ip ?? null,
    pardonedBy: p.pardonedBy ?? null,
    pardonReason: p.pardonReason ?? null,
    removedAt: p.removedAt ?? null,
    expiredAt: p.expiredAt ?? null,
  };
}

function sanitizePagedResult(result: any): any {
  if (!result || typeof result !== 'object') return result;
  if (Array.isArray(result.items)) {
    return {
      ...result,
      items: result.items.map(sanitizePunishment),
    };
  }
  return result;
}

router.get('/api/moderation/:serverId/summary', async (req, res) => {
  const serverId = requireServerId(req, res);
  if (!serverId) return;

  try {
    const result = await pluginSessions.queryPlugin(serverId, 'moderation_summary');
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query plugin' });
  }
});

router.get('/api/moderation/:serverId/punishments', async (req, res) => {
  const serverId = requireServerId(req, res);
  if (!serverId) return;

  const { page, pageSize, search, type, status, sort, order } = req.query;

  try {
    const result = await pluginSessions.queryPlugin(serverId, 'moderation_list', {
      page: page ? parseInt(page as string, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : 25,
      search: search || null,
      type: type || null,
      status: status || null,
      sort: sort || null,
      order: order || null,
    });
    res.json(sanitizePagedResult(result));
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query plugin' });
  }
});

router.get('/api/moderation/:serverId/punishments/:id', async (req, res) => {
  const serverId = requireServerId(req, res);
  if (!serverId) return;

  try {
    const result = await pluginSessions.queryPlugin(serverId, 'moderation_detail', {
      id: req.params.id,
    });
    res.json(sanitizePunishment(result));
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query plugin' });
  }
});

router.get('/api/moderation/:serverId/players/:uuid/history', async (req, res) => {
  const serverId = requireServerId(req, res);
  if (!serverId) return;

  const { page, pageSize } = req.query;

  try {
    const result = await pluginSessions.queryPlugin(serverId, 'moderation_player_history', {
      uuid: req.params.uuid,
      page: page ? parseInt(page as string, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize as string, 10) : 25,
    });
    res.json(sanitizePagedResult(result));
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query plugin' });
  }
});

router.get('/api/moderation/:serverId/moderators', async (req, res) => {
  const serverId = requireServerId(req, res);
  if (!serverId) return;

  try {
    const result = await pluginSessions.queryPlugin(serverId, 'moderation_moderators');
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ error: err.message || 'Failed to query plugin' });
  }
});

export default router;
