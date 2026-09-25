import { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { sessionStore } from '../sessions/store.js';
import { requestResponseManager } from './request-response.js';
import { recordPluginConnect, recordPluginDisconnect, recordHealthUpdate } from '../services/stats.js';
import { PANEL_VERSION, SUPPORTED_PLUGIN_VERSION, isSupportedPluginVersion } from '../config/index.js';

const HEARTBEAT_TIMEOUT_MS = 30_000;

interface PluginConnection {
  ws: WebSocket;
  serverId: string;
  serverName: string;
  pluginVersion: string;
  connectedAt: number;
  lastHeartbeat: number;
  lastHealth?: unknown;
  lastPlayers?: unknown;
  status: 'connected' | 'disconnected';
}

class PluginSessions {
  private byServerId = new Map<string, PluginConnection>();
  private bySessionId = new Map<string, string>();
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.timeoutTimer = setInterval(() => this.checkHeartbeats(), 10_000);
    sessionStore.onExpire((sessionId, serverId, reason) => {
      this.sendByServerId(serverId, {
        type: 'session_expired',
        session_id: sessionId,
        reason,
      });
    });
  }

  handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    let serverId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'register') {
          serverId = msg.server_id;
          if (!serverId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Missing server_id' }));
            return;
          }
          if (!isSupportedPluginVersion(msg.plugin_version)) {
            console.warn(
              `Rejected plugin connection from "${serverId}" (${msg.server_name || 'unknown'}): ` +
                `CoreTuff ${msg.plugin_version || 'unknown'} is not supported by panel ${PANEL_VERSION} ` +
                `(requires CoreTuff ${SUPPORTED_PLUGIN_VERSION}).`,
            );
            try {
              ws.send(
                JSON.stringify({
                  type: 'register_rejected',
                  server_id: serverId,
                  received_version: msg.plugin_version || 'unknown',
                  supported_version: SUPPORTED_PLUGIN_VERSION,
                  panel_version: PANEL_VERSION,
                  message:
                    `This web panel (${PANEL_VERSION}) only supports CoreTuff ${SUPPORTED_PLUGIN_VERSION}. ` +
                    `Your server is running CoreTuff ${msg.plugin_version || 'unknown'} — please update CoreTuff.`,
                }),
              );
            } catch { /* socket may already be closing */ }
            ws.close(4003, 'unsupported plugin version');
            return;
          }
          const existing = this.byServerId.get(serverId);
          if (existing) {
            existing.ws.close(1000, 'replaced');
          }
          this.byServerId.set(serverId, {
            ws,
            serverId,
            serverName: msg.server_name || 'unknown',
            pluginVersion: msg.plugin_version || 'unknown',
            connectedAt: Date.now(),
            lastHeartbeat: Date.now(),
            status: 'connected',
          });
          try {
            recordPluginConnect({ server_id: serverId, server_name: msg.server_name, plugin_version: msg.plugin_version });
          } catch { /* stats recording should never break the session */ }
          ws.send(JSON.stringify({ type: 'register_ack', server_id: serverId }));
          return;
        }

        if (msg.type === 'heartbeat') {
          this.handleHeartbeat(msg);
          return;
        }

        if (msg.type === 'apply_result') {
          this.handleApplyResult(msg);
          return;
        }

        if (msg.type === 'cancel_ack') {
          const sid = msg.session_id;
          if (sid) {
            this.bySessionId.delete(sid);
          }
          return;
        }

        if (msg.type === 'session_created') {
          const sid = msg.session_id;
          if (sid && serverId) {
            this.bySessionId.set(sid, serverId);
            const conn = this.byServerId.get(serverId);
            if (conn) {
              conn.lastHeartbeat = Date.now();
            }
          }
          return;
        }

        if (msg.type === 'health_update') {
          if (serverId) {
            const conn = this.byServerId.get(serverId);
            if (conn) {
              conn.lastHealth = msg.payload || msg;
            }
            try {
              recordHealthUpdate(serverId, (msg.payload || msg) as any);
            } catch { /* stats recording should never break the session */ }
          }
          return;
        }

        if (msg.type === 'moderation_response') {
          if (msg.requestId) {
            if (msg.error) {
              requestResponseManager.reject(msg.requestId, msg.error);
            } else {
              requestResponseManager.resolve(msg.requestId, msg.result);
            }
          }
          return;
        }

        if (msg.type === 'player_response') {
          if (msg.requestId) {
            if (msg.error) {
              requestResponseManager.reject(msg.requestId, msg.error);
            } else {
              requestResponseManager.resolve(msg.requestId, msg.result);
            }
          }
          return;
        }

        if (msg.type === 'player_snapshot') {
          if (serverId) {
            const conn = this.byServerId.get(serverId);
            if (conn) {
              conn.lastPlayers = msg.payload || msg;
            }
          }
          return;
        }

        if (msg.type === 'player_update') {
          if (serverId) {
            const conn = this.byServerId.get(serverId);
            if (conn && msg.payload) {
              const payload = msg.payload as any;
              const current = conn.lastPlayers as any;
              if (current && current.players) {
                if (payload.action === 'leave' && payload.player?.uuid) {
                  current.players = current.players.filter((p: any) => p.uuid !== payload.player.uuid);
                  current.online_count = current.players.length;
                } else if (payload.action === 'join' && payload.player) {
                  const exists = current.players.find((p: any) => p.uuid === payload.player.uuid);
                  if (!exists) {
                    current.players.push(payload.player);
                    current.online_count = current.players.length;
                  }
                } else if (payload.player?.uuid) {
                  const idx = current.players.findIndex((p: any) => p.uuid === payload.player.uuid);
                  if (idx >= 0) {
                    current.players[idx] = { ...current.players[idx], ...payload.player };
                  }
                }
              }
            }
          }
          return;
        }

        if (msg.type === 'moderation_update') {
          if (serverId) {
            const sessionIds = this.getSessionsForServer(serverId);
            for (const sid of sessionIds) {
              this.sendToSessionViewers(sid, {
                type: 'moderation_update',
                timestamp: msg.timestamp || Date.now(),
              });
            }
          }
          return;
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      if (serverId) {
        const conn = this.byServerId.get(serverId);
        if (conn) {
          conn.status = 'disconnected';
        }
        try {
          recordPluginDisconnect(serverId);
        } catch { /* stats recording should never break the session */ }
        this.notifyFrontendDisconnection(serverId);
      }
    });

    ws.on('error', () => {
      if (serverId) {
        const conn = this.byServerId.get(serverId);
        if (conn) {
          conn.status = 'disconnected';
        }
      }
    });
  }

  private handleHeartbeat(msg: any): void {
    const serverId = msg.server_id;
    if (!serverId) return;
    const conn = this.byServerId.get(serverId);
    if (!conn) return;

    conn.lastHeartbeat = Date.now();
    conn.status = 'connected';

    conn.ws.send(JSON.stringify({
      type: 'heartbeat_ack',
      server_id: serverId,
      timestamp: Date.now(),
    }));

    const sessionIds = this.getSessionsForServer(serverId);
    for (const sid of sessionIds) {
      sessionStore.touch(sid);
    }
  }

  private handleApplyResult(msg: any): void {
    const sid = msg.session_id;
    if (!sid) return;
    const session = sessionStore.get(sid);
    if (!session) return;
    if (msg.status === 'applied' || msg.results?.every((r: any) => r.success)) {
      sessionStore.touch(sid);
    }
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    for (const [serverId, conn] of this.byServerId) {
      if (conn.status === 'connected') {
        const elapsed = now - conn.lastHeartbeat;
        if (elapsed > HEARTBEAT_TIMEOUT_MS) {
          conn.status = 'disconnected';
          this.notifyFrontendDisconnection(serverId);
        }
      }
    }
  }

  private notifyFrontendDisconnection(serverId: string): void {
    const sessionIds = this.getSessionsForServer(serverId);
    for (const sid of sessionIds) {
      const session = sessionStore.get(sid);
      if (session) {
        this.sendToSessionViewers(sid, {
          type: 'server_status',
          status: 'disconnected',
          server_id: serverId,
          timestamp: Date.now(),
        });
      }
    }
  }

  private sendToSessionViewers(sessionId: string, data: unknown): void {
    // This is a no-op for now; the frontend polls health status
    // Future: could use server-sent events or extend WebSocket
  }

  private getSessionsForServer(serverId: string): string[] {
    const sessions: string[] = [];
    for (const [sid, sid2] of this.bySessionId) {
      if (sid2 === serverId) sessions.push(sid);
    }
    return sessions;
  }

  sendByServerId(serverId: string, data: unknown): boolean {
    const conn = this.byServerId.get(serverId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return false;
    conn.ws.send(JSON.stringify(data));
    return true;
  }

  sendBySessionId(sessionId: string, data: unknown): boolean {
    const serverId = this.bySessionId.get(sessionId);
    if (!serverId) return false;
    return this.sendByServerId(serverId, data);
  }

  registerSession(sessionId: string, serverId: string): void {
    this.bySessionId.set(sessionId, serverId);
    const conn = this.byServerId.get(serverId);
    if (conn) {
      conn.lastHeartbeat = Date.now();
    }
  }

  isConnected(sessionId: string): boolean {
    const serverId = this.bySessionId.get(sessionId);
    if (!serverId) return false;
    const conn = this.byServerId.get(serverId);
    return !!conn && conn.ws.readyState === WebSocket.OPEN && conn.status === 'connected';
  }

  getServerStatus(serverId: string): string {
    const conn = this.byServerId.get(serverId);
    if (!conn) return 'disconnected';
    if (conn.ws.readyState !== WebSocket.OPEN) return 'disconnected';
    return conn.status;
  }

  getHealthByServerId(serverId: string): unknown | null {
    const conn = this.byServerId.get(serverId);
    return conn?.lastHealth || null;
  }

  getPlayersByServerId(serverId: string): unknown | null {
    const conn = this.byServerId.get(serverId);
    return conn?.lastPlayers || null;
  }

  getConnectedServers(): Array<{
    serverId: string;
    serverName: string;
    pluginVersion: string;
    connectedAt: number;
    hasHealth: boolean;
    status: string;
    lastHeartbeat: number;
  }> {
    const servers: Array<{
      serverId: string;
      serverName: string;
      pluginVersion: string;
      connectedAt: number;
      hasHealth: boolean;
      status: string;
      lastHeartbeat: number;
    }> = [];
    for (const conn of this.byServerId.values()) {
      servers.push({
        serverId: conn.serverId,
        serverName: conn.serverName,
        pluginVersion: conn.pluginVersion,
        connectedAt: conn.connectedAt,
        hasHealth: !!conn.lastHealth,
        status: conn.status,
        lastHeartbeat: conn.lastHeartbeat,
      });
    }
    return servers;
  }

  destroy(): void {
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    requestResponseManager.cleanup();
  }

  queryPlugin(
    serverId: string,
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs = 15_000,
  ): Promise<unknown> {
    const conn = this.byServerId.get(serverId);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Server not connected'));
    }
    const messageType = action.startsWith('player_') ? 'player_query' : 'moderation_query';
    return requestResponseManager.createRequest(conn.ws, action, params, timeoutMs, messageType);
  }
}

export const pluginSessions = new PluginSessions();
