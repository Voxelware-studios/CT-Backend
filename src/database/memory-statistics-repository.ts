import type { ServerRecord, StatisticsRepository } from './statistics-repository.js';

export class MemoryStatisticsRepository implements StatisticsRepository {
  private records = new Map<string, ServerRecord>();

  async initialize(): Promise<void> {
    // No initialization needed for in-memory storage
  }

  async close(): Promise<void> {
    // No cleanup needed for in-memory storage
  }

  async getRecord(recordName: string): Promise<ServerRecord | null> {
    return this.records.get(recordName) || null;
  }

  async setRecord(recordName: string, value: number): Promise<void> {
    this.records.set(recordName, {
      record_name: recordName,
      record_value: value,
      recorded_at: Date.now(),
    });
  }

  async updateIfHigher(recordName: string, value: number): Promise<boolean> {
    const existing = this.records.get(recordName);
    if (!existing || value > existing.record_value) {
      await this.setRecord(recordName, value);
      return true;
    }
    return false;
  }

  async getAllRecords(): Promise<ServerRecord[]> {
    return Array.from(this.records.values());
  }
}
