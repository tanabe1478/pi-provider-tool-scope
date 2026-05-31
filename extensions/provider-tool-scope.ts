import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  calculateScopeUpdate,
  DEFAULT_CONFIG,
  formatStatus,
  formatSummary,
  STATUS_KEY,
  type MaybeModel,
  type ToolScopeConfig,
} from "../src/core.ts";
import { loadConfig } from "../src/config.ts";

function applyScope(pi: ExtensionAPI, ctx: ExtensionContext, config: ToolScopeConfig, model: MaybeModel = ctx.model) {
  const update = calculateScopeUpdate({
    activeTools: pi.getActiveTools(),
    availableTools: pi.getAllTools().map((tool) => tool.name),
    config,
    model,
  });

  if (!update) return;
  if (update.changed) pi.setActiveTools(update.activeTools);
  if (config.status !== false) ctx.ui.setStatus(STATUS_KEY, formatStatus(update.allowedTools));
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

      ctx.ui.notify(formatSummary({ config, model: ctx.model }), "info");
    },
  });
}
