declare module 'sql.js' {
  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  interface Database {
    exec(sql: string): QueryExecResult[];
    run(sql: string, params?: unknown[]): Database;
    prepare(sql: string): Statement;
    getRowsModified(): number;
    export(): Uint8Array;
    close(): void;
  }

  interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    get(idx: number): unknown;
    free(): boolean;
    reset(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export type { SqlJsStatic, Database, Statement, QueryExecResult };

  export default function initSqlJs(config?: Record<string, unknown>): Promise<SqlJsStatic>;
}
