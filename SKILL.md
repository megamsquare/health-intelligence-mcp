# Skill: Health Intelligence MCP

## When to use this skill

Use this skill whenever a user wants to:
- Search for health news, disease outbreaks, or drug recalls
- Check symptoms or get an urgency assessment
- Find nearby doctors, hospitals, or clinics
- Generate a PDF medical report to bring to a doctor
- Upload a medical document to make it searchable
- Ask about a specific medical condition

**Server endpoint:** `https://health-intelligence-mcp.onrender.com/mcp`
**Auth required:** `Authorization: Bearer <MCP_TOKEN>` on every call. If the user has no token, direct them to register at mmolayemi.com/register (free, permanent).

---

## Tools reference

### 1. `ingest_health_news`
Fetches and stores articles from health authority feeds. Always call this before searching if the user wants fresh data.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `sources` | `string[]` | all 7 | `WHO`, `CDC`, `NHS`, `OpenFDA`, `ECDC`, `PAHO`, `AfricaCDC` |

**Returns:** `{ ingested: number, skipped_duplicates: number }`

**When to call:** At the start of any health research session, or when the user asks for "latest" news. Safe to call repeatedly — duplicates are ignored.

---

### 2. `ingest_document`
Uploads a medical document so its contents become searchable and usable as citation sources in symptom assessments.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `content_base64` | `string` | Yes | File encoded as base64. Max 20 MB |
| `filename` | `string` | Yes | Include the extension, e.g. `guidelines-2024.pdf` |
| `mime_type` | `string` | No | Inferred from filename if omitted |

**Supported formats:** PDF, DOCX, TXT, MD, CSV, JSON

**Returns:** `{ status: "ingested" \| "duplicate", sha256: string, chunks: number }`

**When to call:** When a user wants to upload their own medical documents (lab results, treatment guidelines, clinical notes).

---

### 3. `search_health_content`
Full-text search across stored articles, ranked by relevance. Optionally runs a live PubMed search in parallel.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `query` | `string` | — | Keywords or medical terms |
| `limit` | `integer` | `10` | Max results per source. Range: 1–20 |
| `include_pubmed` | `boolean` | `true` | Adds ~1–2 s but returns peer-reviewed research |

**Returns:** `{ stored_articles: [...], pubmed_articles: [...], total: number }`

**When to call:** After `ingest_health_news`, or any time the user asks about a condition, drug, or health topic. Do NOT use for symptom checking — use `start_symptom_check` instead.

---

### 4. `start_symptom_check`
Creates a new symptom session and returns the first clinical question.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `country` | `string` | Recommended | e.g. `"Nigeria"`, `"India"`, `"Brazil"`. Enables region-specific conditions (malaria, dengue, typhoid, etc.) |

**Returns:** `{ session_id: string, step: 0, total_steps: 6, question: string }`

**Critical:** Always ask the user for their country BEFORE calling this tool. Never skip it — it directly affects which conditions appear in the assessment.

---

### 5. `answer_symptom_question`
Submits the answer for the current step. Call this repeatedly until `done: true` is returned.

| Parameter | Type | Notes |
|---|---|---|
| `session_id` | `string (UUID)` | From `start_symptom_check` |
| `step` | `integer` | Current step number from the previous response (0-indexed) |
| `answer` | `string \| number \| {[key]: boolean}` | Format depends on the step (see below) |

**Answer format by step:**

| Step | Question | Answer type | Example |
|---|---|---|---|
| 0 | Primary symptom | `string` | `"Fever"` |
| 1 | Duration | `string` | `"1-3 days"` |
| 2 | Severity (1–10) | `number` | `7` |
| 3 | Associated symptoms | `{key: boolean}` | `{"cough": true, "fatigue": true, "nausea": false}` |
| 4 | Medical history | `{key: boolean}` | `{"diabetes": false, "heart_disease": false}` |
| 5 | Emergency flags | `{key: boolean}` | `{"crushing_chest_pain": false, "difficulty_breathing": false}` |

**Mid-flow response:** `{ done: false, step: number, total_steps: 6, question: string }`

**Final response (step 5):** `{ done: true, session_id: string, assessment: { urgency, urgency_message, likely_conditions, recommended_action, disclaimer } }`

**Urgency levels:** `EMERGENCY` → `URGENT` → `SOON` → `ROUTINE`

---

### 6. `find_specialists`
Finds nearby hospitals, clinics, and specialist doctors using Google Maps.

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `location` | `string` | — | City, address, or postcode. e.g. `"Lagos, Nigeria"` or `"SW1A 1AA"` |
| `specialty` | `string` | — | e.g. `"cardiologist"`, `"urgent care"`, `"general practitioner"` |
| `radius_km` | `number` | `10` | Search radius. Range: 1–50 km |

**Returns:** Up to 10 results with name, address, rating, distance, and a Google Maps link.

**When to call:** After a symptom assessment (especially URGENT or EMERGENCY), or when the user explicitly asks to find a doctor.

---

### 7. `generate_medical_report`
Generates a PDF medical report from a completed symptom session. Returns a download URL.

