export interface ServerRecord {
  record_name: string;
  record_value: number;
  recorded_at: number;
}

export interface StatisticsRepository {
  getRecord(recordName: string): Promise<ServerRecord | null>;
  setRecord(recordName: string, value: number): Promise<void>;
  updateIfHigher(recordName: string, value: number): Promise<boolean>;
  getAllRecords(): Promise<ServerRecord[]>;
  initialize(): Promise<void>;
  close(): Promise<void>;
}
