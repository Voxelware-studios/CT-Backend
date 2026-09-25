import db from '../database/index.js';
import { getStatisticsRepository } from '../database/statistics-factory.js';

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;

interface HealthReportPayload {
  overall_state?: string;
  components?: Array<{
    name: string;
    state: string;
    message: string;
    details: Record<string, unknown>;
  }>;
  server_info?: Record<string, unknown>;
}

interface RegisterPayload {
  server_id: string;
  server_name?: string;
  plugin_version?: string;
}

function extractServerInfo(report: HealthReportPayload): {
  serverSoftware: string;
  minecraftVersion: string;
  javaVersion: string;
  isFolia: boolean;
  isOnlineMode: boolean;
  playerCount: number;
  maxPlayers: number;
  tps: number;
} {
  const info = report.server_info || {};
  const serverComponent = report.components?.find((c) => c.name === 'Server');
  const details = serverComponent?.details || {};

  const software = (info.server_software as string)
    || (details.serverSoftware as string)
    || 'Unknown';
  const mcVersion = (info.minecraft_version as string)
    || (details.minecraftVersion as string)
    || 'Unknown';
  const javaVersion = (info.java_version as string)
    || (details.javaVersion as string)
    || 'Unknown';
  const isFolia = (info.is_folia as boolean)
    || (details.isFolia as boolean)
    || false;
  const isOnlineMode = (info.online_mode as boolean)
    ?? (details.onlineMode as boolean)
    ?? true;
  const playerCount = (info.online_players as number)
    || (details.online_players as number)
    || 0;
  const maxPlayers = (info.max_players as number)
    || (details.max_players as number)
    || 0;
  const tpsArr = (details.tps as number[]) || [];
  const tps = (info.tps_1m as number)
    || (details.tps_1m as number)
    || (tpsArr.length > 0 ? tpsArr[0] : 20);

  return { serverSoftware: software, minecraftVersion: mcVersion, javaVersion, isFolia, isOnlineMode, playerCount, maxPlayers, tps };
}

function extractModules(report: HealthReportPayload): string[] {
  const coretuffComponent = report.components?.find((c) => c.name === 'CoreTuff');
  if (!coretuffComponent?.details) return [];

  const modules = coretuffComponent.details.active_modules;
  if (Array.isArray(modules)) return modules as string[];
  if (typeof modules === 'string') return (modules as string).split(',').map((m) => m.trim());
  return [];
}

function extractIntegrations(report: HealthReportPayload): string[] {
  const integrationComponent = report.components?.find((c) => c.name === 'Integrations');
  if (!integrationComponent?.details) return [];

  const integrations = integrationComponent.details.integrations;
  if (Array.isArray(integrations)) {
    return (integrations as Array<{ name: string; status: string }>)
      .filter((i) => i.status === 'ACTIVE')
      .map((i) => i.name);
  }
  return [];
}

export function recordPluginConnect(payload: RegisterPayload): void {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO installations (id, first_seen, last_seen, is_active)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      last_seen = excluded.last_seen,
      is_active = 1
  `);
  stmt.run(payload.server_id, now, now);
}

export function recordPluginDisconnect(serverId: string): void {
  const stmt = db.prepare(`
    UPDATE installations SET is_active = 0 WHERE id = ?
  `);
  stmt.run(serverId);
}

export function recordHealthUpdate(serverId: string, report: HealthReportPayload): void {
  const now = Date.now();
  const info = extractServerInfo(report);
  const modules = extractModules(report);
  const integrations = extractIntegrations(report);

  db.prepare(`
    UPDATE installations SET
      last_seen = ?,
      is_active = 1,
      server_software = ?,
      minecraft_version = ?,
      java_version = ?,
      coretuff_version = ?,
      is_folia = ?,
      is_online_mode = ?,
      player_count = ?,
      max_players = ?
    WHERE id = ?
  `).run(
    now,
    info.serverSoftware,
    info.minecraftVersion,
    info.javaVersion,
    (report.server_info?.plugin_version as string) || 'unknown',
    info.isFolia ? 1 : 0,
    info.isOnlineMode ? 1 : 0,
    info.playerCount,
    info.maxPlayers,
    serverId,
  );

  // Track historical records asynchronously
  if (info.playerCount > 0) {
    getStatisticsRepository().then(repo => {
      repo.updateIfHigher('highest_concurrent_players', info.playerCount).catch(() => {});
    }).catch(() => {});
  }

  const lastSnapshot = db.prepare(`
    SELECT timestamp FROM snapshots
    WHERE installation_id = ?
    ORDER BY timestamp DESC LIMIT 1
  `).get(serverId) as { timestamp: number } | undefined;

  if (!lastSnapshot || (now - lastSnapshot.timestamp) >= SNAPSHOT_INTERVAL_MS) {
    const result = db.prepare(`
      INSERT INTO snapshots (installation_id, timestamp, player_count, max_players, server_software, minecraft_version, java_version, coretuff_version, is_folia, is_online_mode, tps)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      serverId, now, info.playerCount, info.maxPlayers,
      info.serverSoftware, info.minecraftVersion, info.javaVersion,
      (report.server_info?.plugin_version as string) || 'unknown',
      info.isFolia ? 1 : 0, info.isOnlineMode ? 1 : 0, info.tps,
    );

    const snapshotId = result.lastInsertRowid;

    const insertModule = db.prepare(`
      INSERT INTO snapshot_modules (snapshot_id, module_name, is_enabled) VALUES (?, ?, 1)
    `);
    for (const mod of modules) {
      insertModule.run(snapshotId, mod);
    }

    const insertIntegration = db.prepare(`
      INSERT INTO snapshot_integrations (snapshot_id, integration_name, is_active) VALUES (?, ?, 1)
    `);
    for (const integ of integrations) {
      insertIntegration.run(snapshotId, integ);
    }
  }
}

