# Threat model

## Assets

- Local MCP client configuration
- Dashboard session token
- Plugin files copied into the installer state directory
- Credentials passed as env vars to MCP servers

## Trust boundaries

| Boundary | Assumption |
| --- | --- |
| Loopback dashboard | Callers on other hosts are untrusted |
| Plugin marketplace JSON | Valid JSON is not trusted code |
| Git remotes | Untrusted until a commit SHA is pinned and scripts are ignored |
| MCP server stdout | Untrusted JSON-RPC |

## Abuse cases considered

1. Browser on another origin calling `POST /api/install` or opening `/ws`.
2. `POST /api/validate` with a command such as `node & calc`.
3. A cloned repo whose `preinstall` writes a marker file.
4. Plugin `source` values using `..` or a symlink out of the marketplace root.
5. A handshake response whose `error` field would previously be treated as success.
6. Tokens copied into logs or websocket payloads.

## Out of scope for this change

- Compromised local user account
- Malicious content inside an approved skill markdown file after copy
- npm registry compromise of packages the user still chooses to install with `install`
- Official Cursor marketplace authentication
