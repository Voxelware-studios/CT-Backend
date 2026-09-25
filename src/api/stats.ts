import { Router } from 'express';
import {
  getOverview,
  getServerHistory,
  getPlayerHistory,
  getPlatformStats,
  getModuleStats,
  getIntegrationStats,
  getEnvironmentStats,
} from '../services/stats.js';

const router = Router();

const VALID_RANGES = new Set(['1d', '1w', '1m', '3m', '1y', 'all']);

function validateRange(range: string): string {
  if (!range || !VALID_RANGES.has(range.toLowerCase())) return 'all';
  return range.toLowerCase();
}

router.get('/api/stats/overview', (_req, res) => {
  try {
    const overview = getOverview();
    res.json(overview);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load overview statistics' });
  }
});

router.get('/api/stats/servers', (req, res) => {
  try {
    const range = validateRange(req.query.range as string);
    const history = getServerHistory(range);
    res.json({ range, data: history });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load server statistics' });
  }
});

router.get('/api/stats/players', (req, res) => {
  try {
    const range = validateRange(req.query.range as string);
    const history = getPlayerHistory(range);
    res.json({ range, data: history });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load player statistics' });
  }
});

router.get('/api/stats/platforms', (_req, res) => {
  try {
    const platforms = getPlatformStats();
    res.json(platforms);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load platform statistics' });
  }
});

router.get('/api/stats/modules', (_req, res) => {
  try {
    const modules = getModuleStats();
    res.json({ modules });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load module statistics' });
  }
});

router.get('/api/stats/integrations', (_req, res) => {
  try {
    const integrations = getIntegrationStats();
    res.json({ integrations });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load integration statistics' });
  }
});

router.get('/api/stats/environment', (_req, res) => {
  try {
    const environment = getEnvironmentStats();
    res.json(environment);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load environment statistics' });
  }
});

export default router;
