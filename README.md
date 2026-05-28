# Health Intelligence MCP

A remote [Model Context Protocol](https://modelcontextprotocol.io) server that gives any MCP-compatible AI assistant structured access to verified health intelligence — ingesting news from WHO, CDC, NHS, OpenFDA, ECDC, PAHO, and Africa CDC; running a guided multi-step symptom checker backed by PostgreSQL; locating nearby specialists via Google Maps; and generating structured PDF medical reports.

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
- [Authentication](#authentication)
- [MCP Tools](#mcp-tools)
- [MCP Resources](#mcp-resources)
- [MCP Prompts](#mcp-prompts)
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

- **Health news ingestion** — fetch and deduplicate articles from WHO, CDC, NHS, OpenFDA, ECDC, PAHO, and Africa CDC into PostgreSQL with a full-text search index
- **Document ingestion** — upload any medical PDF, DOCX, TXT, Markdown, CSV, or JSON file; SHA-256 deduplicated and indexed for FTS and symptom assessment enrichment
- **Research search** — PostgreSQL FTS ranked by relevance, with optional live PubMed search
- **Multi-step symptom checker** — 6-step clinical history flow (primary symptom → duration → severity → associated symptoms → medical history → emergency flags) with persistent session state in PostgreSQL
- **Urgency assessment** — rule-based engine returning `EMERGENCY / URGENT / SOON / ROUTINE` with likely conditions and recommended action
- **Specialist finder** — Google Maps Geocoding + Places API, returns nearby hospitals and clinics sorted by Haversine distance
- **PDF report generation** — A4 PDF via `pdf-lib` returned as a base64 blob, ready to hand to a doctor
- **MCP resources** — four readable URIs exposing recent articles, condition intelligence, and session history for context-window injection
- **MCP prompts** — four pre-built conversation starters covering guided symptom checking, emergency triage, pre-appointment preparation, and condition explanation at adjustable audience depth
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
| Health data | WHO RSS, CDC RSS, NHS RSS, OpenFDA API, ECDC RSS, PAHO RSS, Africa CDC RSS, PubMed E-utilities |
| Mapping | Google Maps Geocoding API + Places API |
| Hosting | Render (web service) |
| CI/CD | GitHub → Render auto-deploy on push to `main` |

---

## System Architecture

```mermaid
graph TD
    subgraph "AI Clients"
        CD["Claude Desktop\n(via mcp-remote)"]
        CC["Claude Code CLI"]
        CU["Cursor / Windsurf / Cline"]
    end

    subgraph "Health Intelligence Platform"
        FE["Next.js Frontend\n(Vercel — mmolayemi.com)"]
        BE["NestJS Backend\n(Cloud Run)"]
        FS[("Firestore\nusers · orgs · tokens")]
        MCP["MCP Server\n(Render — this service)"]
        PG[("Neon PostgreSQL\narticles · sessions · api_keys")]
    end

    subgraph "External Data Sources"
        WHO["WHO RSS"]
        CDC["CDC RSS"]
        NHS["NHS RSS"]
        ECDC["ECDC RSS"]
        PAHO["PAHO RSS"]
        ACDC["Africa CDC RSS"]
        OFDA["OpenFDA API"]
        PM["PubMed E-utilities"]
        MAPS["Google Maps API"]
    end

    FE -->|"Bearer JWT (signup/login)"| BE
    BE --> FS
    BE -->|"issue/revoke token\nx-server-secret"| MCP

    CD -->|"Bearer MCP JWT\nvia mcp-remote"| MCP
    CC -->|"Bearer MCP JWT"| MCP
    CU -->|"Bearer MCP JWT"| MCP

    MCP -->|"store articles\nsymptom sessions"| PG
    MCP --> WHO
    MCP --> CDC
    MCP --> NHS
    MCP --> ECDC
    MCP --> PAHO
    MCP --> ACDC
    MCP --> OFDA
    MCP --> PM
    MCP --> MAPS
```

### Request authentication flow

1. User registers at mmolayemi.com — the NestJS backend issues an HS256 MCP JWT
2. User pastes the JWT into their AI client
3. On every tool call, the MCP server validates the JWT signature (`SHARED_SECRET`), checks the `jti` against the revocation list, and enforces `calls_per_day` / `sessions_per_day` from the token claims
4. No database call is made per auth check — all quota data is in the token

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
| `SHARED_SECRET` | Yes | 256-bit hex secret used to sign and verify HS256 MCP JWTs. Must match `SHARED_SECRET` in the NestJS backend |
| `SERVER_SECRET` | Yes | Sent in the `x-server-secret` header to authorise the token revocation endpoint. Must match `SERVER_SECRET` in the NestJS backend |
| `OWNER_TOKEN` | Yes | Long-lived owner JWT (tier=owner, 3650 days) for server-to-server ingestion calls. Generate via the admin settings page |
| `PUBMED_API_KEY` | Recommended | NCBI API key. Without it, PubMed requests are rate-limited to 3/s. Get one free at [ncbi.nlm.nih.gov/account](https://www.ncbi.nlm.nih.gov/account/) |
| `GOOGLE_MAPS_API_KEY` | Yes | Required for `find_specialists`. The key must have **Geocoding API** and **Places API** enabled in GCP Console |
| `OPENFDA_API_KEY` | Optional | Raises OpenFDA rate limit from 240 to 1 000 req/min. Get one at [open.fda.gov/apis/authentication](https://open.fda.gov/apis/authentication/) |
| `USE_REDIS` | No | Set to `true` to enable Redis-backed rate limiting. Defaults to `false` (in-memory) |
| `PORT` | No | HTTP port. Defaults to `3000`. Render injects this automatically |
| `NODE_ENV` | No | Set to `production` by `render.yaml`. Has no functional effect currently but recommended for Express best-practices |

---

## Database Schema

Run once against your PostgreSQL database before first use (`src/db/schema.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Stores ingested articles from WHO, CDC, NHS, OpenFDA, ECDC, PAHO, AfricaCDC, PubMed, and uploaded documents
CREATE TABLE IF NOT EXISTS health_articles (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT        NOT NULL CHECK (source IN ('WHO','CDC','NHS','OpenFDA','ECDC','PAHO','AfricaCDC','PubMed','Upload')),
  external_id   TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  summary       TEXT,
  url           TEXT,
  published_at  TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags          TEXT[]      NOT NULL DEFAULT '{}',
  -- Pre-computed at insert time; reused by FTS queries and ts_rank without recomputing
  search_vector TSVECTOR    GENERATED ALWAYS AS
                  (to_tsvector('english', title || ' ' || COALESCE(summary, ''))) STORED,
  UNIQUE (source, external_id)
);

-- GIN index on the stored tsvector column (faster than a functional index)
CREATE INDEX IF NOT EXISTS health_articles_fts
  ON health_articles USING GIN (search_vector);

-- Source + date index for efficient feed queries
CREATE INDEX IF NOT EXISTS health_articles_source_date
  ON health_articles (source, published_at DESC);

-- GIN index on tags for array containment queries
CREATE INDEX IF NOT EXISTS health_articles_tags
  ON health_articles USING GIN (tags);

-- Persists symptom checker sessions across requests
CREATE TABLE IF NOT EXISTS symptom_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  current_step INTEGER     NOT NULL DEFAULT 0,
  answers      JSONB       NOT NULL DEFAULT '{}',
  assessment   JSONB
);

-- Partial index covering only active (incomplete) sessions — the only ones queried mid-flow
CREATE INDEX IF NOT EXISTS symptom_sessions_active
  ON symptom_sessions (id)
  WHERE completed_at IS NULL;
```

### `health_articles`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key, auto-generated |
| `source` | TEXT | One of `WHO`, `CDC`, `NHS`, `OpenFDA`, `ECDC`, `PAHO`, `AfricaCDC`, `PubMed`, `Upload` |
| `external_id` | TEXT | Source-native ID (GUID, recall number, PubMed ID). Deduplicated with `UNIQUE(source, external_id)` |
| `title` | TEXT | Article headline, HTML stripped |
| `summary` | TEXT | First 500 chars of body or abstract |
| `url` | TEXT | Canonical link |
| `published_at` | TIMESTAMPTZ | Publication date from the feed |
| `ingested_at` | TIMESTAMPTZ | When this server stored the record |
| `tags` | TEXT[] | MeSH terms (PubMed) or recall classification (OpenFDA) |
| `search_vector` | TSVECTOR | Generated stored column — `to_tsvector` of title + summary, computed once at insert and used by FTS queries |

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

## Authentication

The MCP server requires a valid JWT in the `Authorization` header for all tool calls. Tokens are issued by the Health Intelligence backend and are **not** self-generated.

### Getting a token

1. Register at [mmolayemi.com/register](https://mmolayemi.com/register) — free, no credit card required
2. Your MCP token is displayed immediately after signup
3. Copy the token and paste it into your AI client as shown in [Connecting to Claude](#connecting-to-claude)

You can also retrieve or re-issue your token any time from the dashboard at [mmolayemi.com/dashboard](https://mmolayemi.com/dashboard).

### Token claims

Tokens are HS256 JWTs signed with the `SHARED_SECRET` shared between the backend and this MCP server. The server validates the signature and reads quota limits directly from the token claims — no database call is made per request:

```json
{
  "sub": "userId",
  "email": "user@example.com",
  "tier": "personal",
  "org_id": null,
  "calls_per_day": 200,
  "sessions_per_day": 50,
  "jti": "unique-token-id",
  "iat": 1748390400,
  "exp": 1750982400
}
```

### Available tiers

| Tier | Calls/day | Sessions/day | Duration |
| --- | --- | --- | --- |
| `free` | 10 | 2 | Permanent |
| `org_owner` (free org) | 100 | 20 | Permanent |
| `personal` | 200 | 50 | 30 days |
| `org_owner` (paid org) | 500 | 100 | 365 days |
| `org_member` | 500 | 100 | 365 days |

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
| `sources` | `string[]` | `["WHO","CDC","NHS","OpenFDA","ECDC","PAHO","AfricaCDC"]` | Which sources to fetch. Valid values: `WHO`, `CDC`, `NHS`, `OpenFDA`, `ECDC`, `PAHO`, `AfricaCDC` |

#### Example response

```json
{
  "ingested": 23,
  "skipped_duplicates": 17
}
```

---

### `ingest_document`

Upload a medical document to make its contents searchable and available for symptom assessment enrichment. Accepts the file as a base64-encoded string. Duplicate uploads of the same file are silently ignored (SHA-256 dedup).

Annotations: `readOnlyHint: false` · `destructiveHint: false`

#### Input

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `content_base64` | `string` | Yes | Base64-encoded file content. Maximum file size: 20 MB |
| `filename` | `string` | Yes | Original filename with extension, e.g. `"malaria-treatment-guidelines-2024.pdf"` |
| `mime_type` | `string` | No | MIME type, e.g. `"application/pdf"`. Inferred from filename if omitted |

**Supported formats:** PDF, DOCX, TXT, MD, CSV, JSON

#### Example response

```json
{
  "status": "ingested",
  "sha256": "a1b2c3...",
  "chunks": 12
}
```

> If the file was already uploaded (same SHA-256), the response is `{ "status": "duplicate" }`.

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

## MCP Resources

Resources are readable URIs that MCP clients can fetch and inject directly into the model's context window — no tool call required. The server exposes four resources across two URI schemes.

All resources return `application/json` content.

---

### `health://articles/recent`

**Type:** static URI

The 50 most recently ingested articles, ordered by `ingested_at DESC`. Useful as a live news feed for grounding responses in current health headlines without running a search.

#### Example response

```json
[
  {
    "id": "3f2a1b...",
    "source": "WHO",
    "title": "Largest catch-up initiative delivers over 100 million childhood vaccinations",
    "summary": "The Big Catch-Up, launched during World Immunization Week 2023...",
    "url": "https://www.who.int/news/item/24-04-2026-...",
    "published_at": "2026-04-24T00:01:25.000Z",
    "ingested_at": "2026-05-18T10:22:11.000Z",
    "tags": []
  }
]
```

---

### `health://conditions/list`

**Type:** static URI

Distinct medical condition names that have appeared in the `likely_conditions` array of completed symptom-check assessments, with a session count for each. Use this to discover what conditions are represented in the database before fetching detail.

#### Example response

```json
[
  { "name": "Bacterial infection", "session_count": 3 },
  { "name": "Migraine", "session_count": 2 },
  { "name": "Tension headache", "session_count": 5 },
  { "name": "Viral infection (influenza, COVID-19)", "session_count": 3 }
]
```

Returns an empty array if no sessions have been completed yet.

---

### `health://conditions/{name}`

**Type:** URI template

Detail for a single condition identified by its exact name from `health://conditions/list`. Returns two things:

- **`sessions`** — every completed symptom session that listed this condition in its assessment, with urgency level, primary symptom, and the condition notes
- **`related_articles`** — up to 5 articles from `health_articles` matched by full-text search on the condition name

URI-encode the condition name: spaces → `%20`, parentheses → `%28` / `%29`.

#### Example

```text
health://conditions/Tension%20headache
```

#### Example response

```json
{
  "name": "Tension headache",
  "sessions": [
    {
      "session_id": "55c8c230-14f8-438e-9ac6-2f1e5b5b6d0c",
      "created_at": "2026-05-18T11:04:22.000Z",
      "primary_symptom": "Headache",
      "urgency": "ROUTINE",
      "notes": "Most common cause."
    }
  ],
  "related_articles": [
    {
      "source": "NHS",
      "title": "UKHSA and Stablepharma highlight breakthrough with fridge-free tetanus...",
      "url": "https://www.gov.uk/government/news/...",
      "published_at": "2026-03-13T12:31:45.000Z"
    }
  ]
}
```

---

### `health://session/{session_id}`

**Type:** URI template

Full record for a symptom-check session. Reconstructs each step as a `{ step, question, answer }` turn from the stored answers and the question definitions — so the entire clinical history is human-readable without knowing the internal schema.

Returns a not-found object if the UUID does not exist rather than an error, so clients can handle the case gracefully.

#### Example

```text
health://session/55c8c230-14f8-438e-9ac6-2f1e5b5b6d0c
```

#### Example response

```json
{
  "session_id": "55c8c230-14f8-438e-9ac6-2f1e5b5b6d0c",
  "created_at": "2026-05-18T11:04:22.000Z",
  "completed_at": "2026-05-18T11:05:01.000Z",
  "turns": [
    { "step": 0, "question": "What is your primary symptom?", "answer": "Headache" },
    { "step": 1, "question": "How long have you had this symptom?", "answer": "Less than 24 hours" },
    { "step": 2, "question": "Rate the severity from 1 (barely noticeable) to 10 (worst possible)", "answer": 7 },
    { "step": 3, "question": "Do you also have any of these symptoms?...", "answer": { "fever": false, "nausea_vomiting": true, ... } },
    { "step": 4, "question": "Do you have any of these existing conditions?...", "answer": { "diabetes": false, ... } },
    { "step": 5, "question": "IMPORTANT — Are you experiencing any of these right now?...", "answer": { "crushing_chest_pain": false, ... } }
  ],
  "assessment": {
    "urgency": "ROUTINE",
    "urgency_message": "Schedule an appointment when convenient",
    "likely_conditions": [
      { "condition": "Tension headache", "notes": "Most common cause." },
      { "condition": "Migraine", "notes": "Especially if recurring or with light/sound sensitivity." }
    ],
    "recommended_action": "Rest, stay hydrated. See your doctor if headaches are recurring...",
    "disclaimer": "This assessment is for informational purposes only..."
  }
}
```

#### Not-found response

```json
{ "error": "Session \"00000000-0000-0000-0000-000000000000\" not found" }
```

---

## MCP Prompts

Prompts are pre-built conversation starters that MCP clients surface as slash commands, quick-actions, or template pickers. The client calls `prompts/get` with the prompt name and any arguments; the server returns a ready-to-send message array that pre-populates the conversation.

All four prompts return a single `user`-role message. Arguments that have defaults are optional — clients that do not supply them receive sensible fallback values.

---

### `symptom-checker`

Opens a structured, one-question-at-a-time symptom assessment. Begins every conversation with a mandatory medical disclaimer and an immediate emergency services redirect for life-threatening situations.

#### Arguments

| Argument | Type | Default | Description |
| --- | --- | --- | --- |
| `language` | `string` | `"English"` | Language to conduct the assessment in, e.g. `"Spanish"`, `"French"` |
| `urgency` | `"standard" \| "fast-track"` | `"standard"` | `"standard"` — full 6-step clinical history; `"fast-track"` — 3-question triage for patients who are unwell right now |

#### Behaviour

**`standard` mode** walks through six areas in sequence — primary symptom, duration, severity (1–10), associated symptoms, medical history, emergency flags — and produces a final urgency assessment (`EMERGENCY / URGENT / SOON / ROUTINE`) with likely conditions and recommended action. It also tips the model to use the `start_symptom_check` and `answer_symptom_question` tools if a logged, reportable session is wanted.

**`fast-track` mode** asks three questions only — primary symptom, severity, and emergency warning signs — then gives an immediate urgency assessment. Suited for time-sensitive situations.

Both modes enforce the one-question-at-a-time rule and instruct the model to halt the flow and direct the user to emergency services if any life-threatening answer is given.

---

### `emergency-triage`

Fast-path prompt for urgent or potentially life-threatening symptoms. Returns an action-first response without preamble or clarifying questions.

#### Arguments

| Argument | Type | Description |
| --- | --- | --- |
| `symptoms` | `string` | Brief description of the symptoms, e.g. `"chest pain radiating to left arm, sweating, difficulty breathing"` |

#### Response structure

The model is instructed to produce exactly four sections in this order:

1. **CALL EMERGENCY SERVICES NOW IF** — explicit red flags that mean 999 / 911 / 112 must be called immediately
2. **IMMEDIATE FIRST-AID STEPS** — numbered, action-by-action steps to take right now
3. **DO NOT** — up to five things the patient must not do with these symptoms
4. **FIND CARE** — appropriate care level and how to locate the nearest facility; the model is told to use the `find_specialists` tool if the user shares their location

---

### `pre-appointment-prep`

Generates a structured checklist to help a patient prepare for a doctor visit. Optionally personalises the output by pulling the patient's recorded symptom history from a completed session.

#### Arguments

| Argument | Type | Description |
| --- | --- | --- |
| `condition` | `string` | Medical condition or concern, e.g. `"Type 2 diabetes"`, `"recurring migraines"` |
| `session_id` | `string (UUID)` | Optional. UUID of a completed symptom-check session. When provided, the full Q&A history and assessment are embedded in the prompt. |

#### Checklist sections

- **Questions to ask the doctor** (8–10 specific, meaningful questions about the condition)
- **Symptoms and changes to track** before the appointment, with a simple log format
- **Medications and supplements to list**, including a template for doses and frequency
- **Tests and records to bring** — prior results, imaging, and home monitoring data relevant to the condition
- **Lifestyle information to share** — diet, exercise, sleep, stress, and occupation context

When `session_id` is supplied and the session is complete, the server fetches it via `getSession()` at `prompts/get` time and injects the patient's symptom history directly into the message, making all five sections specific to what the patient already reported.

---

### `condition-explainer`

Plain-language explanation of a medical condition, with depth and vocabulary calibrated to the intended audience.

#### Arguments

| Argument | Type | Description |
| --- | --- | --- |
| `condition` | `string` | Medical condition to explain, e.g. `"atrial fibrillation"`, `"Crohn's disease"` |
| `audience` | `"patient" \| "caregiver" \| "child" \| "medical student"` | Controls tone, vocabulary, and depth of the explanation |

#### Audience modes

| Audience | Tone and depth |
| --- | --- |
| `patient` | Plain language, reassuring, medical terms defined on first use, focus on what the patient can do |
| `caregiver` | Practical support guidance, how to recognise a flare-up, when to escalate, emotional support considerations |
| `child` | Simple words, short sentences, at least one relatable analogy; calm and empowering; avoids frightening language |
| `medical student` | Clinical depth — pathophysiology, diagnostic criteria, classification systems, first- and second-line protocols, monitoring parameters, relevant guideline bodies (NICE, AHA, WHO) |

#### Explanation sections

All audience modes cover: **What it is · Common symptoms · How it's diagnosed · Treatment options · Day-to-day management · When to seek urgent care.** Each section closes with a reminder that the content is educational and the reader should discuss their specific situation with a healthcare provider.

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

The server requires an `Authorization` header that the Claude Desktop Connectors UI cannot inject. Use the `mcp-remote` bridge instead:

1. Install `mcp-remote` (one-time):
   ```bash
   npm install -g mcp-remote
   ```

2. Add to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`, Windows: `%APPDATA%\Claude\claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "health-intelligence": {
         "command": "mcp-remote",
         "args": [
           "https://health-intelligence-mcp.onrender.com/mcp",
           "--header",
           "Authorization: Bearer YOUR_MCP_TOKEN"
         ]
       }
     }
   }
   ```

3. Replace `YOUR_MCP_TOKEN` with your token from [mmolayemi.com/dashboard](https://mmolayemi.com/dashboard).

4. Restart Claude Desktop.

> `mcp-remote` acts as a local stdio-to-HTTP bridge, allowing Claude Desktop to connect to authenticated remote servers.

### Verify the connection

Ask Claude: *"List the tools, resources, and prompts available from the health-intelligence server."* Claude should respond with all seven tools, four resources, and four prompts.

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

The left panel will show **Tools (7)**, **Resources (4)**, and **Prompts (4)** once the handshake completes.

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

Click the **Tools** tab in the left panel to see all seven tools. Click any tool name to expand its input form. Fill in the fields and click **Run Tool** to execute.

#### `ingest_health_news`

Fetches and stores articles from health authority feeds. Safe to call repeatedly — duplicates are skipped.

| Field | Value to enter |
| --- | --- |
| `sources` | `["WHO", "CDC", "NHS", "OpenFDA", "ECDC", "PAHO", "AfricaCDC"]` |

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

### Using the prompts

Click the **Prompts** tab in the left panel to see all four prompts. Click a prompt name to expand its argument form, fill in the fields, and click **Get Prompt** to render the message. Inspector displays the resulting conversation and lets you send it directly to a connected model.

#### `symptom-checker`

| Field | Value to enter |
| --- | --- |
| `language` | `English` |
| `urgency` | `standard` |

The rendered message opens with the medical disclaimer and instructs the model to ask one question at a time. Change `urgency` to `fast-track` for a 3-question triage flow, or `language` to `Spanish` (or any language) to run the assessment in that language.

---

#### `emergency-triage`

| Field | Value to enter |
| --- | --- |
| `symptoms` | `severe chest pain radiating to left arm, sweating, nausea` |

The rendered message contains four labelled sections: **CALL EMERGENCY SERVICES NOW IF**, **IMMEDIATE FIRST-AID STEPS**, **DO NOT**, and **FIND CARE**.

---

#### `pre-appointment-prep`

| Field | Value to enter |
| --- | --- |
| `condition` | `Type 2 diabetes` |
| `session_id` | *(leave blank, or paste a completed session UUID)* |

Without a `session_id` the checklist is generic for the condition. With a completed session UUID the server fetches the patient's recorded symptom history and embeds it — run `start_symptom_check` through all 6 steps first, copy the `session_id`, then pass it here.

---

#### `condition-explainer`

| Field | Value to enter |
| --- | --- |
| `condition` | `atrial fibrillation` |
| `audience` | `patient` |

Try changing `audience` to `medical student`, `caregiver`, or `child` to see how the tone and depth of the explanation shifts.

---

## Deploying to Render

### From the Render dashboard

Go to [render.com](https://render.com) → **New → Web Service** and connect your GitHub repository. Render detects `render.yaml` automatically and pre-fills the build and start commands.

Under **Environment**, add these variables:

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Your Neon connection string |
| `SHARED_SECRET` | 256-bit hex secret (must match the NestJS backend) |
| `SERVER_SECRET` | Server-to-server secret (must match the NestJS backend) |
| `OWNER_TOKEN` | Long-lived owner JWT from the admin settings page |
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

1. Ingests news from all seven sources
2. Searches for `"fever"` with PubMed fallback
3. Runs a complete 6-step symptom check (fever · 1-3 days · severity 7 · fatigue · no history · no emergency flags)
4. Searches for infectious disease specialists in Lagos, Nigeria
5. Generates a PDF report and verifies the base64 blob starts with the PDF magic bytes

Expected output: 11 `✅ PASS` lines and a completion message.

### Smoke test (local or live)

```bash
# Health check
curl http://localhost:3000/health

# tools/list — confirm all seven tools are registered
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

### ECDC (European Centre for Disease Prevention and Control)

- **Feed:** `https://www.ecdc.europa.eu/en/rss.xml`
- **Auth:** None (public RSS)
- **Rate limit:** No documented limit; capped at 20 items per ingestion
- **Content:** European disease surveillance, outbreak reports, public health threats

### PAHO (Pan American Health Organization)

- **Feed:** `https://www.paho.org/en/rss.xml`
- **Auth:** None (public RSS)
- **Rate limit:** No documented limit; capped at 20 items per ingestion
- **Content:** Health alerts and disease intelligence for the Americas

### Africa CDC (Africa Centres for Disease Control and Prevention)

- **Feed:** `https://africacdc.org/feed/`
- **Auth:** None (public RSS)
- **Rate limit:** No documented limit; capped at 20 items per ingestion
- **Content:** African region disease surveillance, outbreak alerts, public health guidance

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

### Adding a new MCP resource

1. Add the query logic in `src/resources/` following the pattern of `articles.ts`, `conditions.ts`, or `sessions.ts`
2. Import and register inside `createServer()` in `src/server.ts`:
   - Static URI: `server.registerResource(name, 'health://your/uri', config, readCallback)`
   - Parameterised: `server.registerResource(name, new ResourceTemplate('health://your/{var}', { list: undefined }), config, readCallback)`
3. Return `{ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(...) }] }`
4. Document the URI, response shape, and any not-found behaviour in the [MCP Resources](#mcp-resources) section of this README

### Adding a new MCP prompt

1. Create a file in `src/prompts/` that exports an args schema object and a builder function:

   ```typescript
   export const myPromptArgs = {
     param: z.string().describe('...'),
     optional_param: z.string().optional(),
   };
   export function buildMyPrompt(args: { param: string; optional_param?: string }) {
     return {
       description: `Short description with ${args.param}`,
       messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `...` } }],
     };
   }
   ```

2. Import and register inside `createServer()` in `src/server.ts`:

   ```typescript
   server.registerPrompt('my-prompt', {
     title: 'Human-readable title',
     description: 'Shown in client prompt pickers.',
     argsSchema: myPromptArgs,
   }, ({ param, optional_param }) => buildMyPrompt({ param, optional_param }));
   ```

3. If the builder needs async work (e.g. a DB lookup), make it `async` — `registerPrompt` accepts `Promise<GetPromptResult>`
4. Document the prompt, its arguments, and the rendered message structure in the [MCP Prompts](#mcp-prompts) section of this README

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
