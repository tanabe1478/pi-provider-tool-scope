# pi-provider-tool-scope

Scope pi tools to specific providers or models to prevent accidental tool exposure.

This is useful when an extension registers tools that only make sense for one provider. For example, `pi-ollama-cloud` can register `ollama_web_search` and `ollama_web_fetch`; those tools are useful with Ollama Cloud models, but should not be visible while using OpenAI Codex or Claude models.

## Default behavior

Out of the box, this package scopes these tools to the `ollama-cloud` provider:

- `ollama_web_search`
- `ollama_web_fetch`

When the active model is not from `ollama-cloud`, those tools are removed from pi's active tools. When the active model is from `ollama-cloud`, they are added back if registered by another package.

## Install

From a git repository:

```bash
pi install git:github.com/tanabe1478/pi-provider-tool-scope
```

Or from a local checkout:

```bash
pi install /path/to/pi-provider-tool-scope
```

Then run `/reload` or restart pi.

## Configuration

Create either:

- global: `~/.pi/agent/provider-tool-scope.json`
- project-local: `.pi/provider-tool-scope.json`

Project-local config overrides global config.

### Example: default Ollama Cloud scope

```json
{
  "rules": [
    {
      "provider": "ollama-cloud",
      "tools": ["ollama_web_search", "ollama_web_fetch"]
    }
  ]
}
```

### Example: provider and model patterns

`provider`, `model`, and `modelRef` support `*` wildcards.

```json
{
  "rules": [
    {
      "modelRef": "ollama-cloud/qwen*",
      "tools": ["ollama_web_search", "ollama_web_fetch"]
    },
    {
      "provider": "my-internal-provider",
      "tools": ["internal_api_search"]
    }
  ]
}
```

### Example: explicit scoped tools

By default, the managed tool set is the union of all `rules[].tools`. You can override it with `scopedTools`.

```json
{
  "scopedTools": ["ollama_web_search", "ollama_web_fetch", "internal_api_search"],
  "rules": [
    {
      "provider": "ollama-cloud",
      "tools": ["ollama_web_search", "ollama_web_fetch"]
    }
  ]
}
```

## Commands

```text
/tool-scope
/tool-scope reload
```

`/tool-scope` shows the current model, scoped tools, and currently allowed tools.

`/tool-scope reload` reloads `provider-tool-scope.json` without restarting pi.

## How it works

The extension listens to:

- `session_start`
- `model_select`
- `before_agent_start`

It uses `pi.getActiveTools()` and `pi.setActiveTools()` to remove scoped tools by default, then re-add only the tools allowed by rules matching the active model.

## Security note

Tool visibility matters. If a web, browser, cloud, or internal API tool is visible to a model that should not use it, the model may call it accidentally. This package reduces that risk by making tool exposure explicit per provider/model.
