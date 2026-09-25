import { readFileSync, existsSync } from 'node:fs';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  host: string;
  ssl: { cert: string; key: string } | null;
}

/** Web panel version. Keep in sync with frontend/src/lib/version.ts (APP_VERSION). */
export const PANEL_VERSION = 'v1.0-Alpha-3';

/**
 * Only this CoreTuff plugin version is accepted by this panel build.
 * Older (and newer) versions are rejected at WebSocket registration and session creation.
 * Keep in sync with frontend/src/lib/version.ts (SUPPORTED_PLUGIN_VERSION).
 */
export const SUPPORTED_PLUGIN_VERSION = '2.0-Nightly-3';

export function isSupportedPluginVersion(version: unknown): boolean {
  return typeof version === 'string' && version.trim() === SUPPORTED_PLUGIN_VERSION;
}

function loadConfig(): AppConfig {
  const port = parseInt(process.env.PORT || '25570', 10);
  const nodeEnv = process.env.NODE_ENV || 'development';
  const host = process.env.HOST || '0.0.0.0';

  let ssl: AppConfig['ssl'] = null;
  const certPath = process.env.SSL_CERT_PATH || '';
  const keyPath = process.env.SSL_KEY_PATH || '';
  const certEnv = process.env.SSL_CERT || '';
  const keyEnv = process.env.SSL_KEY || '';

  if (certPath && keyPath && existsSync(certPath) && existsSync(keyPath)) {
    ssl = { cert: readFileSync(certPath, 'utf-8'), key: readFileSync(keyPath, 'utf-8') };
  } else if (certEnv && keyEnv) {
    ssl = { cert: certEnv, key: keyEnv };
  }

  return { port, nodeEnv, host, ssl };
}

export const config = loadConfig();
