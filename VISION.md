# Health Intelligence MCP — Vision & Architecture

> **Verified health intelligence, guided symptom assessment, and personalised care navigation — delivered as a Model Context Protocol server that works inside Claude, GPT-4o, Gemini, and any other MCP-compatible AI platform.**

---

## The Problem

Access to reliable health information remains deeply unequal.

In high-income countries, patients face a different crisis: an overwhelming volume of unverified health content online, long wait times for GP appointments, and no structured way to organise their symptoms before seeing a doctor. In lower-income and underserved regions, the gap is starker — specialist care may be hours away, and the cost of an unnecessary emergency visit can be catastrophic.

At the same time, large language models are increasingly used as informal health advisors — with no guardrails, no verified sources, and no pathway to real care. A user asking Claude "I have a fever and headache, what should I do?" deserves more than a generic disclaimer. They deserve verified information, a structured assessment, and a clear next step.

**Health Intelligence MCP bridges that gap.**

---

## The Solution

Health Intelligence MCP is a remote MCP server that gives Claude direct, structured access to:

- **Verified health data** from WHO, CDC, NHS, OpenFDA, and PubMed — ingested, stored, and searchable
- **A guided multi-step symptom checker** that collects a clinical history and returns a structured urgency assessment
- **A specialist finder** that locates nearby hospitals and clinics via Google Maps
- **A PDF medical report generator** that produces a structured document the patient hands to their doctor

Because it is built on the Model Context Protocol — an open standard, not a Claude-exclusive API — it integrates natively into any MCP-compatible AI interface. No separate app to install. No login wall. The user simply talks to their AI assistant of choice, and the assistant uses the tools.

### Target Users

| User | Use case |
| --- | --- |
| **Patients in underserved regions** | First-point-of-contact health guidance and nearest facility finder |
| **Patients preparing for a GP visit** | Structured symptom history and printed report to bring to the appointment |
| **Caregivers** | Navigating symptoms for a family member and finding appropriate specialists |
| **Health researchers** | Searching verified WHO/CDC/PubMed content without leaving their workflow |
| **Healthcare NGOs** | Deploying structured triage tooling in low-resource settings |

---

## Architecture

```text
╔══════════════════════════════════════════════════════════════════════════════╗
║                            CLAUDE AI CLIENT                                 ║
║                  Claude Code · Claude.ai · Claude Desktop                   ║
╚══════════════════════════╤═════════════════════════════════════════════════╝
                           │
                           │  MCP Streamable HTTP  (POST /mcp)
                           │  Accept: application/json, text/event-stream
                           │
╔══════════════════════════▼═════════════════════════════════════════════════╗
║              HEALTH INTELLIGENCE MCP SERVER  (Render — Node 20)            ║
║                                                                             ║
║  ┌─────────────────────┐   ┌──────────────────────┐   ┌─────────────────┐ ║
║  │  INGESTION LAYER    │   │   SEARCH LAYER        │   │ SYMPTOM LAYER   │ ║
║  │                     │   │                       │   │                 │ ║
║  │ ingest_health_news  │   │ search_health_content │   │start_symptom_   │ ║
║  │                     │   │                       │   │check            │ ║
║  │ • WHO RSS parser    │   │ • PostgreSQL FTS       │   │                 │ ║
║  │ • CDC RSS parser    │   │   (plainto_tsquery)   │   │answer_symptom_  │ ║
║  │ • NHS RSS parser    │   │ • Live PubMed search  │   │question         │ ║
║  │ • OpenFDA API       │   │   (esearch + esummary)│   │                 │ ║
║  │                     │   │                       │   │ 6-step clinical │ ║
║  │ ON CONFLICT DO      │   │ Ranked by ts_rank +   │   │ history flow:   │ ║
║  │ NOTHING (dedup)     │   │ published_at DESC     │   │ symptom→duration│ ║
║  └──────────┬──────────┘   └──────────┬────────────┘   │ →severity      │ ║
║             │                         │                 │ →associated    │ ║
║             │              ╔══════════▼════════════╗    │ →history       │ ║
║             │              ║   Neon PostgreSQL      ║    │ →emergency     │ ║
║             └─────────────►║                       ║◄───┘                 ║
║                            ║  health_articles      ║                      ║
║                            ║  ┌─────────────────┐  ║    ┌─────────────┐  ║
║                            ║  │id  UUID PK      │  ║    │ASSESSMENT   │  ║
║                            ║  │source           │  ║    │ENGINE       │  ║
║                            ║  │external_id      │  ║    │             │  ║
║                            ║  │title            │  ║    │Rule-based   │  ║
║                            ║  │summary          │  ║    │urgency      │  ║
║                            ║  │url              │  ║    │scoring:     │  ║
║                            ║  │published_at     │  ║    │EMERGENCY    │  ║
║                            ║  │GIN FTS index    │  ║    │URGENT       │  ║
║                            ║  └─────────────────┘  ║    │SOON         │  ║
║                            ║                       ║    │ROUTINE      │  ║
║                            ║  symptom_sessions     ║    └──────┬──────┘  ║
║                            ║  ┌─────────────────┐  ║           │          ║
║                            ║  │id  UUID PK      │  ║           │          ║
║                            ║  │current_step     │◄─╗           │          ║
║                            ║  │answers  JSONB   │  ║           ▼          ║
║                            ║  │assessment JSONB │  ║  ┌─────────────────┐ ║
║                            ║  │completed_at     │  ║  │ REPORT LAYER    │ ║
║                            ║  └─────────────────┘  ║  │                 │ ║
║                            ╚═══════════════════════╝  │generate_medical_│ ║
║                                                        │report           │ ║
║  ┌─────────────────────────────────────────┐          │                 │ ║
║  │  SPECIALIST LAYER                       │          │ pdf-lib (A4)    │ ║
║  │                                         │          │ • Header bar    │ ║
║  │  find_specialists                       │          │ • Urgency banner│ ║
║  │                                         │          │ • Conditions    │ ║
║  │  1. Geocode location  ──► Google Maps   │          │ • Action plan   │ ║
║  │     Geocoding API                       │          │ • Disclaimer    │ ║
║  │  2. Places nearby     ──► Places API    │          │                 │ ║
║  │  3. Haversine sort    ──► ranked list   │          │ → base64 blob   │ ║
║  │                                         │          │   (to client)   │ ║
║  └─────────────────────────────────────────┘          └─────────────────┘ ║
╚════════════════════════════════════════════════════════════════════════════╝

 External data sources:
 ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐
 │ WHO      │ │ CDC      │ │ NHS      │ │ OpenFDA  │ │ PubMed   │ │ Google    │
 │ RSS feed │ │ RSS feed │ │ RSS feed │ │ Drug     │ │ esearch  │ │ Maps      │
 │ (public) │ │ (public) │ │ (public) │ │ Enforce- │ │ esummary │ │ Geocoding │
 │          │ │          │ │          │ │ ment API │ │ API      │ │ + Places  │
 └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────────┘
```

