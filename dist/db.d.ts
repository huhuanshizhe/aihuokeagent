/**
 * SQLite 数据库连接 (sql.js - 纯 WASM 实现)
 * 零配置，零编译，数据存储在 data/leadgen.db
 * 提供与 better-sqlite3 兼容的 API 包装
 */
import { type Database } from 'sql.js';
export interface RunResult {
    changes: number;
    lastInsertRowid: number;
}
declare class WrappedStatement {
    private sqlDb;
    private sql;
    private scheduleSave;
    constructor(sqlDb: Database, sql: string, scheduleSave: () => void);
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
}
export declare class DatabaseWrapper {
    private sqlDb;
    private savePath;
    private saveTimer;
    private pendingSave;
    constructor(sqlDb: Database, savePath: string);
    prepare(sql: string): WrappedStatement;
    exec(sql: string): void;
    pragma(pragma: string): void;
    /** 防抖保存：批量写操作只触发一次磁盘写入 */
    private scheduleSave;
    /** 立即持久化到磁盘 */
    private saveImmediate;
    /** 手动刷盘（进程退出前调用） */
    flush(): void;
}
export declare function initDb(): Promise<DatabaseWrapper>;
export declare function getDb(): DatabaseWrapper;
export declare const db: DatabaseWrapper;
export {};
