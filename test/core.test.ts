import { describe, expect, it } from "vitest";
import {
  allowedTools,
  calculateScopeUpdate,
  formatStatus,
  formatSummary,
  getScopedTools,
  mergeConfig,
  ruleMatches,
  sanitizeConfig,
  wildcardMatch,
} from "../src/core.ts";

describe("core", () => {
  it("matches wildcard patterns", () => {
    expect(wildcardMatch("ollama-*", "ollama-cloud")).toBe(true);
    expect(wildcardMatch("ollama-*", "openai-codex")).toBe(false);
    expect(wildcardMatch(undefined, "anything")).toBe(true);
    expect(wildcardMatch("literal.dot", "literal.dot")).toBe(true);
  });

  it("sanitizes config", () => {
    expect(
      sanitizeConfig({
        enabled: false,
        status: false,
        scopedTools: ["a", 1, "b"],
        rules: [
          { provider: "p", tools: ["t", 2] },
          { provider: "ignored" },
          null,
        ],
      }),
    ).toEqual({
      enabled: false,
      status: false,
      scopedTools: ["a", "b"],
      rules: [{ provider: "p", model: undefined, modelRef: undefined, tools: ["t"] }],
    });
  });

  it("merges project config over global config", () => {
    expect(
      mergeConfig(
        { rules: [{ provider: "global", tools: ["global_tool"] }], scopedTools: ["global_tool"] },
        { rules: [{ provider: "project", tools: ["project_tool"] }] },
      ),
    ).toMatchObject({
      enabled: true,
      status: true,
      rules: [{ provider: "project", tools: ["project_tool"] }],
      scopedTools: ["global_tool"],
    });
  });

  it("derives scoped tools from rule union unless explicitly configured", () => {
    expect(getScopedTools({ rules: [{ tools: ["a", "b"] }, { tools: ["b", "c"] }] })).toEqual(["a", "b", "c"]);
    expect(getScopedTools({ scopedTools: ["x", "x"], rules: [{ tools: ["a"] }] })).toEqual(["x"]);
  });

  it("matches rules by provider, model, and modelRef", () => {
    expect(ruleMatches({ provider: "ollama-cloud", tools: ["t"] }, { provider: "ollama-cloud", id: "qwen" })).toBe(true);
    expect(ruleMatches({ model: "qwen*", tools: ["t"] }, { provider: "ollama-cloud", id: "qwen3" })).toBe(true);
    expect(ruleMatches({ modelRef: "ollama-cloud/qwen*", tools: ["t"] }, { provider: "ollama-cloud", id: "qwen3" })).toBe(true);
    expect(ruleMatches({ modelRef: "ollama-cloud/qwen*", tools: ["t"] }, { provider: "openai", id: "qwen3" })).toBe(false);
  });

  it("calculates allowed tools", () => {
    expect(
      allowedTools(
        { rules: [{ provider: "ollama-cloud", tools: ["search", "fetch"] }, { provider: "openai", tools: ["other"] }] },
        { provider: "ollama-cloud", id: "qwen" },
      ),
    ).toEqual(["search", "fetch"]);
  });

  it("calculates active tool updates", () => {
    expect(
      calculateScopeUpdate({
        activeTools: ["read", "ollama_web_search", "ollama_web_fetch"],
        availableTools: ["read", "ollama_web_search", "ollama_web_fetch"],
        config: { rules: [{ provider: "ollama-cloud", tools: ["ollama_web_search", "ollama_web_fetch"] }] },
        model: { provider: "openai-codex", id: "gpt-5.5" },
      }),
    ).toEqual({
      activeTools: ["read"],
      scopedTools: ["ollama_web_search", "ollama_web_fetch"],
      allowedTools: [],
      changed: true,
    });
  });

  it("formats status and summary", () => {
    expect(formatStatus([])).toBeUndefined();
    expect(formatStatus(["a", "b"])).toBe("tool scope: a, b");
    expect(formatSummary({ config: { rules: [{ provider: "p", tools: ["t"] }] }, model: { provider: "p", id: "m" } })).toBe(
      [
        "provider-tool-scope: enabled",
        "model: p/m",
        "scoped tools: t",
        "currently allowed: t",
        "usage: /tool-scope reload",
      ].join("\n"),
    );
  });
});
