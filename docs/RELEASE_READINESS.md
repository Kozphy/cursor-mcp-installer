# Release readiness

**Verdict: NOT READY**

## Satisfied in this working tree

- P0 dashboard, shell, untrusted script, and log-redaction changes have local tests on Windows.
- Offline plugin fixtures for skills, rules/commands, and MCP rejection pass schema and planner checks.
- Install of the same revision is idempotent.
- Uninstall does not delete a checksum mismatch.
- `tsc --noEmit` and `vitest run` passed locally (55 passed, 6 network tests skipped).
- CI run `42212460197` passed on Ubuntu, Windows, and macOS, including the network integration job. See `docs/TEST_EVIDENCE.md`.

## Blocking

- `npm audit` reported 18 vulnerabilities (10 high, 3 critical) in the existing tree, including `@modelcontextprotocol/sdk`, `vitest`, and `vite`. No release exception was accepted.
- Cross-platform CI passed once after the Windows short-path fix. That does not clear the audit findings below.
- Plugin `--write-mcp` does not update client MCP configuration.
- Remote plugin fetch is fail-closed without `--approve-remote` and was not integration-tested.
- Package metadata still points at `matthewdcage/cursor-mcp-installer`; publishing from the fork was not authorized and was not done.

Do not tag a release or publish to npm from this branch until those gaps are closed or explicitly accepted.