function markStaleInstallations(): void {
  const threshold = Date.now() - ACTIVE_THRESHOLD_MS;
  db.prepare(`
    UPDATE installations SET is_active = 0
    WHERE is_active = 1 AND last_seen < ?
  `).run(threshold);
}

export function getOverview(): {
  totalServers: number;
  activeServers: number;
  recordServers: number;
  totalPlayers: number;
  recordPlayers: number;
} {
  markStaleInstallations();

  const active = db.prepare(`
    SELECT COUNT(*) as count FROM installations WHERE is_active = 1
  `).get() as { count: number };

  const total = db.prepare(`
    SELECT COUNT(DISTINCT id) as count FROM installations
  `).get() as { count: number };

  const maxConcurrent = db.prepare(`
    SELECT MAX(active_count) as max FROM (
      SELECT COUNT(*) as active_count, (timestamp / 3600000) as hour_bucket
      FROM snapshots
      WHERE timestamp > ?
      GROUP BY hour_bucket
    )
  `).get(Date.now() - 7 * 24 * 60 * 60 * 1000) as { max: number | null };

  const players = db.prepare(`
    SELECT COALESCE(SUM(player_count), 0) as total FROM installations WHERE is_active = 1
  `).get() as { total: number };

  const recordPlayers = db.prepare(`
    SELECT MAX(player_count) as max FROM snapshots
  `).get() as { max: number | null };

  return {
    totalServers: total.count,
    activeServers: active.count,
    recordServers: maxConcurrent.max || total.count,
    totalPlayers: players.total,
    recordPlayers: recordPlayers.max || players.total,
  };
}

