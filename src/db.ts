/**
 * SQLite 数据库连接 (sql.js - 纯 WASM 实现)
 * 零配置，零编译，数据存储在 data/leadgen.db
 * 提供与 better-sqlite3 兼容的 API 包装
 */

import initSqlJs, { type Database } from 'sql.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dataDir = join(__dirname, '..', 'data');
const dbPath = join(dataDir, 'leadgen.db');

// 确保 data 目录存在
mkdirSync(dataDir, { recursive: true });

// ==================== 兼容 better-sqlite3 的包装器 ====================

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

class WrappedStatement {
  constructor(private sqlDb: Database, private sql: string, private scheduleSave: () => void) {}

  run(...params: unknown[]): RunResult {
    // sql.js Database.run 接受 (sql, params[]) 绑定参数
    this.sqlDb.run(this.sql, params as never[]);
    const changes = this.sqlDb.getRowsModified();
    const lastId = this.sqlDb.exec('SELECT last_insert_rowid() as id');
    const lastInsertRowid = lastId.length > 0 ? (lastId[0].values[0][0] as number) : 0;
    this.scheduleSave();
    return { changes, lastInsertRowid };
  }

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.sqlDb.prepare(this.sql);
    if (params.length > 0) stmt.bind(params as never[]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row as Record<string, unknown>;
    }
    stmt.free();
    return undefined;
  }

  all(...params: unknown[]): Array<Record<string, unknown>> {
    const stmt = this.sqlDb.prepare(this.sql);
    if (params.length > 0) stmt.bind(params as never[]);
    const rows: Array<Record<string, unknown>> = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as Record<string, unknown>);
    }
    stmt.free();
    return rows;
  }
}

export class DatabaseWrapper {
  private sqlDb: Database;
  private savePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingSave = false;

  constructor(sqlDb: Database, savePath: string) {
    this.sqlDb = sqlDb;
    this.savePath = savePath;
  }

  prepare(sql: string): WrappedStatement {
    return new WrappedStatement(this.sqlDb, sql, () => this.scheduleSave());
  }

  exec(sql: string): void {
    this.sqlDb.exec(sql);
    this.saveImmediate();
  }

  pragma(pragma: string): void {
    try {
      this.sqlDb.exec(`PRAGMA ${pragma}`);
    } catch {
      // sql.js may not support all pragmas
    }
  }

  /** 防抖保存：批量写操作只触发一次磁盘写入 */
  private scheduleSave(): void {
    this.pendingSave = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.pendingSave) {
        this.pendingSave = false;
        this.saveImmediate();
      }
    }, 50);
  }

  /** 立即持久化到磁盘 */
  private saveImmediate(): void {
    try {
      const data = this.sqlDb.export();
      const buffer = Buffer.from(data);
      writeFileSync(this.savePath, buffer);
    } catch (e) {
      console.error('[db] Failed to save database:', e);
    }
  }

  /** 手动刷盘（进程退出前调用） */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.pendingSave = false;
    this.saveImmediate();
  }
}

// ==================== 初始化 ====================

let dbInstance: DatabaseWrapper | null = null;

export async function initDb(): Promise<DatabaseWrapper> {
  if (dbInstance) return dbInstance;

  const SQL = await initSqlJs();

  let sqlDb: Database;
  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    sqlDb = new SQL.Database(fileBuffer);
    console.log(`[db] SQLite loaded from: ${dbPath}`);
  } else {
    sqlDb = new SQL.Database();
    console.log(`[db] SQLite created new: ${dbPath}`);
  }

  dbInstance = new DatabaseWrapper(sqlDb, dbPath);

  // 进程退出时确保数据落盘
  const flushOnExit = () => { dbInstance?.flush(); };
  process.on('beforeExit', flushOnExit);
  process.on('SIGINT', () => { flushOnExit(); process.exit(); });
  process.on('SIGTERM', () => { flushOnExit(); process.exit(); });

  return dbInstance;
}

// 同步访问（必须在 initDb() 之后调用）
export function getDb(): DatabaseWrapper {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}

// 向后兼容：导出 db proxy（延迟访问）
export const db: DatabaseWrapper = new Proxy({} as DatabaseWrapper, {
  get(_target, prop: string | symbol) {
    if (!dbInstance) throw new Error('Database not initialized. Call initDb() first.');
    return (dbInstance as unknown as Record<string, unknown>)[prop as string];
  },
});
