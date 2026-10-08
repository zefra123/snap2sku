// 刻意手写的最小类型声明（不引 @types/better-sqlite3，避免多一个 devDependency）。
// 类型很薄：pragma 返回 unknown、Statement 无泛型，查询结果需 as 断言。
// 若需要完整类型，删除本文件后安装 @types/better-sqlite3 即可，二者不能共存。
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