export function getServerHistory(range: string): Array<{ date: string; count: number }> {
  const since = getRangeStart(range);
  const rows = db.prepare(`
    SELECT DATE(timestamp / 1000, 'unixepoch') as date,
           COUNT(DISTINCT installation_id) as count
    FROM snapshots
    WHERE timestamp >= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(since) as Array<{ date: string; count: number }>;
  return rows;
}

export function getPlayerHistory(range: string): Array<{ date: string; count: number }> {
  const since = getRangeStart(range);
  const rows = db.prepare(`
    SELECT DATE(timestamp / 1000, 'unixepoch') as date,
           SUM(player_count) as count
    FROM snapshots
    WHERE timestamp >= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(since) as Array<{ date: string; count: number }>;
  return rows;
}

export function getPlatformStats(): {
  serverSoftware: Array<{ name: string; count: number; percentage: number }>;
  minecraftVersion: Array<{ name: string; count: number; percentage: number }>;
  javaVersion: Array<{ name: string; count: number; percentage: number }>;
  coretuffVersion: Array<{ name: string; count: number; percentage: number }>;
} {
  markStaleInstallations();

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM installations WHERE is_active = 1
  `).get() as { count: number };
  const totalN = total.count || 1;

  const software = db.prepare(`
    SELECT server_software as name, COUNT(*) as count
    FROM installations WHERE is_active = 1 AND server_software IS NOT NULL
    GROUP BY server_software ORDER BY count DESC
  `).all() as Array<{ name: string; count: number }>;

  const mcVersion = db.prepare(`
    SELECT minecraft_version as name, COUNT(*) as count
    FROM installations WHERE is_active = 1 AND minecraft_version IS NOT NULL
    GROUP BY minecraft_version ORDER BY count DESC
  `).all() as Array<{ name: string; count: number }>;

  const java = db.prepare(`
    SELECT java_version as name, COUNT(*) as count
    FROM installations WHERE is_active = 1 AND java_version IS NOT NULL
    GROUP BY java_version ORDER BY count DESC
  `).all() as Array<{ name: string; count: number }>;

  const ctVersion = db.prepare(`
    SELECT coretuff_version as name, COUNT(*) as count
    FROM installations WHERE is_active = 1 AND coretuff_version IS NOT NULL
    GROUP BY coretuff_version ORDER BY count DESC
  `).all() as Array<{ name: string; count: number }>;

  return {
    serverSoftware: software.map((s) => ({ ...s, percentage: Math.round((s.count / totalN) * 100) })),
    minecraftVersion: mcVersion.map((v) => ({ ...v, percentage: Math.round((v.count / totalN) * 100) })),
    javaVersion: java.map((j) => ({ ...j, percentage: Math.round((j.count / totalN) * 100) })),
    coretuffVersion: ctVersion.map((v) => ({ ...v, percentage: Math.round((v.count / totalN) * 100) })),
  };
}

export function getModuleStats(): Array<{ name: string; count: number; percentage: number }> {
  markStaleInstallations();

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM installations WHERE is_active = 1
  `).get() as { count: number };
  const totalN = total.count || 1;

  const modules = db.prepare(`
    SELECT sm.module_name as name, COUNT(DISTINCT s.installation_id) as count
    FROM snapshot_modules sm
    JOIN snapshots s ON sm.snapshot_id = s.id
    JOIN installations i ON s.installation_id = i.id
    WHERE i.is_active = 1 AND sm.is_enabled = 1
    GROUP BY sm.module_name
    ORDER BY count DESC
  `).all() as Array<{ name: string; count: number }>;

  return modules.map((m) => ({ ...m, percentage: Math.round((m.count / totalN) * 100) }));
}

export function getIntegrationStats(): Array<{ name: string; count: number; percentage: number }> {
  markStaleInstallations();

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM installations WHERE is_active = 1
  `).get() as { count: number };
  const totalN = total.count || 1;

  const integrations = db.prepare(`
    SELECT si.integration_name as name, COUNT(DISTINCT s.installation_id) as count
    FROM snapshot_integrations si
    JOIN snapshots s ON si.snapshot_id = s.id
    JOIN installations i ON s.installation_id = i.id
    WHERE i.is_active = 1 AND si.is_active = 1
    GROUP BY si.integration_name
    ORDER BY count DESC
  `).all() as Array<{ name: string; count: number }>;

  return integrations.map((i) => ({ ...i, percentage: Math.round((i.count / totalN) * 100) }));
}

export function getEnvironmentStats(): {
  onlineMode: Array<{ name: string; count: number; percentage: number }>;
  foliaDistribution: Array<{ name: string; count: number; percentage: number }>;
} {
  markStaleInstallations();

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM installations WHERE is_active = 1
  `).get() as { count: number };
  const totalN = total.count || 1;

  const onlineMode = db.prepare(`
    SELECT
      CASE WHEN is_online_mode = 1 THEN 'Online' ELSE 'Offline' END as name,
      COUNT(*) as count
    FROM installations WHERE is_active = 1
    GROUP BY is_online_mode
  `).all() as Array<{ name: string; count: number }>;

  const folia = db.prepare(`
    SELECT
      CASE WHEN is_folia = 1 THEN 'Folia' ELSE 'Paper' END as name,
      COUNT(*) as count
    FROM installations WHERE is_active = 1
    GROUP BY is_folia
  `).all() as Array<{ name: string; count: number }>;

  return {
    onlineMode: onlineMode.map((o) => ({ ...o, percentage: Math.round((o.count / totalN) * 100) })),
    foliaDistribution: folia.map((f) => ({ ...f, percentage: Math.round((f.count / totalN) * 100) })),
  };
}

function getRangeStart(range: string): number {
  const now = Date.now();
  switch (range) {
    case '1d': return now - 1 * 24 * 60 * 60 * 1000;
    case '1w': return now - 7 * 24 * 60 * 60 * 1000;
    case '1m': return now - 30 * 24 * 60 * 60 * 1000;
    case '3m': return now - 90 * 24 * 60 * 60 * 1000;
    case '1y': return now - 365 * 24 * 60 * 60 * 1000;
    default: return 0;
  }
}
