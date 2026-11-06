# Baseline audit

**Date:** 2026-11-06  
**Installer HEAD inspected before this branch:** `af8b44fe6518d19716fb0b02f472203650bf0516` (`fork/main`)  
**Upstream origin:** `https://github.com/matthewdcage/cursor-mcp-installer` at `b903f0bc6ef55ad5f4a35a5aee4ef7a9d23eeb3e`  
**Cursor plugins schemas:** `https://github.com/cursor/plugins` commit `2776ddd2355d6d6c8747d3964600f28daf62f049`

## Package ownership

`package.json` still names author Matthew Cage and repository `matthewdcage/cursor-mcp-installer`. This work did not change publishing metadata. The Kozphy git remote is a fork (`fork`), not a claim of npm ownership.

## Verified at baseline

| ID | Finding | Evidence |
| --- | --- | --- |
| SEC-01 | Dashboard set `Access-Control-Allow-Origin: *`, listened on all interfaces, and accepted unauthenticated `POST /api/install` and `POST /api/validate` | `src/api/server.ts`, `src/api/routes.ts` at `af8b44f` |
| SEC-02 | `shell: true` on handshake spawn, npm view, runtime probes, and Claude CLI probes | `src/validate/handshake.ts`, `src/install/npm.ts`, `src/detect/runtimes.ts`, `src/detect/clients.ts` |
| SEC-03 | Git install cloned an unpinned URL and ran `npm install` without `--ignore-scripts` | `src/install/git.ts` |
| SEC-04 | Config writes had no permission mode; logs JSON-stringified context without redaction | `src/utils/config-io.ts`, `src/utils/logging.ts` |
| GAP | No Cursor plugin manifest or marketplace code | tree inspection |
| HANDSHAKE | `tools/list` with a JSON-RPC `error` still resolved `status: pass` when `result` was absent but the id matched after a missing error check on id 2 | `handleMessage` only failed initialize errors |

## Not assumed

Local uncommitted edits on top of `af8b44f` were re-read. They adjusted Claude Code config paths and Windows command wrapping. They were kept. They did not fix the dashboard or git lifecycle issues.

## Baseline tests

Not re-run on unmodified `af8b44f` in this session. The suite after the branch changes is recorded in `docs/TEST_EVIDENCE.md`.
