import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");
export const OUTPUT_DIR = path.join(DATA_DIR, "outputs");
export const HISTORY_PATH = path.join(DATA_DIR, "history.json");

export async function ensureDirs() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
