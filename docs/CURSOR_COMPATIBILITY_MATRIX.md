# Cursor compatibility matrix

Schemas vendored from cursor/plugins `2776ddd2355d6d6c8747d3964600f28daf62f049`.

| Manifest form | Schema validation | Install behavior |
| --- | --- | --- |
| `name` kebab-case required | Enforced by Ajv | Identity must match marketplace entry |
| `skills` / `rules` / `commands` / `agents` string or array | Enforced | Files copied into installer state if they stay inside the plugin root |
| `hooks` string or object | Enforced | Blocked unless `--approve-hooks`. Hooks are not executed |
| `mcpServers` string, object, or array | Enforced | Blocked unless `--write-mcp`. This change does not write `~/.cursor/mcp.json` |
| `variables` object schema | Enforced | Required keys and primitive types checked before commit |
| `minClientVersions.cursor` semver or `never` | Enforced | Compared with `--cursor-version` |
| Marketplace `plugins[].source` relative path | Enforced | Resolved under the marketplace directory; `..` and symlink escapes fail |
| Remote `https` source pinned to 40-char SHA | Shape checked | Fetched only with `--approve-remote` via `git fetch` of that commit. Not covered by an offline test |
| Unknown manifest properties | Rejected (`additionalProperties: false`) | Install does not start |

Schema-valid does not mean approved. Hooks and MCP config stay blocked until the matching flag is present.

Representative fixtures exercised offline:

1. `skills-only`
2. `rules-commands`
3. `mcp-demo` (rejected without MCP write approval)

This is not an official Cursor marketplace client.
