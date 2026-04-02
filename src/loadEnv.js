import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENV_FILE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");

let envLoaded = false;

export function loadEnvFile() {
  if (envLoaded) {
    return;
  }

  envLoaded = true;

  if (!fs.existsSync(ENV_FILE_PATH)) {
    return;
  }

  const content = fs.readFileSync(ENV_FILE_PATH, "utf8");

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();
