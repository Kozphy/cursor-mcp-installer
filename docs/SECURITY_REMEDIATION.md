# Security remediation

| ID | Change | Verification |
| --- | --- | --- |
| SEC-01 | Bind `127.0.0.1`. Require `x-installer-token` or `Bearer` on POST. Reject bad `Host` and `Origin`. No CORS wildcard. 64 KiB body cap. Zod bodies. WebSocket upgrade requires the same token. Static files cannot leave `dashboard/dist` | `tests/security-plugins.test.ts` dashboard case: 401 without token, 403 for `Host: evil.example` |
| SEC-02 | `spawn`/`exec` paths use `shell: false`. Executables must be bare names. Arguments reject shell metacharacters. Windows `npm`/`npx` go through `node` + `npm-cli.js`; `git` and `node` resolve to executables | Injection test expects rejection and no marker file. Runtime detection tests still see node, npm, and npx |
| SEC-03 | Git sources require `https` plus a 40-character commit. `npm install` uses `--ignore-scripts` unless `allowScripts` is set. Plugin copies stay inside the marketplace root | Lifecycle test: preinstall did not create its marker. Path test rejects traversal and a symlink |
| SEC-04 | Config temp files use mode `0o600` where the OS allows it. Logs and websocket payloads pass through `redactSecrets`. Plugin audit lines store decisions, not the dashboard token | Redaction test: `api_key` value absent from stderr |

## Residual risk

`npm audit` on 2026-11-06 reported 18 issues (1 low, 4 moderate, 10 high, 3 critical), including transitive packages from `@modelcontextprotocol/sdk`, `vitest`, and `vite`. They were not patched in this branch. The dashboard token is stored in `dashboard.token` so the operator can call the API; the file mode is `0o600` on platforms that honor it.

Git installs without a commit SHA now fail closed. That is an intentional compatibility break.
