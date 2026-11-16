import { Router } from 'express';
import { PANEL_VERSION, SUPPORTED_PLUGIN_VERSIONS } from '../config/index.js';

const router = Router();

router.get('/api/version', (_req, res) => {
  res.json({
    panel: PANEL_VERSION,
    supported_plugin_version: SUPPORTED_PLUGIN_VERSIONS,
  });
});

export default router;
