// 构建后把 SQL 迁移文件拷到 dist，供 node dist/index.js 运行时读取。
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "src", "db", "migrations");
const dest = join(root, "dist", "db", "migrations");
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copied migrations -> ${dest}`);