| Parameter | Type | Notes |
|---|---|---|
| `session_id` | `string (UUID)` | Must be a completed session (`done: true` already returned) |

**Returns:** A direct download URL for the PDF. Tell the user to click the link and save the PDF to bring to their doctor.

**Critical:** Only call this after `answer_symptom_question` has returned `done: true`. Calling it on an incomplete session will error.

---

## Resources (read directly into context)

| URI | What it contains |
|---|---|
| `health://articles/recent` | The 50 most recently ingested articles across all sources |
| `health://conditions/list` | All condition names seen in completed assessments |
| `health://conditions/{name}` | Sessions and articles for a specific condition (use exact name from list) |
| `health://session/{session_id}` | Full Q&A transcript and assessment for a session |

Read these resources to give Claude richer context before responding, especially for condition-specific questions.

---

## Prompts

| Name | When to use |
|---|---|
| `symptom-checker` | Open a guided symptom check. Args: `language`, `urgency` (`standard` or `fast-track`) |
| `emergency-triage` | User reports urgent or potentially life-threatening symptoms. Args: `symptoms`, `country` |
| `pre-appointment-prep` | User has an upcoming doctor visit. Args: `condition`, `session_id` (optional) |
| `condition-explainer` | User wants to understand a condition. Args: `condition`, `audience` (`patient`, `caregiver`, `clinician`) |

---

## Workflows

### Health research

```
1. ingest_health_news (all sources or targeted subset)
2. search_health_content(query, include_pubmed=true)
3. Summarise findings. Cite sources. Always add: "Consult a healthcare professional for personal advice."
```

### Symptom check (standard flow)

```
1. Ask: "What country are you in?"
2. start_symptom_check(country)
3. Present question to user, collect answer
4. answer_symptom_question(session_id, step=0, answer)
5. Repeat step 3–4 for steps 1, 2, 3, 4, 5
6. When done:true → present urgency + likely conditions + recommended action
7. If urgency is URGENT or EMERGENCY → offer find_specialists
8. Offer generate_medical_report so they can bring the PDF to a doctor
```

### Drug recall / safety alert check

```
1. ingest_health_news(sources=["OpenFDA"])
2. search_health_content(query="<drug name> recall", include_pubmed=false)
3. Present results with source and date. Note if no recalls found.
```

### Find a doctor after assessment

```
1. Confirm location with user ("What city or postcode are you near?")
2. Determine appropriate specialty from assessment urgency:
   - EMERGENCY → "emergency room" or "A&E"
   - URGENT    → "urgent care" or relevant specialist
   - SOON      → specialist matching likely condition
   - ROUTINE   → "general practitioner"
3. find_specialists(location, specialty, radius_km=10)
4. Present results sorted by distance. Include rating and Maps link.
```

### Upload and search a custom document

```
1. Receive file from user (read as base64)
2. ingest_document(content_base64, filename, mime_type)
3. If status="ingested" → confirm upload, then search_health_content to verify it appears
4. If status="duplicate" → tell user the file was already uploaded
```

---

## Edge cases and error handling

**Server cold start (Render free tier)**
The server may take 30–60 seconds to respond on the first call after inactivity. If the call times out, wait and retry. Do not retry immediately in a loop.

**`stored_articles` is empty after search**
The database has no articles yet. Call `ingest_health_news` first, then retry the search.

**`answer_symptom_question` returns an error about step order**
Steps must be answered sequentially (0 → 1 → 2 → 3 → 4 → 5). If the session state is lost, start a new session with `start_symptom_check`.

**`generate_medical_report` errors with "session not complete"**
`done: true` must have been returned by `answer_symptom_question`. Do not call `generate_medical_report` mid-flow.

**`find_specialists` — "Could not geocode" error**
The location string was too vague. Ask the user for a more specific address:
- Too vague: `"Lagos"`
- Correct: `"Lagos, Nigeria"` or `"Victoria Island, Lagos, Nigeria"`

**`ingest_document` — "File exceeds 20 MB limit"**
Ask the user to split the document or compress it before uploading.

**`usage-log insert failed` in server logs**
Non-fatal. This is the usage counter failing to write to the database (usually a Neon cold-start issue). The tool response is still valid — ignore this log line.

---

## Output formatting rules

- **Always include a disclaimer** on any symptom assessment output: *"This assessment is for informational purposes only and does not constitute a medical diagnosis. Consult a qualified healthcare professional."*
- **Urgency colour coding** (if rendering supports it): EMERGENCY = red, URGENT = orange, SOON = yellow, ROUTINE = green
- **Cite sources** when presenting search results: include `source`, `title`, and `url`
- **Session IDs** are UUIDs — display them in a monospace font so users can copy them accurately
- **Report download links** — present as a clickable link with clear instruction to save and bring to their doctor
- **Never present likely conditions as a diagnosis** — always frame as "possible conditions based on reported symptoms"
- **ICD-11 codes** — include them when present in the assessment; they help the doctor quickly understand the assessment context
