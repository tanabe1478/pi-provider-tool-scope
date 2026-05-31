export type MaybeModel = { provider?: string; id?: string } | null | undefined;

export type ToolScopeRule = {
  /** Provider id to match, e.g. "ollama-cloud". Supports "*" wildcards. */
  provider?: string;
  /** Model id to match, e.g. "qwen*". Supports "*" wildcards. */
  model?: string;
  /** Full model name to match, e.g. "ollama-cloud/qwen*". Supports "*" wildcards. */
  modelRef?: string;
  /** Tools active only while this rule matches. */
  tools: string[];
};

export type ToolScopeConfig = {
  /** Set false to disable this extension without uninstalling it. */
  enabled?: boolean;
  /** Rules that allow specific tools for matching provider/model pairs. */
  rules?: ToolScopeRule[];
  /** Tools managed by this extension. Defaults to the union of all rule tools. */
  scopedTools?: string[];
  /** Show a footer status when scoped tools are active. Default: true. */
  status?: boolean;
};

export type ScopeUpdate = {
  activeTools: string[];
  scopedTools: string[];
  allowedTools: string[];
  changed: boolean;
};

export const STATUS_KEY = "provider-tool-scope";

export const DEFAULT_CONFIG: Required<Pick<ToolScopeConfig, "enabled" | "rules" | "status">> = {
  enabled: true,
  status: true,
  rules: [
    {
      provider: "ollama-cloud",
      tools: ["ollama_web_search", "ollama_web_fetch"],
    },
  ],
};

export function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function wildcardMatch(pattern: string | undefined, value: string | undefined): boolean {
  if (!pattern) return true;
  if (value === undefined) return false;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

export function sanitizeConfig(raw: unknown): ToolScopeConfig {
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

export function mergeConfig(globalConfig: ToolScopeConfig, projectConfig: ToolScopeConfig): ToolScopeConfig {
  return {
    ...DEFAULT_CONFIG,
    ...globalConfig,
    ...projectConfig,
    rules: projectConfig.rules ?? globalConfig.rules ?? DEFAULT_CONFIG.rules,
    scopedTools: projectConfig.scopedTools ?? globalConfig.scopedTools,
  };
}

export function getScopedTools(config: ToolScopeConfig): string[] {
  if (config.scopedTools) return unique(config.scopedTools);
  return unique((config.rules ?? []).flatMap((rule) => rule.tools));
}

export function ruleMatches(rule: ToolScopeRule, model: MaybeModel): boolean {
  const provider = model?.provider;
  const id = model?.id;
  const modelRef = provider && id ? `${provider}/${id}` : undefined;
  return wildcardMatch(rule.provider, provider) && wildcardMatch(rule.model, id) && wildcardMatch(rule.modelRef, modelRef);
}

export function allowedTools(config: ToolScopeConfig, model: MaybeModel): string[] {
  return unique((config.rules ?? []).filter((rule) => ruleMatches(rule, model)).flatMap((rule) => rule.tools));
}

export function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bs = new Set(b);
  return a.every((value) => bs.has(value));
}

export function calculateScopeUpdate(input: {
  activeTools: string[];
  availableTools: string[];
  config: ToolScopeConfig;
  model: MaybeModel;
}): ScopeUpdate | undefined {
  if (input.config.enabled === false) return undefined;

  const scopedTools = getScopedTools(input.config);
  if (scopedTools.length === 0) return undefined;

  const available = new Set(input.availableTools);
  const allowed = allowedTools(input.config, input.model).filter((tool) => available.has(tool));
  const scopedSet = new Set(scopedTools);
  const activeTools = unique([...input.activeTools.filter((tool) => !scopedSet.has(tool)), ...allowed]);

  return {
    activeTools,
    scopedTools,
    allowedTools: allowed,
    changed: !sameSet(input.activeTools, activeTools),
  };
}

export function formatStatus(allowed: string[]): string | undefined {
  return allowed.length > 0 ? `tool scope: ${allowed.join(", ")}` : undefined;
}

export function formatSummary(input: { config: ToolScopeConfig; model: MaybeModel }): string {
  const scoped = getScopedTools(input.config);
  const allowed = allowedTools(input.config, input.model);
  return [
    `provider-tool-scope: ${input.config.enabled === false ? "disabled" : "enabled"}`,
    `model: ${input.model ? `${input.model.provider}/${input.model.id}` : "none"}`,
    `scoped tools: ${scoped.length ? scoped.join(", ") : "none"}`,
    `currently allowed: ${allowed.length ? allowed.join(", ") : "none"}`,
    `usage: /tool-scope reload`,
  ].join("\n");
}
