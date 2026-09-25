import pg from 'pg';
import type { ServerRecord, StatisticsRepository } from './statistics-repository.js';

const { Pool } = pg;

export class PostgresStatisticsRepository implements StatisticsRepository {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS server_records (
          record_name VARCHAR(255) PRIMARY KEY,
          record_value BIGINT NOT NULL,
          recorded_at BIGINT NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_server_records_name ON server_records(record_name)
      `);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getRecord(recordName: string): Promise<ServerRecord | null> {
    const result = await this.pool.query(
      'SELECT record_name, record_value, recorded_at FROM server_records WHERE record_name = $1',
      [recordName]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      record_name: row.record_name,
      record_value: parseInt(row.record_value, 10),
      recorded_at: parseInt(row.recorded_at, 10),
    };
  }

  async setRecord(recordName: string, value: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO server_records (record_name, record_value, recorded_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (record_name) DO UPDATE SET
         record_value = EXCLUDED.record_value,
         recorded_at = EXCLUDED.recorded_at`,
      [recordName, value, Date.now()]
    );
  }

  async updateIfHigher(recordName: string, value: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE server_records
       SET record_value = $1, recorded_at = $2
       WHERE record_name = $3 AND record_value < $1
       RETURNING record_name`,
      [value, Date.now(), recordName]
    );
    if (result.rows.length > 0) return true;

    // Check if record exists - if not, create it
    const existing = await this.getRecord(recordName);
    if (!existing) {
      await this.setRecord(recordName, value);
      return true;
    }
    return false;
  }

  async getAllRecords(): Promise<ServerRecord[]> {
    const result = await this.pool.query(
      'SELECT record_name, record_value, recorded_at FROM server_records ORDER BY record_name'
    );
    return result.rows.map((row) => ({
      record_name: row.record_name,
      record_value: parseInt(row.record_value, 10),
      recorded_at: parseInt(row.recorded_at, 10),
    }));
  }
}
