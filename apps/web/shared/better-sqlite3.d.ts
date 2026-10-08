declare module "better-sqlite3" {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Statement {
    all(...parameters: unknown[]): unknown[];
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): RunResult;
  }

  class Database {
    constructor(filename: string);
    close(): void;
    exec(sql: string): this;
    pragma(source: string): unknown;
    prepare(source: string): Statement;
  }

  export default Database;
}
