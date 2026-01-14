import { io, Socket } from 'socket.io-client';

// Use window.location.origin in production, localhost in development
const WS_BASE_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.MODE === 'development' ? 'http://localhost:3001' : window.location.origin);

class WebSocketService {
  private baseUrl: string;
  private serversSocket: Socket | null = null;
  private consoleSocket: Socket | null = null;

  constructor(baseUrl: string = WS_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private getToken(): string | null {
    return localStorage.getItem('accessToken');
  }

  // ============================================
  // Server Events (/servers namespace)
  // ============================================

  connectToServers(): Socket {
    if (this.serversSocket?.connected) {
      return this.serversSocket;
    }

    if (this.serversSocket) {
      this.serversSocket.disconnect();
    }

    this.serversSocket = io(`${this.baseUrl}/servers`, {
      transports: ['websocket', 'polling'],
      // Use function to always get fresh token on reconnect
      auth: (cb) => cb({ token: this.getToken() }),
    });

    this.serversSocket.on('connect', () => {
      console.log('[WS] Connected to /servers');
    });

    this.serversSocket.on('connect_error', (err) => {
      console.error('[WS] /servers error:', err.message);
    });

    return this.serversSocket;
  }

  subscribeToServer(serverId: string, callbacks: {
    onStatus?: (data: any) => void;
    onMetrics?: (data: any) => void;
  }): () => void {
    const socket = this.connectToServers();

    const subscribe = () => {
      socket.emit('subscribe', { serverId });
    };

    if (socket.connected) {
      subscribe();
    } else {
      socket.once('connect', subscribe);
    }

    if (callbacks.onStatus) {
      socket.on('server:status', (data: any) => {
        if (data.serverId === serverId) callbacks.onStatus!(data);
      });
    }

    if (callbacks.onMetrics) {
      socket.on('server:metrics', (data: any) => {
        if (data.serverId === serverId) callbacks.onMetrics!(data);
      });
    }

    return () => {
      socket.emit('unsubscribe', { serverId });
    };
  }

  disconnectFromServers(): void {
    this.serversSocket?.disconnect();
    this.serversSocket = null;
  }

  // ============================================
  // Console Events (/console namespace)
  // ============================================

  connectToConsole(): Socket {
    if (this.consoleSocket?.connected) {
      return this.consoleSocket;
    }

    if (this.consoleSocket) {
      this.consoleSocket.disconnect();
    }

    this.consoleSocket = io(`${this.baseUrl}/console`, {
      transports: ['websocket', 'polling'],
      // Use function to always get fresh token on reconnect
      auth: (cb) => cb({ token: this.getToken() }),
    });

    this.consoleSocket.on('connect', () => {
      console.log('[WS] Connected to /console');
    });

    this.consoleSocket.on('connect_error', (err) => {
      console.error('[WS] /console error:', err.message);
    });

    return this.consoleSocket;
  }

  subscribeToConsole(serverId: string, callbacks: {
    onLog?: (data: any) => void;
    onHistoricalLogs?: (data: any) => void;
    onCommandResponse?: (data: any) => void;
  }): () => void {
    const socket = this.connectToConsole();

    const subscribe = () => {
      console.log('[WS] Subscribing to console:', serverId);
      socket.emit('subscribe', { serverId });
    };

    if (socket.connected) {
      subscribe();
    } else {
      socket.once('connect', subscribe);
    }

    if (callbacks.onLog) {
      socket.on('log', (data: any) => {
        if (data.serverId === serverId) callbacks.onLog!(data);
      });
    }

    if (callbacks.onHistoricalLogs) {
      socket.on('logs:history', (data: any) => {
        if (data.serverId === serverId) callbacks.onHistoricalLogs!(data);
      });
    }

    if (callbacks.onCommandResponse) {
      socket.on('commandResponse', (data: any) => {
        if (data.serverId === serverId) callbacks.onCommandResponse!(data);
      });
    }

    return () => {
      socket.emit('unsubscribe', { serverId });
    };
  }

  sendCommand(serverId: string, command: string): void {
    const socket = this.connectToConsole();
    if (socket.connected) {
      socket.emit('command', { serverId, command });
    } else {
      socket.once('connect', () => {
        socket.emit('command', { serverId, command });
      });
    }
  }

  disconnectFromConsole(): void {
    this.consoleSocket?.disconnect();
    this.consoleSocket = null;
  }

  // ============================================
  // Cleanup
  // ============================================

  disconnectAll(): void {
    this.disconnectFromServers();
    this.disconnectFromConsole();
  }

  // Reconnect with fresh token (call after login/token refresh)
  reconnect(): void {
    const wasConsoleConnected = this.consoleSocket?.connected;
    const wasServersConnected = this.serversSocket?.connected;

    this.disconnectAll();

    if (wasServersConnected) {
      this.connectToServers();
    }
    if (wasConsoleConnected) {
      this.connectToConsole();
    }
  }
}

export const websocket = new WebSocketService();
export default websocket;
