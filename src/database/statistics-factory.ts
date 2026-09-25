import type { StatisticsRepository } from './statistics-repository.js';
import { MemoryStatisticsRepository } from './memory-statistics-repository.js';
import { PostgresStatisticsRepository } from './postgres-statistics-repository.js';

let statisticsRepo: StatisticsRepository | null = null;

export async function getStatisticsRepository(): Promise<StatisticsRepository> {
  if (statisticsRepo) return statisticsRepo;

  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    console.log('Using PostgreSQL statistics repository');
    const repo = new PostgresStatisticsRepository(databaseUrl);
    await repo.initialize();
    statisticsRepo = repo;
  } else {
    console.log('Using in-memory statistics repository (development mode)');
    const repo = new MemoryStatisticsRepository();
    await repo.initialize();
    statisticsRepo = repo;
  }

  return statisticsRepo;
}

export async function closeStatisticsRepository(): Promise<void> {
  if (statisticsRepo) {
    await statisticsRepo.close();
    statisticsRepo = null;
  }
}
