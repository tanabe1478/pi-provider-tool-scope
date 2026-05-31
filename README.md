# pi-provider-tool-scope

Scope pi tools to specific providers or models.

Use this when a pi package exposes tools you only want certain models to use. For example, `pi-ollama-cloud` is an npm package, but when installed with `pi install npm:pi-ollama-cloud`, it is also a pi package: pi loads its extension and registers Ollama Cloud web tools. Those tools can work from any provider if the API key is configured, but you may still want to hide them from OpenAI Codex or Claude to avoid accidental calls.

## Default behavior

This package scopes these tools to the `ollama-cloud` provider:

- `ollama_web_search`
- `ollama_web_fetch`

With non-Ollama models, they are removed from active tools. With Ollama Cloud models, they are added back if registered.

## pi package note

This package controls tools registered by other pi packages. For example, `pi-ollama-cloud` is installed as a pi package via `pi install npm:pi-ollama-cloud`, and that is what makes its web tools visible to pi.

## Install

```bash
pi install git:github.com/tanabe1478/pi-provider-tool-scope
```

Then run `/reload` or restart pi.

## Configuration

Optional config files:

- global: `~/.pi/agent/provider-tool-scope.json`
- project-local: `.pi/provider-tool-scope.json`

Project-local config overrides global config.

### Example

```json
{
  "rules": [
    {
      "provider": "ollama-cloud",
      "tools": ["ollama_web_search", "ollama_web_fetch"]
    },
    {
      "modelRef": "my-provider/special-*",
      "tools": ["my_provider_only_tool"]
    }
  ]
}
```

`provider`, `model`, and `modelRef` support `*` wildcards.

By default, managed tools are the union of all `rules[].tools`. Override with `scopedTools` if needed.

## Commands

```text
/tool-scope
/tool-scope reload
```

`/tool-scope` shows the current model and scoped tools.  
`/tool-scope reload` reloads config without restarting pi.

## How it works

The extension applies rules on:

- `session_start`
- `model_select`
- `before_agent_start`

It uses `pi.getActiveTools()` and `pi.setActiveTools()` to remove scoped tools by default, then re-add only tools allowed for the active model.

## Why

Tool visibility matters. If a web, browser, cloud, or internal API tool is visible to the wrong model, the model may call it accidentally. This package makes tool exposure explicit per provider/model.
