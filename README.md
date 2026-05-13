# Health Intelligence MCP

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that gives any MCP-compatible AI assistant structured access to verified health intelligence — ingesting news from WHO, CDC, NHS, and OpenFDA; running a guided multi-step symptom checker backed by PostgreSQL; locating nearby specialists via Google Maps; and generating structured PDF medical reports.

**Live endpoint:** `https://health-intelligence-mcp.onrender.com/mcp`

---

## Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Local Setup — Docker Compose](#local-setup--docker-compose)
- [Local Setup — Manual](#local-setup--manual)
- [Environment Variables](#environment-variables)
- [Database Schema](#database-schema)
- [MCP Tools](#mcp-tools)
- [Connecting to Claude](#connecting-to-claude)
- [Connecting to Other Platforms](#connecting-to-other-platforms)
- [Testing with MCP Inspector](#testing-with-mcp-inspector)
- [Deploying to Render](#deploying-to-render)
- [Running Tests](#running-tests)
- [API Sources](#api-sources)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Features

- **Health news ingestion** — fetch and deduplicate articles from WHO, CDC, NHS, and OpenFDA into PostgreSQL with a full-text search index
- **Research search** — PostgreSQL FTS ranked by relevance, with optional live PubMed search
- **Multi-step symptom checker** — 6-step clinical history flow (primary symptom → duration → severity → associated symptoms → medical history → emergency flags) with persistent session state in PostgreSQL
- **Urgency assessment** — rule-based engine returning `EMERGENCY / URGENT / SOON / ROUTINE` with likely conditions and recommended action
- **Specialist finder** — Google Maps Geocoding + Places API, returns nearby hospitals and clinics sorted by Haversine distance
- **PDF report generation** — A4 PDF via `pdf-lib` returned as a base64 blob, ready to hand to a doctor
- **Multi-platform** — works with Claude, ChatGPT, Cursor, Windsurf, Cline, Zed, Continue.dev, and any other MCP-compatible client

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Protocol | Model Context Protocol — Streamable HTTP transport |
| Runtime | Node.js 20, TypeScript 5 |
| MCP framework | `@modelcontextprotocol/sdk` |
| HTTP server | Express 4 |
| Schema validation | Zod |
| Database | PostgreSQL 16 (Neon serverless in production) |
| PDF generation | `pdf-lib` (pure Node — no headless browser) |
| Health data | WHO RSS, CDC RSS, NHS RSS, OpenFDA API, PubMed E-utilities |
| Mapping | Google Maps Geocoding API + Places API |
| Hosting | Render (web service) |
| CI/CD | GitHub → Render auto-deploy on push to `main` |

---

## Prerequisites

| Tool | Minimum version | Notes |
| --- | --- | --- |
| Node.js | 20 | Required for `--env-file` flag and `fetch` built-in |
| npm | 10 | Bundled with Node 20 |
| Docker + Docker Compose | 24 / 2.x | Optional — only for the Docker setup path |
| PostgreSQL client | Any | Optional — only needed to run `schema.sql` manually |

API keys required (see [Environment Variables](#environment-variables)):

- **Google Maps** — Geocoding API + Places API enabled in the same GCP project
- **PubMed** — free NCBI account; raises rate limit from 3 → 10 req/s
- **OpenFDA** — optional; raises rate limit from 240 → 1 000 req/min

---

## Local Setup — Docker Compose

The fastest path. Docker Compose starts a local PostgreSQL container and the app together. The schema is applied automatically on first start via the `initdb` mount — no manual migration needed.

### Step 1 — Clone and copy env file

```bash
git clone https://github.com/megamsquare/health-intelligence-mcp.git
cd health-intelligence-mcp
cp .env.example .env
```

### Step 2 — Fill in API keys in `.env`

```ini
PUBMED_API_KEY=your_key
GOOGLE_MAPS_API_KEY=your_key
OPENFDA_API_KEY=your_key          # optional
```

`DATABASE_URL` is not needed when using Docker Compose — the app container reads it from the `docker-compose.yml` environment block directly.

### Step 3 — Start (development mode with hot reload)

```bash
docker compose up --build
```

`docker-compose.override.yml` is automatically merged when you run `docker compose up`. It switches the app to the `dev` build stage, mounts source files into the container, and starts `tsx watch` — so the server restarts automatically on every file change. The database volume (`postgres_data`) and `node_modules` stay isolated from the host.

The app is available at `http://localhost:3000`. Confirm it is running:

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"health-intelligence-mcp","version":"0.1.0"}
```

### Step 4 — Start in production mode (compiled)

To run the compiled production image without hot reload, skip the override file:

```bash
docker compose -f docker-compose.yml up --build
```

This builds the `production` stage (TypeScript compiled to `dist/`) and runs `node dist/server.js`.

### Step 5 — Stop

```bash
docker compose down          # keeps the postgres_data volume
docker compose down -v       # also deletes the database volume
```

### Schema migrations

The schema is applied automatically on first start. If you change `schema.sql` and need to re-apply it, destroy the volume and restart:

```bash
docker compose down -v
docker compose up --build
```

For incremental migrations against an existing volume, connect to the running database directly:

```bash
docker compose exec db psql -U healthintel -d healthintel -f /dev/stdin < src/db/schema.sql
```

---

## Local Setup — Manual

### Step 1 — Clone and install

```bash
git clone https://github.com/megamsquare/health-intelligence-mcp.git
cd health-intelligence-mcp
npm install
```

### Step 2 — Provision a PostgreSQL database

Any PostgreSQL 14+ instance works. For a free cloud database use [Neon](https://neon.tech). Copy the connection string.

### Step 3 — Apply the schema

```bash
# If psql is installed
psql "$DATABASE_URL" -f src/db/schema.sql

# Without psql — uses the bundled pg client
node --input-type=module << 'EOF'
import pg from 'pg';
import { readFileSync } from 'fs';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(readFileSync('src/db/schema.sql', 'utf8'));
await client.end();
console.log('Schema applied.');
EOF
```

### Step 4 — Configure environment

```bash
cp .env.example .env
# Edit .env with your DATABASE_URL and API keys
```

### Step 5 — Run in development mode (watch)

```bash
npm run dev
```

### Step 6 — Build and run in production mode

```bash
npm run build
npm start
```

---

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. For Neon: `postgresql://user:pass@host.neon.tech/db?sslmode=require` |
| `PUBMED_API_KEY` | Recommended | NCBI API key. Without it, PubMed requests are rate-limited to 3/s. Get one free at [ncbi.nlm.nih.gov/account](https://www.ncbi.nlm.nih.gov/account/) |
| `GOOGLE_MAPS_API_KEY` | Yes | Required for `find_specialists`. The key must have **Geocoding API** and **Places API** enabled in GCP Console |
| `OPENFDA_API_KEY` | Optional | Raises OpenFDA rate limit from 240 to 1 000 req/min. Get one at [open.fda.gov/apis/authentication](https://open.fda.gov/apis/authentication/) |
| `PORT` | No | HTTP port. Defaults to `3000`. Render injects this automatically |
| `NODE_ENV` | No | Set to `production` by `render.yaml`. Has no functional effect currently but recommended for Express best-practices |

---

## Database Schema

Run once against your PostgreSQL database before first use (`src/db/schema.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Stores ingested articles from WHO, CDC, NHS, OpenFDA, and PubMed
CREATE TABLE IF NOT EXISTS health_articles (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT        NOT NULL CHECK (source IN ('WHO','CDC','NHS','OpenFDA','PubMed')),
  external_id  TEXT        NOT NULL,
  title        TEXT        NOT NULL,
  summary      TEXT,
  url          TEXT,
  published_at TIMESTAMPTZ,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags         TEXT[]      NOT NULL DEFAULT '{}',
  UNIQUE (source, external_id)
);

-- Full-text search index over title + summary
CREATE INDEX IF NOT EXISTS health_articles_fts
  ON health_articles
  USING GIN (to_tsvector('english', title || ' ' || COALESCE(summary, '')));

-- Source + date index for efficient feed queries
CREATE INDEX IF NOT EXISTS health_articles_source_date
  ON health_articles (source, published_at DESC);

-- Persists symptom checker sessions across requests
CREATE TABLE IF NOT EXISTS symptom_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  current_step INTEGER     NOT NULL DEFAULT 0,
  answers      JSONB       NOT NULL DEFAULT '{}',
  assessment   JSONB
);
```

### `health_articles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key, auto-generated |
| `source` | TEXT | One of `WHO`, `CDC`, `NHS`, `OpenFDA`, `PubMed` |
| `external_id` | TEXT | Source-native ID (GUID, recall number, PubMed ID). Deduplicated with `UNIQUE(source, external_id)` |
| `title` | TEXT | Article headline, HTML stripped |
| `summary` | TEXT | First 500 chars of body or abstract |
| `url` | TEXT | Canonical link |
| `published_at` | TIMESTAMPTZ | Publication date from the feed |
| `ingested_at` | TIMESTAMPTZ | When this server stored the record |
| `tags` | TEXT[] | MeSH terms (PubMed) or recall classification (OpenFDA) |

### `symptom_sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Session ID returned to the client |
| `created_at` | TIMESTAMPTZ | Session start time |
| `completed_at` | TIMESTAMPTZ | Set when all 6 steps are answered |
| `current_step` | INTEGER | 0–6; used to enforce sequential answering |
| `answers` | JSONB | Accumulated answers keyed by question name |
| `assessment` | JSONB | Final assessment object, set on completion |

---

## MCP Tools

All tools are registered on a fresh `McpServer` instance per request (stateless transport). Tool calls return MCP-structured `content` arrays; errors set `isError: true` with a human-readable message Claude can relay.

---

### `ingest_health_news`

Fetches articles from one or more health authority feeds and stores them in PostgreSQL. Uses `ON CONFLICT DO NOTHING` on `(source, external_id)` — safe to call repeatedly without creating duplicates.

Annotations: `readOnlyHint: false` · `destructiveHint: false` · `openWorldHint: true`

#### Input

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `sources` | `string[]` | `["WHO","CDC","NHS","OpenFDA"]` | Which sources to fetch. Valid values: `WHO`, `CDC`, `NHS`, `OpenFDA` |

#### Example response

```json
{
  "ingested": 23,
  "skipped_duplicates": 17
}
```

---

### `search_health_content`

Full-text search across stored articles using PostgreSQL `plainto_tsquery` with `ts_rank` relevance scoring. Optionally runs a live PubMed search in parallel.

Annotations: `readOnlyHint: true` · `openWorldHint: true`

#### Input

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `query` | `string` | — | Keywords or medical terms, e.g. `"influenza vaccine"` |
| `limit` | `integer` | `10` | Max results per source. Range: 1–20 |
| `include_pubmed` | `boolean` | `true` | Also run a live PubMed search. Adds ~1–2 s latency |

#### Example response

```json
{
  "stored_articles": [
    {
      "source": "WHO",
      "title": "WHO reports measurable health impact in 2025",
      "summary": "The World Health Organization today released...",
      "url": "https://www.who.int/news/...",
      "published_at": "2025-05-10T00:00:00.000Z",
      "tags": []
    }
  ],
  "pubmed_articles": [
    {
      "external_id": "38921034",
      "title": "Influenza vaccine effectiveness in adults aged 65+",
      "url": "https://pubmed.ncbi.nlm.nih.gov/38921034/",
      "published_at": "2025-03-01T00:00:00.000Z",
      "tags": ["Influenza Vaccines", "Aged"]
    }
  ],
  "total": 2
}
```

---

### `start_symptom_check`

Creates a new symptom checker session in PostgreSQL and returns the first clinical question. The `session_id` must be passed to every subsequent `answer_symptom_question` call.

Annotations: `readOnlyHint: false` · `destructiveHint: false`

Input: none

#### Example response

```json
{
  "session_id": "88d53b13-d6d4-4e6f-aa73-270d54a819e5",
  "step": 0,
  "total_steps": 6,
  "question": "Step 1 of 6: What is your primary symptom?\n\n1. Chest pain\n2. Headache\n..."
}
```

---

### `answer_symptom_question`

Submits an answer for the current step. Returns the next question, or on the final step returns `done: true` with the full urgency assessment. Steps must be answered in order.

Annotations: `readOnlyHint: false` · `destructiveHint: false`

#### Input

| Parameter | Type | Description |
| --- | --- | --- |
| `session_id` | `string (UUID)` | Session ID from `start_symptom_check` |
| `step` | `integer` | Current step number (0-indexed) from the previous response |
| `answer` | `string \| number \| {[key: string]: boolean}` | String or number for single-value steps; object for yes/no steps (see below) |

#### Answer format by step

| Step | Question | Answer type | Example |
| --- | --- | --- | --- |
| 0 | Primary symptom | `string` (option text or number) | `"Fever"` or `"6"` |
| 1 | Duration | `string` | `"1-3 days"` |
| 2 | Severity 1–10 | `number` | `7` |
| 3 | Associated symptoms | `{[key: string]: boolean}` | `{"fever": false, "unusual_fatigue": true, ...}` |
| 4 | Medical history | `{[key: string]: boolean}` | `{"diabetes": false, "heart_disease": false, ...}` |
| 5 | Emergency flags | `{[key: string]: boolean}` | `{"crushing_chest_pain": false, ...}` |

#### Example mid-flow response (steps 0–4)

```json
{
  "done": false,
  "step": 1,
  "total_steps": 6,
  "question": "Step 2 of 6: How long have you had this symptom?..."
}
```

#### Example final response (step 5)

```json
{
  "done": true,
  "session_id": "88d53b13-d6d4-4e6f-aa73-270d54a819e5",
  "assessment": {
    "urgency": "URGENT",
    "urgency_message": "Seek care today",
    "likely_conditions": [
      { "condition": "Viral infection (influenza, COVID-19)", "notes": "Most common cause of fever in adults." },
      { "condition": "Bacterial infection", "notes": "Needs clinical assessment." }
    ],
    "recommended_action": "Rest and stay hydrated. See a doctor if fever exceeds 39.4°C (103°F), persists beyond 3 days, or worsens.",
    "disclaimer": "This assessment is for informational purposes only..."
  }
}
```

---

### `find_specialists`

Geocodes a location with the Google Maps Geocoding API, then searches for nearby medical facilities using the Places API. Results are sorted by Haversine distance.

Annotations: `readOnlyHint: true` · `openWorldHint: true`

#### Input

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `location` | `string` | — | City, address, or postal code. e.g. `"Lagos, Nigeria"` or `"SW1A 1AA"` |
| `specialty` | `string` | — | Medical specialty or facility type. e.g. `"cardiologist"`, `"urgent care"` |
| `radius_km` | `number` | `10` | Search radius in kilometres. Range: 1–50 |

#### Example response

```json
[
  {
    "name": "Lagos State Infectious Diseases Isolation Center Yaba",
    "address": "Herbert Macaulay Way, Yaba",
    "rating": 4.2,
    "distance_km": 10.4,
    "maps_url": "https://www.google.com/maps/place/?q=place_id:ChIJ...",
    "specialty": "infectious disease"
  }
]
```

---

### `generate_medical_report`

Loads a completed symptom session from PostgreSQL and generates an A4 PDF using `pdf-lib`. The report includes urgency banner, associated symptoms, medical history, possible conditions, recommended action, and a medical disclaimer. Returns the PDF as a base64-encoded blob.

Annotations: `readOnlyHint: true` · `idempotentHint: true`

#### Input

| Parameter | Type | Description |
| --- | --- | --- |
| `session_id` | `string (UUID)` | A completed session — `done: true` must have been returned by `answer_symptom_question` |

#### Example response

```json
{
  "content": [
    {
      "type": "text",
      "text": "Medical report generated for session 88d53b13-.... The PDF is attached below."
    },
    {
      "type": "resource",
      "resource": {
        "uri": "health-report://88d53b13-....pdf",
        "mimeType": "application/pdf",
        "blob": "JVBERi0xLjQKJeLjz9MKNiAwIG9iago8P..."
      }
    }
  ]
}
```

The blob is a standard base64-encoded PDF. The `%PDF-` magic bytes encoded as base64 begin with `JVBERi0`.

---

## Connecting to Claude

### Claude Code (CLI)

```bash
# Add to the current project (local scope)
claude mcp add --transport http health-intelligence \
  https://health-intelligence-mcp.onrender.com/mcp

# Add globally for all projects
claude mcp add --transport http --scope user health-intelligence \
  https://health-intelligence-mcp.onrender.com/mcp

# Verify it was added
claude mcp list

# Remove
claude mcp remove health-intelligence
```

### Claude Desktop

1. Open Claude Desktop
2. Go to **Settings → Connectors**
3. Click **Add custom connector**
4. Enter the URL: `https://health-intelligence-mcp.onrender.com/mcp`
5. Click **Save**

> Do not add remote servers via `claude_desktop_config.json` — that file is for local stdio servers only. Remote HTTP servers must be added through the Connectors UI.

### Verify the connection

Ask Claude: *"List the tools available from the health-intelligence server."* Claude should respond with all six tools and their descriptions.

---

## Connecting to Other Platforms

MCP is an open protocol. Desktop apps and CLI tools (Cursor, Windsurf, Cline, Zed, Continue.dev) send no `Origin` header and connect without any additional server configuration. Browser-based web clients (ChatGPT, Claude.ai) are covered by the `ALLOWED_ORIGINS` allowlist in `src/server.ts`.

### OpenAI Agents SDK (Python)

```python
from agents import Agent, Runner
from agents.mcp import MCPServerHTTP

mcp = MCPServerHTTP(url="https://health-intelligence-mcp.onrender.com/mcp")

agent = Agent(
    name="Health Assistant",
    model="gpt-4o",
    instructions="Use the health-intelligence tools to help users with health queries.",
    mcp_servers=[mcp],
)

result = await Runner.run(agent, "Check symptoms: fever for 2 days, severity 7.")
```

### Cursor

1. Open **Cursor Settings** (`Cmd/Ctrl + ,`)
2. Navigate to **MCP**
3. Click **Add MCP Server**
4. Set transport to **HTTP** and paste the URL

### Windsurf

Add to your `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "health-intelligence": {
      "serverUrl": "https://health-intelligence-mcp.onrender.com/mcp"
    }
  }
}
```

### Cline (VS Code)

Open the Cline panel → **MCP Servers** tab → **Add Server** → select **HTTP** → paste the URL.

### Continue.dev

Add to `~/.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "health-intelligence",
      "transport": {
        "type": "http",
        "url": "https://health-intelligence-mcp.onrender.com/mcp"
      }
    }
  ]
}
```

### MCP Inspector (testing)

See [Testing with MCP Inspector](#testing-with-mcp-inspector) for a full walkthrough.

---

## Testing with MCP Inspector

MCP Inspector is an official browser-based tool for exploring and testing any MCP server interactively. It lets you browse the tool list, call individual tools with custom inputs, and inspect the raw JSON responses — without writing any code.

### Launch

```bash
npx @modelcontextprotocol/inspector
```

This starts two local services:

- **Proxy server** on `http://localhost:5173` — forwards MCP calls to the target server
- **UI** on `http://localhost:6274` — the browser interface

Open `http://localhost:6274` in your browser. The Inspector will prompt you to connect to an MCP server.

### Connect to the live server

1. In the **Transport Type** dropdown, select **Streamable HTTP**
2. In the **URL** field, enter:

   ```text
   https://health-intelligence-mcp.onrender.com/mcp
   ```

3. Click **Connect**

The left panel will show **Tools (6)**, **Resources (0)**, and **Prompts (0)** once the handshake completes.

> If the server is cold-starting on Render's free tier, the connection may take 30–60 seconds on the first attempt. Wait for "Connected" before proceeding.

### Connect to a local server

Start the local server first, then connect Inspector to it:

```bash
# Terminal 1 — start the server
npm run dev

# Terminal 2 — launch Inspector
npx @modelcontextprotocol/inspector
```

In the UI, use URL `http://localhost:3000/mcp` with transport **Streamable HTTP**.

---

### Using the tools

Click the **Tools** tab in the left panel to see all six tools. Click any tool name to expand its input form. Fill in the fields and click **Run Tool** to execute.

#### `ingest_health_news`

Fetches and stores articles from health authority feeds. Safe to call repeatedly — duplicates are skipped.

| Field | Value to enter |
| --- | --- |
| `sources` | `["WHO", "CDC", "NHS", "OpenFDA"]` |

Expected response:

```json
{ "ingested": 23, "skipped_duplicates": 17 }
```

Run this first — it populates the database so `search_health_content` returns results.

---

#### `search_health_content`

Searches stored articles by keyword. Optionally queries PubMed live.

| Field | Value to enter |
| --- | --- |
| `query` | `fever` |
| `limit` | `5` |
| `include_pubmed` | `true` |

Expected response shape:

```json
{
  "stored_articles": [ { "source": "WHO", "title": "...", ... } ],
  "pubmed_articles": [ { "external_id": "38921034", ... } ],
  "total": 8
}
```

---

#### `start_symptom_check`

Opens a new symptom checker session. No input required.

| Field | Value to enter |
| --- | --- |
| *(none)* | Leave empty, click **Run Tool** |

Copy the `session_id` from the response — you'll need it for the next steps.

Expected response:

```json
{
  "session_id": "88d53b13-d6d4-4e6f-aa73-270d54a819e5",
  "step": 0,
  "total_steps": 6,
  "question": "Step 1 of 6: What is your primary symptom?..."
}
```

---

#### `answer_symptom_question`

Answer each step in order. The `step` number and required answer format change at each step.

##### Step 0 — primary symptom

| Field | Value |
| --- | --- |
| `session_id` | *(paste from above)* |
| `step` | `0` |
| `answer` | `"Fever"` |

##### Step 1 — duration

| Field | Value |
| --- | --- |
| `session_id` | *(same)* |
| `step` | `1` |
| `answer` | `"1-3 days"` |

##### Step 2 — severity

| Field | Value |
| --- | --- |
| `session_id` | *(same)* |
| `step` | `2` |
| `answer` | `7` |

##### Step 3 — associated symptoms (object with boolean values)

| Field | Value |
| --- | --- |
| `session_id` | *(same)* |
| `step` | `3` |
| `answer` | `{"unusual_fatigue": true, "fever": false, "chills": false, "night_sweats": false, "nausea": false, "vomiting": false, "diarrhea": false, "rash": false, "swollen_lymph_nodes": false, "joint_pain": false}` |

**Step 4 — medical history** (object with boolean values)

| Field | Value |
| --- | --- |
| `session_id` | *(same)* |
| `step` | `4` |
| `answer` | `{"diabetes": false, "heart_disease": false, "hypertension": false, "asthma": false, "immunocompromised": false, "pregnant": false}` |

**Step 5 — emergency flags** (final step — triggers assessment)

| Field | Value |
| --- | --- |
| `session_id` | *(same)* |
| `step` | `5` |
| `answer` | `{"crushing_chest_pain": false, "difficulty_breathing": false, "loss_of_consciousness": false, "sudden_severe_headache": false, "facial_drooping": false, "uncontrolled_bleeding": false}` |

After step 5, the response contains `"done": true` and the full assessment:

```json
{
  "done": true,
  "session_id": "88d53b13-...",
  "assessment": {
    "urgency": "URGENT",
    "urgency_message": "Seek care today",
    "likely_conditions": [ ... ],
    "recommended_action": "...",
    "disclaimer": "..."
  }
}
```

---

#### `find_specialists`

Finds nearby medical facilities using Google Maps.

| Field | Value to enter |
| --- | --- |
| `location` | `Lagos, Nigeria` |
| `specialty` | `infectious disease` |
| `radius_km` | `20` |

Expected response shape:

```json
[
  {
    "name": "Lagos State Infectious Diseases Isolation Center Yaba",
    "address": "Herbert Macaulay Way, Yaba",
    "rating": 4.2,
    "distance_km": 10.4,
    "maps_url": "https://www.google.com/maps/place/?q=place_id:...",
    "specialty": "infectious disease"
  }
]
```

---

#### `generate_medical_report`

Generates a PDF report for a completed session. The session must have `done: true` (all 6 steps answered).

| Field | Value to enter |
| --- | --- |
| `session_id` | *(paste the session_id used in the symptom checker steps above)* |

The response contains a `resource` block with the PDF as a base64 blob:

```json
{
  "content": [
    { "type": "text", "text": "Medical report generated for session ..." },
    {
      "type": "resource",
      "resource": {
        "uri": "health-report://....pdf",
        "mimeType": "application/pdf",
        "blob": "JVBERi0xLjQ..."
      }
    }
  ]
}
```

The blob starts with `JVBERi0` — the base64 encoding of `%PDF-`. To decode and view the PDF, paste the blob into any base64-to-file tool, or use:

```bash
echo "JVBERi0xLjQ..." | base64 -d > report.pdf
open report.pdf
```

---

## Deploying to Render

### From the Render dashboard

Go to [render.com](https://render.com) → **New → Web Service** and connect your GitHub repository. Render detects `render.yaml` automatically and pre-fills the build and start commands.

Under **Environment**, add these variables:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Your Neon connection string |
| `PUBMED_API_KEY` | Your NCBI API key |
| `GOOGLE_MAPS_API_KEY` | Your Google Maps API key |
| `OPENFDA_API_KEY` | Your OpenFDA API key (optional) |

Click **Deploy**. `NODE_ENV=production` is set automatically by `render.yaml`.

### From the Render CLI

```bash
npm install -g @render-oss/cli
render login
render deploy
```

### Auto-deploy on push

Render redeploys automatically whenever you push to `main`. Every `git push` triggers a new deployment — no manual action needed.

### Health check

Render polls `/health` to decide if the deployment succeeded:

```bash
curl https://your-service.onrender.com/health
# {"status":"ok","service":"health-intelligence-mcp","version":"0.1.0"}
```

> **Free tier note:** Render's free tier spins the service down after 15 minutes of inactivity. The first request after a cold start may take 30–60 seconds. Upgrade to a paid instance type to eliminate cold starts.

---

## Running Tests

### End-to-end test (live Render deployment)

The repository includes an end-to-end test script that calls every tool in sequence against the live deployment:

```bash
node e2e-test.mjs
```

The script:

1. Ingests news from all four sources
2. Searches for `"fever"` with PubMed fallback
3. Runs a complete 6-step symptom check (fever · 1-3 days · severity 7 · fatigue · no history · no emergency flags)
4. Searches for infectious disease specialists in Lagos, Nigeria
5. Generates a PDF report and verifies the base64 blob starts with the PDF magic bytes

Expected output: 11 `✅ PASS` lines and a completion message.

### Smoke test (local or live)

```bash
# Health check
curl http://localhost:3000/health

# tools/list — confirm all six tools are registered
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | grep '"name"'

# Single tool call
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"start_symptom_check","arguments":{}}}' \
  | grep '^data:'
```

### Type checking

```bash
npm run build    # tsc — zero errors expected
```

---

## API Sources

### WHO (World Health Organization)

- **Feed:** `https://www.who.int/rss-feeds/news-english.xml`
- **Auth:** None (public RSS)
- **Rate limit:** No documented limit; capped at 20 items per ingestion
- **Content:** Disease outbreaks, public health emergencies, policy announcements

### CDC (Centers for Disease Control and Prevention)

- **Feed:** `https://tools.cdc.gov/api/v2/resources/media/316422.rss`
- **Auth:** None (public RSS)
- **Rate limit:** No documented limit; capped at 20 items per ingestion
- **Content:** Health alerts, outbreak notifications, traveller advisories

### NHS (National Health Service, UK)

- **Feed:** `https://www.nhs.uk/news/feed/`
- **Auth:** None (public RSS)
- **Rate limit:** No documented limit; capped at 20 items per ingestion
- **Content:** UK health news, condition guidance, public health campaigns

### OpenFDA

- **Endpoint:** `https://api.fda.gov/drug/enforcement.json`
- **Auth:** API key optional; raises rate limit from 240 to 1 000 req/min
- **Docs:** [open.fda.gov/apis](https://open.fda.gov/apis/)
- **Content:** Drug enforcement actions, recalls, safety alerts

### PubMed (NCBI E-utilities)

- **Endpoints:** `esearch.fcgi` (ID lookup) + `esummary.fcgi` (metadata fetch)
- **Auth:** API key optional; raises rate limit from 3 to 10 req/s
- **Docs:** [ncbi.nlm.nih.gov/books/NBK25501](https://www.ncbi.nlm.nih.gov/books/NBK25501/)
- **Content:** Peer-reviewed biomedical research abstracts

### Google Maps

- **APIs used:** Geocoding API (address → lat/lng) + Places API Nearby Search (lat/lng → facilities)
- **Auth:** API key required; both APIs must be enabled on the same GCP project
- **Docs:** [developers.google.com/maps](https://developers.google.com/maps)
- **Pricing:** Free tier covers ~40 000 geocode requests/month and ~5 000 nearby search requests/month

---

## Troubleshooting

### `DATABASE_URL environment variable is required`

The server cannot start without a database URL. For local development:

```bash
# Check the variable is exported
echo $DATABASE_URL

# If using .env, make sure you're starting with the dev script
npm run dev    # loads .env via --env-file
```

For the Docker Compose setup, `DATABASE_URL` is injected automatically — you do not need it in `.env`.

---

### `Error: Already connected to a transport`

This error indicates an older version of the server is running where the `McpServer` instance was shared across requests. The fix was introduced in commit `fe1dcc1`. Pull the latest code and redeploy:

```bash
git pull
npm run build
npm start
```

---

### `403 Origin not allowed`

Your client is sending an `Origin` header that is not in `ALLOWED_ORIGINS` in `src/server.ts`. Add the origin to the set:

```typescript
const ALLOWED_ORIGINS = new Set([
  // ... existing entries
  'https://your-platform.example.com',
]);
```

Desktop apps and CLI tools (Cursor, Windsurf, Cline, Zed, Continue.dev, OpenAI Agents SDK) do not send `Origin` headers and are unaffected by this check.

---

### `Could not geocode "..." — try a more specific address`

Google Maps could not resolve the location string. Use a more specific address:

```text
❌  "Lagos"
✅  "Lagos, Nigeria"
✅  "Victoria Island, Lagos, Nigeria"
```

---

### `GOOGLE_MAPS_API_KEY is not configured`

The `find_specialists` tool requires a Google Maps API key. Set it in `.env` or in the Render environment panel. Ensure both **Geocoding API** and **Places API** are enabled in the GCP Console for the same key.

---

### `PubMed search returned 429`

You have exceeded the NCBI rate limit (3 requests/s without a key). Add a `PUBMED_API_KEY` to your environment to raise the limit to 10 req/s. The server will append it automatically to all PubMed requests.

---

### Neon SSL warning on startup

```text
Warning: SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca'...
```

This warning appears if your `DATABASE_URL` contains `?sslmode=require` and you are running an older version of the code. The fix — setting `ssl: { rejectUnauthorized: true }` in the pool config — was introduced in commit `fe1dcc1`. Pull the latest code.

---

### Render cold start — first request is slow

Render's free tier suspends the service after 15 minutes of inactivity. The first request after suspension can take 30–60 seconds while the container restarts. Subsequent requests are fast. To eliminate cold starts, upgrade to a **Starter** instance type ($7/month) in the Render dashboard.

---

### `Session "..." not found or already completed`

The `session_id` is either invalid, from a different database, or the session has already completed. Start a new session with `start_symptom_check`.

---

## Contributing

Contributions are welcome — bug reports, feature suggestions, and pull requests alike.

### Development workflow

```bash
# Fork and clone
git clone https://github.com/your-username/health-intelligence-mcp.git
cd health-intelligence-mcp

# Install dependencies
npm install

# Create a feature branch
git checkout -b feat/your-feature-name

# Make changes, then build to check types
npm run build

# Run the e2e test against the live server (or your own deployed instance)
node e2e-test.mjs

# Commit and push
git add .
git commit -m "feat: description of your change"
git push origin feat/your-feature-name

# Open a pull request against main
```

### Adding a new health data source

1. Create a new file in `src/services/` following the pattern of `health-feeds.ts` or `pubmed.ts`
2. Export a function that returns `HealthArticle[]`
3. Add it to the `FETCHERS` map in `src/tools/ingest-health-news.ts`
4. Add the new source value to the `CHECK` constraint in `src/db/schema.sql`
5. Update the `sources` enum in the `ingest_health_news` tool schema in `src/server.ts`

### Adding a new MCP tool

1. Add handler logic in `src/tools/`
2. Register the tool inside `createServer()` in `src/server.ts` — include `title`, `readOnlyHint`, and `destructiveHint` annotations (required for Anthropic Directory submission)
3. Document it in this README and in `VISION.md`

### Code style

- TypeScript strict mode — `strict: true` in `tsconfig.json`
- No comments unless the *why* is non-obvious
- Error handling in tool handlers returns `{ isError: true, content: [...] }` — never throws to the transport layer

### Reporting issues

Open an issue at [github.com/megamsquare/health-intelligence-mcp/issues](https://github.com/megamsquare/health-intelligence-mcp/issues). Include:

- The tool name and input you used
- The full response or error message
- Whether you are using the hosted endpoint or a local instance

---

*Health Intelligence MCP is an informational tool and does not constitute a regulated medical device. All symptom assessments include a prominent disclaimer and are designed to direct users toward appropriate professional care.*
