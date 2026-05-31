import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mergeConfig, sanitizeConfig, type ToolScopeConfig } from "./core.ts";

export const CONFIG_FILE = "provider-tool-scope.json";

export function readJson(path: string): ToolScopeConfig {
  if (!existsSync(path)) return {};
  try {
    return sanitizeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    console.error(`[provider-tool-scope] Failed to read ${path}:`, error);
    return {};
  }
}

export function loadConfig(cwd: string): ToolScopeConfig {
  const globalConfig = readJson(join(getAgentDir(), CONFIG_FILE));
  const projectConfig = readJson(join(cwd, ".pi", CONFIG_FILE));
  return mergeConfig(globalConfig, projectConfig);
}
