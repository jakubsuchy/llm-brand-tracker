## What are Apify Actors?

- Actors are serverless cloud programs that can perform anything from a simple action, like filling out a web form, to a complex operation, like crawling an entire website or removing duplicates from a large dataset.
- Actors are programs packaged as Docker images, which accept a well-defined JSON input, perform an action, and optionally produce a well-defined JSON output.

### Apify Actor directory structure

```text
.actor/
├── actor.json            # Actor config: name, version, env vars, runtime settings
├── input_schema.json     # Input validation & Console form definition
├── dataset_schema.json   # Dataset schema definition
└── output_schema.json    # Specifies where an Actor stores its output
src/
└── main.js               # Actor entry point and orchestrator
storage/                  # Local storage (mirrors Cloud during development)
├── datasets/             # Output items (JSON objects)
├── key_value_stores/     # Files, config, INPUT
└── request_queues/       # Pending crawl requests
Dockerfile                # Container image definition
AGENTS.md                 # AI agent instructions (this file)
```

## Apify CLI

### Installation

- Install Apify CLI only if it is not already installed.
- If Apify CLI is not installed, install it using the following commands:
  - macOS/Linux: `curl -fsSL https://apify.com/install-cli.sh | bash`
  - Windows: `irm https://apify.com/install-cli.ps1 | iex`

### Apify CLI Commands

```bash
# Local development
apify run                              # Run Actor locally

# Authentication & deployment
apify login                            # Authenticate account
apify push                             # Deploy to Apify platform

# Help
apify help                             # List all commands
```

## Do

- use Apify CLI to run the Actor locally, and push it to the Apify platform
- accept well-defined JSON input and produce structured JSON output
- use Apify SDK (`apify`) for code running ON Apify platform
- validate input early with proper error handling and fail gracefully
- use PlaywrightCrawler for JavaScript-heavy sites and dynamic content
- implement retry strategies with exponential backoff for failed requests
- use proper concurrency settings (Browser: 1-5)
- set sensible defaults in `.actor/input_schema.json` for all optional fields
- set up output schema in `.actor/output_schema.json`
- clean and validate data before pushing to dataset
- respect robots.txt, ToS, and implement rate limiting with delays

## Don't

- do not run apify create command
- do not rely on `Dataset.getInfo()` for final counts on Cloud platform
- do not hard code values that should be in input schema or environment variables
- do not skip input validation or error handling
- do not overload servers - use appropriate concurrency and delays
- do not scrape prohibited content or ignore Terms of Service
- do not store personal/sensitive data unless explicitly permitted

## Resources

- [docs.apify.com/llms.txt](https://docs.apify.com/llms.txt) - Quick reference
- [docs.apify.com/llms-full.txt](https://docs.apify.com/llms-full.txt) - Complete docs
- [crawlee.dev](https://crawlee.dev) - Crawlee documentation