---

## MCP Tools

The server exposes six tools to Claude. Each request creates an isolated `McpServer` instance (stateless transport), so the server scales horizontally without session-affinity requirements.

### 1. `ingest_health_news`

**Category:** Write · `readOnlyHint: false`

Fetches verified health news and drug-recall alerts from WHO, CDC, NHS, and OpenFDA and stores them in PostgreSQL. Uses `ON CONFLICT DO NOTHING` on `(source, external_id)` to deduplicate across runs. Returns counts of new articles ingested and duplicates skipped.

```text
Input:  sources  string[]  — ["WHO", "CDC", "NHS", "OpenFDA"] (default: all four)
Output: { ingested: number, skipped_duplicates: number, errors?: string[] }
```

---

### 2. `search_health_content`

**Category:** Read · `readOnlyHint: true`

Full-text search across stored WHO/CDC/NHS/OpenFDA articles using PostgreSQL's `plainto_tsquery` with `ts_rank` relevance scoring, with optional live PubMed research search. Results from both sources are returned together, ranked by relevance and recency.

```text
Input:  query          string   — search keywords or medical terms
        limit          integer  — max results (1–20, default 10)
        include_pubmed boolean  — also run live PubMed search (default true)
Output: { stored_articles: Article[], pubmed_articles: Article[], total: number }
```

---

### 3. `start_symptom_check`

**Category:** Write · `readOnlyHint: false`

Creates a new symptom checker session in PostgreSQL and returns the session ID and first clinical question. Sessions persist across Claude restarts — the patient can resume by providing their session ID.

```text
Input:  (none)
Output: { session_id: UUID, step: 0, total_steps: 6, question: string }
```

---

### 4. `answer_symptom_question`

**Category:** Write · `readOnlyHint: false`

Submits an answer for the current step and advances the session. On the final step, runs the assessment engine and returns a structured diagnosis with urgency level, likely conditions, and recommended action. Steps must be answered in order; the session rejects out-of-sequence submissions.

The six steps:

| Step | Collects | Answer type |
| --- | --- | --- |
| 0 | Primary symptom | Enum (13 options) |
| 1 | Duration | Enum (5 options) |
| 2 | Severity (1–10) | Integer |
| 3 | Associated symptoms | Object `{key: boolean}` |
| 4 | Medical history | Object `{key: boolean}` |
| 5 | Emergency flags | Object `{key: boolean}` |

