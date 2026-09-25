import { Router } from 'express';
import { getStatisticsRepository } from '../database/statistics-factory.js';

const router = Router();

router.get('/api/stats/records', async (_req, res) => {
  try {
    const repo = await getStatisticsRepository();
    const records = await repo.getAllRecords();
    res.json({ records });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load records' });
  }
});

router.get('/api/stats/records/:recordName', async (req, res) => {
  try {
    const repo = await getStatisticsRepository();
    const record = await repo.getRecord(req.params.recordName);
    if (!record) {
      res.json({ record_name: req.params.recordName, record_value: 0, recorded_at: 0 });
      return;
    }
    res.json(record);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to load record' });
  }
});

export default router;
