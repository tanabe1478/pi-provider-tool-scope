import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let agentDir = mkdtempSync(join(tmpdir(), "provider-tool-scope-agent-"));

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<object>("@earendil-works/pi-coding-agent");
  return {
    ...actual,
    getAgentDir: () => agentDir,
  };
});

const { default: providerToolScope } = await import("../extensions/provider-tool-scope.ts");

type Model = { provider: string; id: string };
type Handler = (event: any, ctx: any) => Promise<void> | void;

type FakePi = {
  handlers: Record<string, Handler[]>;
  commands: Record<string, { handler: (args: string, ctx: any) => Promise<void> | void }>;
  activeTools: string[];
  allTools: Array<{ name: string }>;
  setActiveToolsCalls: string[][];
  on: (event: string, handler: Handler) => void;
  registerCommand: (name: string, command: { handler: (args: string, ctx: any) => Promise<void> | void }) => void;
  getActiveTools: () => string[];
  setActiveTools: (tools: string[]) => void;
  getAllTools: () => Array<{ name: string }>;
};

function createPi(options?: { activeTools?: string[]; allTools?: string[] }): FakePi {
  const pi: FakePi = {
    handlers: {},
    commands: {},
    activeTools: options?.activeTools ?? ["read", "bash", "ollama_web_search", "ollama_web_fetch"],
    allTools: (options?.allTools ?? ["read", "bash", "ollama_web_search", "ollama_web_fetch"]).map((name) => ({ name })),
    setActiveToolsCalls: [],
    on(event, handler) {
      this.handlers[event] ??= [];
      this.handlers[event].push(handler);
    },
    registerCommand(name, command) {
      this.commands[name] = command;
    },
    getActiveTools() {
      return [...this.activeTools];
    },
    setActiveTools(tools) {
      this.activeTools = [...tools];
      this.setActiveToolsCalls.push([...tools]);
    },
    getAllTools() {
      return [...this.allTools];
    },
  };
  providerToolScope(pi as any);
  return pi;
}

function createCtx(options?: { cwd?: string; model?: Model | null }) {
  return {
    cwd: options?.cwd ?? mkdtempSync(join(tmpdir(), "provider-tool-scope-cwd-")),
    model: options?.model ?? { provider: "openai-codex", id: "gpt-5.5" },
    ui: {
      statuses: [] as Array<[string, string | undefined]>,
      notifications: [] as Array<[string, string | undefined]>,
      setStatus(key: string, value: string | undefined) {
        this.statuses.push([key, value]);
      },
      notify(message: string, level?: string) {
        this.notifications.push([message, level]);
      },
    },
  };
}

async function emit(pi: FakePi, eventName: string, event: any, ctx: any) {
  for (const handler of pi.handlers[eventName] ?? []) {
    await handler(event, ctx);
  }
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "provider-tool-scope-agent-"));
});

describe("provider-tool-scope characterization", () => {
  it("removes Ollama web tools when the active model is not ollama-cloud", async () => {
    const pi = createPi();
    const ctx = createCtx({ model: { provider: "openai-codex", id: "gpt-5.5" } });

    await emit(pi, "session_start", {}, ctx);

    expect(pi.activeTools).toEqual(["read", "bash"]);
    expect(ctx.ui.statuses.at(-1)).toEqual(["provider-tool-scope", undefined]);
  });

  it("keeps Ollama web tools when the active model is ollama-cloud", async () => {
    const pi = createPi();
    const ctx = createCtx({ model: { provider: "ollama-cloud", id: "qwen3-coder-next" } });

    await emit(pi, "session_start", {}, ctx);

    expect(pi.activeTools).toEqual(["read", "bash", "ollama_web_search", "ollama_web_fetch"]);
    expect(ctx.ui.statuses.at(-1)).toEqual([
      "provider-tool-scope",
      "tool scope: ollama_web_search, ollama_web_fetch",
    ]);
  });

  it("adds allowed tools back on model_select when available", async () => {
    const pi = createPi({ activeTools: ["read", "bash"] });
    const ctx = createCtx({ model: { provider: "openai-codex", id: "gpt-5.5" } });

    await emit(pi, "model_select", { model: { provider: "ollama-cloud", id: "qwen3-coder-next" } }, ctx);

    expect(pi.activeTools).toEqual(["read", "bash", "ollama_web_search", "ollama_web_fetch"]);
  });

  it("does not add allowed tools that are not registered by another package", async () => {
    const pi = createPi({ activeTools: ["read", "bash"], allTools: ["read", "bash", "ollama_web_search"] });
    const ctx = createCtx({ model: { provider: "ollama-cloud", id: "qwen3-coder-next" } });

    await emit(pi, "session_start", {}, ctx);

    expect(pi.activeTools).toEqual(["read", "bash", "ollama_web_search"]);
  });

  it("uses project config over global config", async () => {
    writeFileSync(
      join(agentDir, "provider-tool-scope.json"),
      JSON.stringify({ rules: [{ provider: "global-provider", tools: ["global_tool"] }] }),
    );
    const cwd = mkdtempSync(join(tmpdir(), "provider-tool-scope-cwd-"));
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "provider-tool-scope.json"),
      JSON.stringify({ rules: [{ provider: "project-provider", tools: ["project_tool"] }] }),
    );
    const pi = createPi({ activeTools: ["read", "global_tool", "project_tool"], allTools: ["read", "global_tool", "project_tool"] });
    const ctx = createCtx({ cwd, model: { provider: "global-provider", id: "model" } });

    await emit(pi, "session_start", {}, ctx);

    expect(pi.activeTools).toEqual(["read", "global_tool"]);
  });

  it("matches wildcard modelRef rules", async () => {
    writeFileSync(
      join(agentDir, "provider-tool-scope.json"),
      JSON.stringify({ rules: [{ modelRef: "my-provider/special-*", tools: ["special_tool"] }] }),
    );
    const pi = createPi({ activeTools: ["read", "special_tool"], allTools: ["read", "special_tool"] });
    const ctx = createCtx({ model: { provider: "my-provider", id: "special-1" } });

    await emit(pi, "session_start", {}, ctx);

    expect(pi.activeTools).toEqual(["read", "special_tool"]);
  });

  it("does nothing when disabled", async () => {
    writeFileSync(join(agentDir, "provider-tool-scope.json"), JSON.stringify({ enabled: false }));
    const pi = createPi();
    const ctx = createCtx({ model: { provider: "openai-codex", id: "gpt-5.5" } });

    await emit(pi, "session_start", {}, ctx);

    expect(pi.activeTools).toEqual(["read", "bash", "ollama_web_search", "ollama_web_fetch"]);
    expect(pi.setActiveToolsCalls).toEqual([]);
  });

  it("reload command reloads config and reapplies scope", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "provider-tool-scope-cwd-"));
    const pi = createPi({ activeTools: ["read", "dynamic_tool"], allTools: ["read", "dynamic_tool"] });
    const ctx = createCtx({ cwd, model: { provider: "dynamic-provider", id: "model" } });

    await emit(pi, "session_start", {}, ctx);
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "provider-tool-scope.json"),
      JSON.stringify({ rules: [{ provider: "dynamic-provider", tools: ["dynamic_tool"] }] }),
    );

    await pi.commands["tool-scope"].handler("reload", ctx);

    expect(pi.activeTools).toEqual(["read", "dynamic_tool"]);
    expect(ctx.ui.notifications.at(-1)).toEqual(["provider-tool-scope: config reloaded", "info"]);
  });
});
