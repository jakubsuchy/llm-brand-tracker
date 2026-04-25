# MCP Integration

TraceAIO includes a [Model Context Protocol](https://modelcontextprotocol.io/) server that lets you query your brand tracking data using natural language in **Claude Desktop** or **Claude Code**.

## Setup

### 1. Generate an API Key

Open TraceAIO, click the **"Chat with your data"** button in the sidebar, then click **Generate API Key**. Copy the key — it's shown once and cannot be retrieved later.

![MCP Connect Dialog](/docs/images/mcp-connect-dialog.png)

> If you regenerate your API key, you must re-run the install command below. The old key is invalidated immediately.

### 2. Install in Claude Code

```bash
claude mcp add --transport http brand-tracker https://your-instance/mcp --header "Authorization:Bearer YOUR_API_KEY"
```

Replace `https://your-instance` with your TraceAIO URL (e.g. `http://localhost:3000` for local).

### 3. Install in Claude Desktop

Add to your Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "brand-tracker": {
      "url": "https://your-instance/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

## Available Tools

TraceAIO exposes 18 MCP tools. Claude automatically picks the right tool based on your question.

### Overview

| Tool | Description |
|------|-------------|
| `brand-snapshot` | Quick brand health check — mention rate, top competitor, source count |
| `brand-audit` | Comprehensive assessment — per-model rates, per-topic rates, top competitors, sources, and improvement tips |
| `get-run` | Details for a single analysis run including metrics and per-model breakdown |

### Lists & Breakdowns

| Tool | Description |
|------|-------------|
| `list-models` | Per-model mention rate breakdown |
| `list-competitors` | Ranked competitors by mention rate |
| `list-topics` | Topic-level mention rates |
| `list-sources` | Top source domains with citation counts and type (brand/competitor/neutral) |
| `list-pages` | Top individual page URLs cited across responses, with citation counts and source classification. Paginated. |
| `list-runs` | All analysis runs with status and progress |

### Deep Dives

| Tool | Description |
|------|-------------|
| `get-competitor` | Single competitor deep dive — mention rate + prompts where they appeared |
| `get-source` | Single source deep dive — citations, URLs, and responses citing the domain |
| `get-response` | Full response by ID — prompt text, model, brand mention, competitors, sources |
| `search-prompts` | Search prompts/responses by keyword, with mention status and model filters |
| `find-unmentioned` | Prompts where your brand is NOT mentioned, grouped by prompt text |
| `list-watched-urls` | Watched URLs and citation status; pass `sinceRunId` to get only URLs first cited after a given run |

### Comparisons

| Tool | Description |
|------|-------------|
| `compare-models` | Side-by-side model comparison — mention rates and per-prompt diff |
| `compare-competitor` | Brand vs. a specific competitor — overlap and exclusive mentions |
| `compare-sources` | Source overlap — which domains cite your brand vs. a competitor |

## Example Questions

Here are questions you can ask Claude once connected:

**Quick checks**
- "What's my brand mention rate?"
- "Give me a summary of our latest analysis"
- "How did run #5 compare to run #4?"

**Model analysis**
- "Which model mentions us most?"
- "Compare ChatGPT and Perplexity side by side"
- "Which model is worst for our brand?"

**Competitor intelligence**
- "Who are our top competitors?"
- "How do we compare against Cloudflare?"
- "Which prompts mention Fastly but not us?"

**Content gaps**
- "What prompts don't mention us?"
- "Which topics have the lowest mention rate?"
- "Find prompts about load balancing where we're missing"

**Source analysis**
- "Which sources cite competitors but not us?"
- "What domains cite us most?"
- "Compare our source profile against Akamai"

## Authentication Notes

- MCP uses the same API keys as the REST API Bearer token auth
- Each user has their own API key
- Keys are hashed at rest (SHA-256) — TraceAIO never stores the plaintext key after generation
- If you regenerate your key, the previous key stops working immediately and you must update your MCP configuration
