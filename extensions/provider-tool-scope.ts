import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

type MaybeModel = { provider?: string; id?: string } | null | undefined;

type ToolScopeRule = {
  /** Provider id to match, e.g. "ollama-cloud". Supports "*" wildcards. */
  provider?: string;
  /** Model id to match, e.g. "qwen*". Supports "*" wildcards. */
  model?: string;
  /** Full model name to match, e.g. "ollama-cloud/qwen*". Supports "*" wildcards. */
  modelRef?: string;
  /** Tools active only while this rule matches. */
  tools: string[];
};

type ToolScopeConfig = {
  /** Set false to disable this extension without uninstalling it. */
  enabled?: boolean;
  /** Rules that allow specific tools for matching provider/model pairs. */
  rules?: ToolScopeRule[];
  /** Tools managed by this extension. Defaults to the union of all rule tools. */
  scopedTools?: string[];
  /** Show a footer status when scoped tools are active. Default: true. */
  status?: boolean;
};

const CONFIG_FILE = "provider-tool-scope.json";
const STATUS_KEY = "provider-tool-scope";

const DEFAULT_CONFIG: Required<Pick<ToolScopeConfig, "enabled" | "rules" | "status">> = {
  enabled: true,
  status: true,
  rules: [
    {
      provider: "ollama-cloud",
      tools: ["ollama_web_search", "ollama_web_fetch"],
    },
  ],
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function wildcardMatch(pattern: string | undefined, value: string | undefined): boolean {
  if (!pattern) return true;
  if (value === undefined) return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function sanitizeConfig(raw: unknown): ToolScopeConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: ToolScopeConfig = {};

  if (typeof src.enabled === "boolean") out.enabled = src.enabled;
  if (typeof src.status === "boolean") out.status = src.status;
  if (Array.isArray(src.scopedTools)) out.scopedTools = src.scopedTools.filter((x): x is string => typeof x === "string");

  if (Array.isArray(src.rules)) {
    out.rules = src.rules.flatMap((rule): ToolScopeRule[] => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) return [];
      const r = rule as Record<string, unknown>;
      if (!Array.isArray(r.tools)) return [];
      const tools = r.tools.filter((x): x is string => typeof x === "string");
      if (tools.length === 0) return [];
      return [
        {
          provider: typeof r.provider === "string" ? r.provider : undefined,
          model: typeof r.model === "string" ? r.model : undefined,
          modelRef: typeof r.modelRef === "string" ? r.modelRef : undefined,
          tools,
        },
      ];
    });
  }

  return out;
}

function readJson(path: string): ToolScopeConfig {
  if (!existsSync(path)) return {};
  try {
    return sanitizeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    console.error(`[provider-tool-scope] Failed to read ${path}:`, error);
    return {};
  }
}

function loadConfig(cwd: string): ToolScopeConfig {
  const globalConfig = readJson(join(getAgentDir(), CONFIG_FILE));
  const projectConfig = readJson(join(cwd, ".pi", CONFIG_FILE));
  return {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
    rules: projectConfig.rules ?? globalConfig.rules ?? DEFAULT_CONFIG.rules,
    scopedTools: projectConfig.scopedTools ?? globalConfig.scopedTools,
  };
}

function getScopedTools(config: ToolScopeConfig): string[] {
  if (config.scopedTools) return unique(config.scopedTools);
  return unique((config.rules ?? []).flatMap((rule) => rule.tools));
}

function ruleMatches(rule: ToolScopeRule, model: MaybeModel): boolean {
  const provider = model?.provider;
  const id = model?.id;
  const modelRef = provider && id ? `${provider}/${id}` : undefined;
  return wildcardMatch(rule.provider, provider) && wildcardMatch(rule.model, id) && wildcardMatch(rule.modelRef, modelRef);
}

function allowedTools(config: ToolScopeConfig, model: MaybeModel): string[] {
  return unique((config.rules ?? []).filter((rule) => ruleMatches(rule, model)).flatMap((rule) => rule.tools));
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((value) => bs.has(value));
}

function applyScope(pi: ExtensionAPI, ctx: ExtensionContext, config: ToolScopeConfig, model: MaybeModel = ctx.model) {
  if (config.enabled === false) return;

  const scoped = getScopedTools(config);
  if (scoped.length === 0) return;

  const available = new Set(pi.getAllTools().map((tool) => tool.name));
  const allowed = allowedTools(config, model).filter((tool) => available.has(tool));
  const scopedSet = new Set(scoped);
  const active = pi.getActiveTools();
  const next = unique([...active.filter((tool) => !scopedSet.has(tool)), ...allowed]);

  if (!sameSet(active, next)) pi.setActiveTools(next);

  if (config.status !== false) {
    const label = allowed.length > 0 ? `tool scope: ${allowed.join(", ")}` : undefined;
    ctx.ui.setStatus(STATUS_KEY, label);
  }
}

export default function providerToolScope(pi: ExtensionAPI) {
  let config: ToolScopeConfig = DEFAULT_CONFIG;

  pi.on("session_start", async (_event, ctx) => {
    config = loadConfig(ctx.cwd);
    applyScope(pi, ctx, config);
  });

  pi.on("model_select", async (event, ctx) => {
    applyScope(pi, ctx, config, event.model);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    // Safety net: enforce scope immediately before the next provider request is built.
    applyScope(pi, ctx, config);
  });

  pi.registerCommand("tool-scope", {
    description: "Show or reload provider/model-scoped tool exposure rules",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (arg === "reload") {
        config = loadConfig(ctx.cwd);
        applyScope(pi, ctx, config);
        ctx.ui.notify("provider-tool-scope: config reloaded", "info");
        return;
      }

      const scoped = getScopedTools(config);
      const allowed = allowedTools(config, ctx.model);
      ctx.ui.notify(
        [
          `provider-tool-scope: ${config.enabled === false ? "disabled" : "enabled"}`,
          `model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"}`,
          `scoped tools: ${scoped.length ? scoped.join(", ") : "none"}`,
          `currently allowed: ${allowed.length ? allowed.join(", ") : "none"}`,
          `usage: /tool-scope reload`,
        ].join("\n"),
        "info",
      );
    },
  });
}
