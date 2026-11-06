# Plugin architecture

MCP server installation (`src/install`, `src/clients`) is unchanged in purpose. Cursor plugins are a separate lifecycle:

`DISCOVER → VALIDATE → RESOLVE → INSPECT → PLAN → APPROVE → STAGE → VERIFY → COMMIT → AUDIT`

| Module | Role |
| --- | --- |
| `src/plugins/schema.ts` | Ajv validators for the vendored upstream schemas |
| `src/plugins/manifest.ts` | Read `.cursor-plugin/plugin.json` |
| `src/plugins/marketplace.ts` | Load marketplace JSON and reject duplicate names |
| `src/plugins/resolver.ts` | Relative paths inside the marketplace root, or a pinned git fetch when remote approval is set |
| `src/plugins/planner.ts` | Component inventory, version check, approval blockers |
| `src/plugins/installer.ts` | list, inspect, install, verify, update, uninstall |
| `src/plugins/state.ts` | `plugins.json` with revision and checksums |
| `src/transactions/staging.ts` | Temp copy |
| `src/transactions/rollback.ts` | Snapshot and restore the previous install directory |
| `src/security/*` | Process policy, path checks, redaction, provenance SHA |

State directory: `MCP_INSTALLER_HOME` or `~/.universal-mcp-installer`.

CLI:

```text
universal-mcp-installer plugin list --marketplace <file>
universal-mcp-installer plugin inspect <name> --marketplace <file>
universal-mcp-installer plugin install <name> --marketplace <file> [--dry-run] [--approve-hooks] [--approve-remote] [--write-mcp] [--cursor-version x.y.z]
universal-mcp-installer plugin verify <name>
universal-mcp-installer plugin update <name> --marketplace <file>
universal-mcp-installer plugin uninstall <name>
```

Uninstall deletes only owned files whose checksum still matches. Modified files are left in place.

`--write-mcp` clears the MCP approval blocker. It does not write client MCP config. Use the existing `install` command for MCP server configuration.
