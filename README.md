# Multi-Agent Code Review System

An automated pull request reviewer built on the **Claude Agent SDK**. A main orchestrator fetches a GitHub PR through **MCP**, dispatches three specialist subagents in parallel, validates their combined findings against a **Zod** schema, and writes the review as **JSON, Markdown, and HTML** reports.

## Architecture

```
                 ┌──────────────────────────────┐
  GitHub MCP ──▶ │      Main Orchestrator       │ ◀── ESLint MCP
                 │  fetch PR → dispatch → merge │
                 └──────────────┬───────────────┘
           ┌────────────────────┼────────────────────┐
           ▼                    ▼                    ▼
  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
  │  Code Quality   │  │  Test Coverage  │  │   Refactoring   │
  │    Analyzer     │  │    Analyzer     │  │    Suggester    │
  │ security, perf, │  │ untested paths, │  │ patterns, dead  │
  │ maintainability │  │ concrete tests  │  │ code, modernize │
  └─────────────────┘  └─────────────────┘  └─────────────────┘
           └────────────────────┼────────────────────┘
                                ▼
                 ReviewReport (Zod-validated JSON)
                                ▼
                    reports/<owner>_<repo>_<pr>.{json,md,html}
```

### How a review runs

1. **Fetch** — the orchestrator calls `mcp__github__get_pull_request` and `mcp__github__get_pull_request_files`, skipping lock files, binaries, and generated output.
2. **Dispatch** — it issues three `Task` tool calls in one message so the subagents run in parallel, passing each the changed files and their patches.
3. **Analyze** — each subagent loads Claude Skills (`javascript-best-practices`, `typescript-patterns`, `security-analysis`) for domain guidance and can fetch full files from GitHub for context.
4. **Aggregate** — the orchestrator merges results per file and returns structured output via the SDK's `outputFormat` (JSON Schema generated from Zod with `zod-to-json-schema`).
5. **Validate** — the output is checked with `ReviewReportSchema.safeParse`. Summary statistics (overall score, critical issues, high-priority tests, refactoring count) are **recomputed in code** from the actual findings rather than trusted from the model.
6. **Report** — `ReportGenerator` writes the three report formats.

### Reliability

- **Retries** — `withRetry` re-runs a failed review with exponential backoff plus jitter.
- **Timeouts** — `withTimeout` caps a review's duration (`Promise.race`).
- **Rate limiting** — `RateLimiter` enforces requests/min, tokens/min, and max concurrency using a 60-second sliding window.
- **Graceful degradation** — if one subagent fails, its section is filled with an empty result marked `Analysis unavailable:` instead of aborting the review.
- **Safe permissions** — runs with `permissionMode: 'dontAsk'`: only the tools in `allowedTools` are permitted, and nothing prompts — suitable for CI.

## Project Structure

```
src/
├── agents/        Subagent definitions (AgentDefinition, model: 'inherit', Skill tool)
├── prompts/       Orchestrator prompt builder + one system prompt per subagent
├── config/        MCP server configuration (GitHub, ESLint)
├── types/         Zod schemas and generated JSON Schemas
├── utils/         Error handling, rate limiter, logger, report generator
├── orchestrator.ts  Agent SDK query(), validation, summary computation
└── main.ts          CLI: argument/env validation and report output
.claude/skills/    javascript-best-practices, typescript-patterns, security-analysis
tests/             Schema, utility, and orchestrator tests (Vitest)
reports/           Generated review reports
```

## Getting Started

### Prerequisites

- Node.js 18+
- Anthropic API access (provided in the Vocareum workspace) or [your own API key](https://console.anthropic.com/) — or AWS Bedrock credentials
- [GitHub Personal Access Token](https://github.com/settings/tokens) (recommended — scopes: `repo`, `read:org`)

### Installation

**Vocareum workspace** (Anthropic credentials are pre-configured):

```bash
cd /voc/work/cd14715-claude-code-classroom
npm install                 # installs all workspaces
cd project/starter
cp .env.example .env
```

**Local machine:**

```bash
git clone https://github.com/udacity/cd14715-claude-code-classroom.git
cd cd14715-claude-code-classroom
npm install
cd project/starter
cp .env.example .env
```

### Configuration

Edit `.env`:

```bash
# Authentication — ONE of:
ANTHROPIC_API_KEY=sk-ant-your-key-here        # omit in Vocareum (already set)
# AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...  AWS_REGION=us-east-1

# Model (REQUIRED)
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
#   Bedrock: us.anthropic.claude-sonnet-4-5-20250929-v1:0

# Directory containing .claude/skills (REQUIRED)
PROJECT_ROOT=/absolute/path/to/project/starter

# GitHub token (RECOMMENDED — higher rate limits, private repos)
# GITHUB_TOKEN=ghp_your-token-here

# Logging: error | warn | info | debug
LOG_LEVEL=info
```

`.env` is git-ignored; never commit real keys.

## Usage

```bash
# Review a pull request
npm run dev -- <owner> <repo> <pr-number>

# Example
npm run dev -- udacity cd14715-simple-todo-app 2

# Production build
npm run build
npm start -- <owner> <repo> <pr-number>
```

A run prints a summary and the report paths:

```
✅ Review complete
   Files reviewed:            1
   Overall score:             52/100
   ...
📄 Reports saved:
   reports/udacity_cd14715-simple-todo-app_1.json
   reports/udacity_cd14715-simple-todo-app_1.md
   reports/udacity_cd14715-simple-todo-app_1.html
```

A review typically takes 3–5 minutes. Set `LOG_LEVEL=debug` to see every tool call and full error stacks.

### Scoring

Per file: `0.6 × code-quality score + 0.4 × estimated test coverage`, averaged across files.
Code-quality scores start at 100 and are reduced per issue by severity (critical −25, high −15, medium −7, low −3).

## Testing

```bash
npm test                          # all unit tests (SDK is mocked — no API calls)
npm test -- schemas.test.ts       # a single file
npm run lint                      # type-check
RUN_INTEGRATION=1 npm test        # also run the real-PR integration test (uses API credits)
```

| Test file | Covers |
| --- | --- |
| `tests/schemas.test.ts` | Valid/invalid data, enum and boundary checks, empty arrays, JSON Schema export |
| `tests/utils.test.ts` | Retry backoff, timeouts, sliding-window rate limiting, concurrency |
| `tests/orchestrator.test.ts` | SDK configuration, subagent dispatch, aggregation, validation, failure and retry paths |

## Sample Reports

`reports/` contains reviews of the three PRs in [udacity/cd14715-simple-todo-app](https://github.com/udacity/cd14715-simple-todo-app):

| PR | Title |
| --- | --- |
| #1 | add clean code fixture |
| #2 | Add search functionality for todos |
| #3 | Add premium subscription features |

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `ANTHROPIC_MODEL environment variable is required` | Add `ANTHROPIC_MODEL` to `.env` |
| `No authentication configured` | Set `ANTHROPIC_API_KEY`, or the three AWS variables |
| MCP server fails to connect | Check that `npx` is on your PATH; on Windows, if `npx` cannot be spawned, use `command: 'cmd'` with `args: ['/c', 'npx', ...]` in `src/config/mcp.config.ts` |
| GitHub rate limit errors | Set `GITHUB_TOKEN` |
| Skills not used | Make sure `PROJECT_ROOT` points to the directory containing `.claude/skills` |

## Tech Stack

Claude Agent SDK · Model Context Protocol · TypeScript · Zod · Vitest · Winston