```text
Input:  session_id  UUID
        step        integer
        answer      string | number | {[key: string]: boolean}
Output: { done: false, step: number, question: string }
      | { done: true,  assessment: Assessment }

Assessment: {
  urgency:            "EMERGENCY" | "URGENT" | "SOON" | "ROUTINE"
  urgency_message:    string
  likely_conditions:  { condition: string, notes: string }[]
  recommended_action: string
  disclaimer:         string
}
```

---

### 5. `find_specialists`

**Category:** Read · `readOnlyHint: true`

Geocodes a location using the Google Maps Geocoding API, then searches nearby hospitals and clinics with the Places API. Results are sorted by Haversine distance and include name, address, rating, and a direct Google Maps link.

```text
Input:  location    string  — city, address, or postal code
        specialty   string  — e.g. "cardiologist", "urgent care"
        radius_km   number  — search radius in km (1–50, default 10)
Output: SpecialistResult[] — up to 10 results
```

---

### 6. `generate_medical_report`

**Category:** Read · `readOnlyHint: true` · `idempotentHint: true`

Loads a completed symptom session from PostgreSQL and generates an A4 PDF using `pdf-lib`. The report includes the urgency banner, associated symptoms, medical history, possible conditions, recommended action, and a prominent medical disclaimer. Returns the PDF as a base64-encoded blob suitable for download or printing.

```text
Input:  session_id  UUID  — must be a completed session (done: true)
Output: text message + embedded resource { mimeType: "application/pdf", blob: base64 }
```

---

## Current Limitations

These are known constraints of the current implementation, not design oversights.

**Assessment engine is rule-based.** The symptom-to-condition mapping uses deterministic rules rather than a trained model. It handles the most common patterns (chest pain, fever, headache, shortness of breath) but has limited coverage for rare presentations and cannot account for combinations across all 13 primary symptoms.

**No user identity or session continuity across devices.** Sessions are identified by a UUID held in conversation context. If a user loses their session ID, the session cannot be recovered. There is no concept of a patient record or longitudinal health history.

**Single shared database.** All users share one Neon PostgreSQL instance. There is no row-level security, tenancy, or data isolation between users. This is appropriate for the current MVP but incompatible with any regulated health data handling (HIPAA, GDPR Article 9).

**No medication or dosage guidance.** The server deliberately avoids drug recommendations. OpenFDA ingestion covers enforcement/recall data only, not prescribing information.

**Specialist results depend on Google Maps data quality.** In regions with sparse Maps coverage (parts of sub-Saharan Africa, South/Southeast Asia), results may be incomplete or inaccurate.

**English only.** All tool descriptions, question prompts, assessment text, and PDF output are in English. PubMed and WHO/CDC feeds are also English-only.

**Render free tier spins down after 15 minutes of inactivity.** The first request after a cold start may take 30–60 seconds. Not suitable for latency-sensitive production use without upgrading to a paid tier.

---

## Roadmap

### Phase 1 — Foundation Hardening *(Q3 2026)*

Addresses the core limitations required before any regulated deployment.

- **User authentication** via OAuth 2.0 (CIMD) — each user gets an isolated session namespace; session IDs are scoped to authenticated identities rather than held in conversation context
- **Row-level security** in PostgreSQL — symptom sessions are tenant-isolated; no cross-user data access is possible at the database layer
- **Structured logging and audit trail** — every tool call logged with anonymised session ID, tool name, and timestamp for compliance reporting
- **Upgrade to Render paid tier** (or migrate to Railway/Fly.io) — eliminates cold-start latency and provides SLA-backed uptime

---

### Phase 2 — Intelligence Upgrade *(Q4 2026)*

Moves the assessment engine from rules to learned representations.

- **ML-based diagnosis improvement** — train a lightweight classifier on symptom-condition pairs from anonymised session data, validated against ICD-10 categories; replace the rule engine with model inference while retaining the rule layer as a safety fallback
- **Confidence scoring** — each likely condition returned with a probability estimate and the features that drove it, making the assessment auditable
- **Differential diagnosis expansion** — extend coverage from 13 primary symptoms to the full ICD-10-CM presenting complaint taxonomy (~300 categories)
- **Medication interaction checker** — integrate OpenFDA's drug interaction endpoint to flag known interactions when the patient reports current medications

---

### Phase 3 — Global Access *(Q1 2027)*

Removes language and geography as barriers to access.

