export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  source: string;
  message: string;
  data?: any;
}

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class Logger {
  private history: LogEntry[] = [];
  private debugMode = false;
  private currentLevel: LogLevel = 'info';
  private maxEntries = 1000;

  constructor() {
    const debugModeEnv = import.meta.env.VITE_DEBUG_MODE === 'true';
    const logLevelEnv = (import.meta.env.VITE_LOG_LEVEL || 'info') as LogLevel;

    this.debugMode = debugModeEnv;
    this.currentLevel = logLevelEnv;

    if (debugModeEnv) {
      console.log(`[Logger] Debug mode enabled, level: ${logLevelEnv}`);
    }
  }

  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;
    if (enabled) {
      this.info('Logger', 'Debug mode enabled');
    }
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level;
    this.info('Logger', `Log level set to ${level}`);
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.debugMode && level === 'debug') {
      return false;
    }
    return levelPriority[level] >= levelPriority[this.currentLevel];
  }

  private addEntry(level: LogLevel, source: string, message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      source,
      message,
      data,
    };

    this.history.push(entry);
    if (this.history.length > this.maxEntries) {
      this.history.shift();
    }

    if (this.shouldLog(level)) {
      const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}] [${source}]`;
      console.log(prefix, message, data ? data : '');
    }
  }

  debug(source: string, message: string, data?: any): void {
    this.addEntry('debug', source, message, data);
  }

  info(source: string, message: string, data?: any): void {
    this.addEntry('info', source, message, data);
  }

  warn(source: string, message: string, data?: any): void {
    this.addEntry('warn', source, message, data);
  }

  error(source: string, message: string, data?: any): void {
    this.addEntry('error', source, message, data);
  }

  getHistory(): LogEntry[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
  }

  exportLog(): string {
    return JSON.stringify(this.history, null, 2);
  }
}

export const logger = new Logger();
