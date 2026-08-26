export interface SettingDefinition {
  key: string;
  type: string;
  default?: unknown;
  description?: string;
  category?: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface EditorSession {
  sessionId: string;
  serverName: string;
  pluginVersion: string;
  pluginAddress: string;
  serverId: string;
  createdAt: number;
  expiresAt: number;
  schema: Record<string, SettingDefinition[]>;
  values: Record<string, Record<string, unknown>>;
  applied: boolean;
  claimToken: string | null;
}

type ExpireCallback = (sessionId: string, serverId: string, reason: string) => void;

class SessionStore {
  private sessions = new Map<string, EditorSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private expireCallback: ExpireCallback | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 30_000);
  }

  onExpire(callback: ExpireCallback): void {
    this.expireCallback = callback;
  }

  create(data: Omit<EditorSession, 'createdAt' | 'expiresAt' | 'applied' | 'claimToken'>): EditorSession {
    const now = Date.now();
    const session: EditorSession = {
      ...data,
      createdAt: now,
      expiresAt: now + 300_000,
      applied: false,
      claimToken: null,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  private readonly expiryExtensionMs = 300_000;

  get(sessionId: string): EditorSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      this.expireCallback?.(sessionId, session.serverId, 'Session expired');
      return undefined;
    }
    return session;
  }

  touch(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.expiresAt = Date.now() + this.expiryExtensionMs;
    }
  }

  updateValues(sessionId: string, values: Record<string, Record<string, unknown>>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.values = values;
    session.expiresAt = Date.now() + this.expiryExtensionMs;
    return true;
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
        this.expireCallback?.(id, session.serverId, 'Heartbeat timeout');
      }
    }
  }

  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.sessions.clear();
  }

  get size(): number {
    return this.sessions.size;
  }
}

export const sessionStore = new SessionStore();