- **Multilingual support** — question prompts, assessment text, and PDF output localised into Swahili, French, Arabic, Hindi, and Portuguese (targeting the regions with the greatest unmet need); source ingestion expanded to WHO French and PAHO feeds
- **Offline-capable report generation** — PDF reports generated client-side via MCPB packaging so patients in low-connectivity environments can still receive printed documentation
- **Regional health authority feeds** — ingest from ECDC (Europe), PAHO (Americas), AFRO (Africa), and SEARO (South-East Asia) in addition to WHO/CDC/NHS

---

### Phase 4 — Care Coordination *(Q2 2027)*

Closes the loop between assessment and actual care delivery.

- **Hospital booking API integration** — connect `find_specialists` results to booking APIs (Zocdoc in the US, Babylon in the UK/Africa, custom webhooks for NGO partners) so patients can schedule an appointment directly from the assessment without leaving Claude
- **Referral letter generation** — extend `generate_medical_report` to produce a GP-formatted referral letter (structured SOAP note) in addition to the patient summary
- **Follow-up session linking** — patients can open a follow-up session that loads their prior assessment, enabling longitudinal tracking of symptom progression

---

### Phase 5 — Mobile & Distribution *(Q3 2027)*

Delivers the experience to users who don't have access to Claude desktop or Claude Code.

- **Mobile app** (React Native) — a purpose-built interface that embeds the MCP tools directly, with offline symptom collection and deferred submission when connectivity is restored; targets Android-first given the device distribution in key markets
- **Claude plugin listing** — submit to the Anthropic Connector Directory so Claude.ai users can add the server with one click, without any technical setup
- **NGO deployment kit** — packaged MCPB build + deployment guide for field health workers operating in environments without reliable internet; includes bundled question flows for the most common presentations (malaria, TB, respiratory illness, obstetric complications)
- **Telemedicine bridge** — allow a verified clinician to claim a session and add a clinical note to the PDF, creating a lightweight asynchronous consultation record

---

## Stack Summary

| Layer | Technology |
| --- | --- |
| Protocol | Model Context Protocol (Streamable HTTP transport) |
| Runtime | Node.js 20, TypeScript |
| Framework | `@modelcontextprotocol/sdk`, Express |
| Database | Neon serverless PostgreSQL |
| PDF generation | `pdf-lib` (pure Node, no headless browser) |
| Health data | WHO RSS, CDC RSS, NHS RSS, OpenFDA API, PubMed E-utilities |
| Mapping | Google Maps Geocoding API + Places API |
| Hosting | Render (web service) |
| CI/CD | GitHub → Render auto-deploy on push to `main` |

---

## Platform Compatibility

MCP is an open protocol. The server uses standard Streamable HTTP transport, so it connects to any MCP-compatible client — not just Claude.

| Platform | Type | How to connect |
| --- | --- | --- |
| **Claude Code** | CLI | `claude mcp add --transport http health-intelligence https://health-intelligence-mcp.onrender.com/mcp` |
| **Claude Desktop / claude.ai** | Desktop / Web | Settings → Connectors → Add custom connector → paste the URL |
| **OpenAI Agents SDK** | SDK | `MCPServerHTTP(url="https://health-intelligence-mcp.onrender.com/mcp")` |
| **Cursor** | IDE | Settings → MCP → add server URL |
| **Windsurf** | IDE | MCP config file → add server URL |
| **Cline** (VS Code) | Extension | MCP settings → add server URL |
| **Continue.dev** | Extension | `config.json` → `mcpServers` block |
| **Zed** | Editor | `assistant.json` → MCP server config |
| **LibreChat** | Self-hosted | `librechat.yaml` → MCP plugin config |
| **Any custom client** | Custom | `POST /mcp` with `Accept: application/json, text/event-stream` |

The tool schemas, descriptions, and behaviour are identical regardless of which model drives the calls — MCP fully abstracts the underlying AI from the server implementation.

> **Note for operators:** The server currently allows requests from `https://claude.ai` and `https://api.anthropic.com` by origin. To enable other platforms, add their origin domains to the `ALLOWED_ORIGINS` set in `src/server.ts`, or remove the origin check entirely for a fully public deployment.

---

## Contributing & Contact

This project is open source. Contributions, issue reports, and partnership enquiries are welcome.

**Repository:** [github.com/megamsquare/health-intelligence-mcp](https://github.com/megamsquare/health-intelligence-mcp)  
**Live endpoint:** `https://health-intelligence-mcp.onrender.com/mcp`  
**Add to Claude Code:** `claude mcp add --transport http health-intelligence https://health-intelligence-mcp.onrender.com/mcp`

---

*Health Intelligence MCP is an informational tool. It does not provide medical diagnoses, replace clinical examination, or constitute a regulated medical device. All assessments include a prominent disclaimer and are designed to direct users toward appropriate professional care, not away from it.*
