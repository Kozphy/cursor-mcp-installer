# Test evidence

**Command:** `npx vitest run`  
**When:** 2026-11-06 on Windows  
**Result:** 7 files passed, **55 passed, 6 skipped**, exit code 0.

GitHub Actions push run `42212102145` then failed Windows on a temp path containing `~` (`RUNNER~1`). Argument policy was updated to allow `~` in non-shell argv. Re-run is required before treating Windows CI as green.

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
