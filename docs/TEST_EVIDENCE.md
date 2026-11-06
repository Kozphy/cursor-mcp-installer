# Test evidence

**Command:** `npx vitest run`  
**When:** 2026-11-06 on Windows  
**Result:** 7 files passed, **55 passed, 6 skipped**, exit code 0.

The first push CI run `42212102145` failed Windows because the temp path contained `~` (`RUNNER~1`). After allowing `~` in non-shell arguments, push run `42212460197` completed with success on 2026-11-06:

- https://github.com/Kozphy/cursor-mcp-installer/actions/runs/42212460197
- ubuntu-latest: https://github.com/Kozphy/cursor-mcp-installer/actions/runs/42212460197/job/127874187853
- windows-latest: https://github.com/Kozphy/cursor-mcp-installer/actions/runs/42212460197/job/127874187722
- macos-latest: https://github.com/Kozphy/cursor-mcp-installer/actions/runs/42212460197/job/127874187376
- network integration: https://github.com/Kozphy/cursor-mcp-installer/actions/runs/42212460197/job/127874187588
- dependency and secret scan: https://github.com/Kozphy/cursor-mcp-installer/actions/runs/42212460197/job/127874187766

The scan job records `npm audit` and does not fail the build. Audit findings remain open.

Skipped tests call the npm registry or `npx` and run only when `RUN_NETWORK_TESTS=1`. They were not executed in this session.

**Command:** `npx tsc --noEmit`  
**Result:** exit code 0.

## Covered by `tests/security-plugins.test.ts`

- Invalid plugin manifest and duplicate marketplace names
- Skills-only install and a second install reported as already installed
- Rules and commands install
- MCP plugin blocked without `--write-mcp`
- Hooks blocked without `--approve-hooks`, then allowed with the flag
- Required variable and minimum Cursor version
- Verify checksums
- Uninstall keeps a user-modified owned file
- Path traversal and symlink escape
- `npm install --ignore-scripts` does not run `preinstall`
- Shell metacharacters rejected
- JSON-RPC initialize `error` fails validation
- Content-Length plus newline framing
- POST without token returns 401
- `Host: evil.example` returns 403
- Secret redaction in log context

## Not executed here

- Ubuntu and macOS CI
- `RUN_NETWORK_TESTS=1`
- A live pinned GitHub plugin fetch
- npm publish or `npm pack` install on a clean machine
