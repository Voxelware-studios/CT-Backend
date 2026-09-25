import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

class RequestResponseManager {
  private pending = new Map<string, PendingRequest>();

  generateRequestId(): string {
    return randomUUID();
  }

  createRequest(
    ws: WebSocket,
    action: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    messageType: string = 'moderation_query',
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();

      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });

      const msg = JSON.stringify({
        type: messageType,
        requestId,
        action,
        params,
      });

      ws.send(msg);
    });
  }

  resolve(requestId: string, data: unknown): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.resolve(data);
    return true;
  }

  reject(requestId: string, error: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    pending.reject(new Error(error));
    return true;
  }

  cleanup(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }
}

export const requestResponseManager = new RequestResponseManager();
