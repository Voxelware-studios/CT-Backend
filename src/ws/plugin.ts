import { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { sessionStore } from '../sessions/store.js';

interface PluginConnection {
  ws: WebSocket;
  serverId: string;
  serverName: string;
  pluginVersion: string;
  connectedAt: number;
}

class PluginSessions {
  private byServerId = new Map<string, PluginConnection>();
  private bySessionId = new Map<string, string>();

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
          });
          ws.send(JSON.stringify({ type: 'register_ack', server_id: serverId }));
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
          }
          return;
        }
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    });

    ws.on('close', () => {
      if (serverId) {
        this.byServerId.delete(serverId);
        for (const [sid, sid2] of this.bySessionId) {
          if (sid2 === serverId) this.bySessionId.delete(sid);
        }
      }
    });

    ws.on('error', () => {
      if (serverId) {
        this.byServerId.delete(serverId);
      }
    });
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
  }

  isConnected(sessionId: string): boolean {
    const serverId = this.bySessionId.get(sessionId);
    if (!serverId) return false;
    const conn = this.byServerId.get(serverId);
    return !!conn && conn.ws.readyState === WebSocket.OPEN;
  }
}

export const pluginSessions = new PluginSessions();
