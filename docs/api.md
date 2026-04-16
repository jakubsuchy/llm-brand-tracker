# API Reference

TraceAIO exposes a REST API at `/api/*`. All endpoints require authentication via session cookie or Bearer token.

Interactive API documentation is available at `/api/docs` (Swagger UI) when logged in.

## Authentication

All API routes (except auth endpoints) require one of:

- **Session cookie** — obtained after `POST /api/auth/login`
- **Bearer token** — `Authorization: Bearer <api-key>` header using your user API key

Generate an API key from the sidebar MCP dialog, or via `POST /api/users/:id/api-key`.

## Endpoints Overview

### Auth
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/needs-setup` | Check if first-run setup is needed |
| GET | `/api/auth/session` | Get current session info |
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | End session |

### Metrics
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/metrics` | Overview metrics (mention rate, top competitor, sources) |
| GET | `/api/metrics/visibility-score` | Brand visibility score (avg across models) |
| GET | `/api/metrics/trends` | Per-run historical data for charting |
| GET | `/api/metrics/by-model` | Mention rate broken down by model |
| GET | `/api/counts` | Total response and mention counts |

All metrics endpoints support `?runId=`, `?model=`, `?from=`, `?to=` query parameters.

### Analysis
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/analysis/start` | Start analysis with existing prompts |
| GET | `/api/analysis/runs` | List completed analysis runs |
| GET | `/api/analysis/progress` | Current analysis progress |
| POST | `/api/analysis/cancel` | Cancel running analysis |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings/:key` | Read a setting |
| PUT | `/api/settings/:key` | Update a setting (admin) |

Available keys: `brand`, `models`, `openai-key`, `anthropic-key`, `apify-token`, `analysis-llm`, `analysis-schedule`, `browser-mode`, `brand-domains`, `competitor-subdomains`, `competitor-blocklist`, `chatgpt-credentials`.

## MCP Integration

TraceAIO includes a Model Context Protocol server at `/mcp` for use with Claude Desktop or Claude Code.

```bash
claude mcp add --transport http brand-tracker https://your-instance/mcp --header "Authorization:Bearer YOUR_API_KEY"
```
