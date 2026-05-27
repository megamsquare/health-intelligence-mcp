import 'node:process';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { ingestHealthNews } from './tools/ingest-health-news.js';
import { searchHealthContent } from './tools/search-health-content.js';
import { startSymptomCheck, answerSymptomQuestion } from './tools/symptom-checker.js';
import { findNearbySpecialists } from './services/google-maps.js';
import { generateReport } from './tools/generate-report.js';
import { fetchRecentArticles } from './resources/articles.js';
import { listConditions, getConditionDetail } from './resources/conditions.js';
import { getSession } from './resources/sessions.js';
import { symptomCheckerArgs, buildSymptomCheckerPrompt } from './prompts/symptom-checker.js';
import { emergencyTriageArgs, buildEmergencyTriagePrompt } from './prompts/emergency-triage.js';
import { preAppointmentPrepArgs, buildPreAppointmentPrepPrompt } from './prompts/pre-appointment-prep.js';
import { conditionExplainerArgs, buildConditionExplainerPrompt } from './prompts/condition-explainer.js';
import { authMiddleware } from './middleware/auth.js';
import { db } from './db/client.js';
import { revokeRouter } from './routes/revoke.js';
import { keysRouter } from './routes/keys.js';
import { orgsRouter } from './routes/orgs.js';
import { usageRouter } from './routes/usage.js';

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'health-intelligence', version: '0.1.0' },
    {
      instructions:
        'Use ingest_health_news to populate the article database, then search_health_content to find articles. ' +
        'For symptom checking: call start_symptom_check, then call answer_symptom_question for each step until done:true is returned. ' +
        'generate_medical_report requires a completed symptom session (done:true). ' +
        'Always remind users that health information here is not a substitute for professional medical advice.',
    }
  );

// ── ingest_health_news ────────────────────────────────────────────────────────

server.registerTool(
  'ingest_health_news',
  {
    description:
      'Fetch and store verified health news from WHO, CDC, NHS, and/or OpenFDA drug-recall alerts. ' +
      'Call this to refresh the article database before searching. Returns counts of new and duplicate articles. ' +
      'Does NOT search symptoms or conditions — use search_health_content for that.',
    inputSchema: {
      sources: z
        .array(z.enum(['WHO', 'CDC', 'NHS', 'OpenFDA']))
        .default(['WHO', 'CDC', 'NHS', 'OpenFDA'])
        .describe('Which sources to fetch. Defaults to all four.'),
    },
    annotations: {
      title: 'Ingest Health News',
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  async ({ sources }) => {
    try {
      const result = await ingestHealthNews(sources);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ingested: result.ingested,
                skipped_duplicates: result.skipped,
                errors: result.errors.length > 0 ? result.errors : undefined,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Ingestion failed: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }
);

// ── search_health_content ─────────────────────────────────────────────────────

server.registerTool(
  'search_health_content',
  {
    description:
      'Full-text search across stored WHO/CDC/NHS/OpenFDA articles, with optional live PubMed research search. ' +
      'Returns stored articles ranked by relevance plus optional PubMed results. ' +
      'Call ingest_health_news first if stored results are empty. ' +
      'Does NOT diagnose conditions — use start_symptom_check for symptom assessment.',
    inputSchema: {
      query: z.string().describe('Search keywords or medical terms, e.g. "influenza vaccine" or "drug recall metformin"'),
      limit: z.number().int().min(1).max(20).default(10).describe('Max results per source. Hard cap: 20.'),
      include_pubmed: z
        .boolean()
        .default(true)
        .describe('Also run a live PubMed search for peer-reviewed research. Adds ~1–2 s latency.'),
    },
    annotations: {
      title: 'Search Health Content',
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ query, limit, include_pubmed }) => {
    try {
      const results = await searchHealthContent(query, limit, include_pubmed);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }
);

// ── start_symptom_check ───────────────────────────────────────────────────────

server.registerTool(
  'start_symptom_check',
  {
    description:
      'Begin a multi-step symptom assessment. Creates a new session and returns a session_id plus the first question. ' +
      'Call answer_symptom_question with the session_id and each answer to progress through all steps. ' +
      'The assessment is NOT a medical diagnosis — it is informational only.',
    inputSchema: {},
    annotations: {
      title: 'Start Symptom Check',
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  async () => {
    try {
      const result = await startSymptomCheck();
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to start session: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }
);

// ── answer_symptom_question ───────────────────────────────────────────────────

server.registerTool(
  'answer_symptom_question',
  {
    description:
      'Submit an answer for the current symptom check step. Returns the next question, or when done:true, returns the full assessment. ' +
      'Call start_symptom_check first to get a session_id. Steps must be answered in order. ' +
      'For enum/integer questions, answer is a string or number. For yes/no questions, answer is a JSON object like {"fever": true, "cough": false}.',
    inputSchema: {
      session_id: z
        .string()
        .uuid()
        .describe('Session ID returned by start_symptom_check'),
      step: z
        .number()
        .int()
        .min(0)
        .describe('Current step number (0-indexed) from the previous response'),
      answer: z
        .union([z.string(), z.number(), z.record(z.boolean())])
        .describe(
          'Answer for this step: a string for choice questions, an integer for severity, ' +
            'or an object of {key: boolean} for yes/no questions'
        ),
    },
    annotations: {
      title: 'Answer Symptom Question',
      readOnlyHint: false,
      destructiveHint: false,
    },
  },
  async ({ session_id, step, answer }) => {
    try {
      const result = await answerSymptomQuestion(session_id, step, answer);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }
);

// ── find_specialists ──────────────────────────────────────────────────────────

server.registerTool(
  'find_specialists',
  {
    description:
      'Search Google Maps for nearby hospitals, clinics, and specialist doctors by location and specialty type. ' +
      'Returns up to 10 results with name, address, rating, distance, and a Google Maps link. ' +
      'Requires a location (city, postal code, or full address) and a specialty keyword.',
    inputSchema: {
      location: z
        .string()
        .describe('Location to search near — city name, full address, or postal/zip code, e.g. "Chicago, IL" or "SW1A 1AA"'),
      specialty: z
        .string()
        .describe('Medical specialty or facility type, e.g. "cardiologist", "urgent care", "general practitioner", "dermatologist"'),
      radius_km: z
        .number()
        .min(1)
        .max(50)
        .default(10)
        .describe('Search radius in kilometres. Default 10 km.'),
    },
    annotations: {
      title: 'Find Nearby Specialists',
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  async ({ location, specialty, radius_km }) => {
    try {
      const results = await findNearbySpecialists(location, specialty, radius_km);
      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }
);

// ── generate_medical_report ───────────────────────────────────────────────────

server.registerTool(
  'generate_medical_report',
  {
    description:
      "Generate a structured PDF medical report from a completed symptom check session. " +
      "The report summarises the patient's symptoms, possible conditions, recommended actions, and a medical disclaimer — suitable to hand to a doctor. " +
      'Returns a direct download URL the user can click to save the PDF. Requires a completed session (done:true returned by answer_symptom_question).',
    inputSchema: {
      session_id: z
        .string()
        .uuid()
        .describe('Session ID from a completed symptom check (done:true must have been returned)'),
    },
    annotations: {
      title: 'Generate Medical Report',
      readOnlyHint: true,
      idempotentHint: true,
    },
  },
  async ({ session_id }) => {
    try {
      // Verify the session exists and is complete before issuing the URL.
      await generateReport(session_id);
      const base = process.env.MCP_SERVER_URL ?? 'https://health-intelligence-mcp.onrender.com';
      const downloadUrl = `${base}/reports/${session_id}.pdf`;
      return {
        content: [
          {
            type: 'text',
            text:
              `Your medical report is ready. Click the link below to download the PDF:\n\n` +
              `${downloadUrl}\n\n` +
              `Save or print this document and bring it to your doctor appointment.`,
          },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: `${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }
);

// ── resources ─────────────────────────────────────────────────────────────────

// health://articles/recent — last 50 ingested articles
server.registerResource(
  'articles-recent',
  'health://articles/recent',
  {
    title: 'Recent Health Articles',
    description: 'The 50 most recently ingested articles from WHO, CDC, NHS, and OpenFDA.',
    mimeType: 'application/json',
  },
  async (_uri) => {
    const articles = await fetchRecentArticles();
    return {
      contents: [{ uri: 'health://articles/recent', mimeType: 'application/json', text: JSON.stringify(articles, null, 2) }],
    };
  }
);

// health://conditions/list — distinct condition names seen across all sessions
server.registerResource(
  'conditions-list',
  'health://conditions/list',
  {
    title: 'Conditions List',
    description: 'Distinct medical condition names that have appeared in completed symptom-check assessments, with session counts.',
    mimeType: 'application/json',
  },
  async (_uri) => {
    const conditions = await listConditions();
    return {
      contents: [{ uri: 'health://conditions/list', mimeType: 'application/json', text: JSON.stringify(conditions, null, 2) }],
    };
  }
);

// health://conditions/{name} — detail for one condition
server.registerResource(
  'conditions-detail',
  new ResourceTemplate('health://conditions/{name}', { list: undefined }),
  {
    title: 'Condition Detail',
    description: 'Sessions and related articles for a named condition. Use the exact name from health://conditions/list.',
    mimeType: 'application/json',
  },
  async (uri, { name }) => {
    const detail = await getConditionDetail(decodeURIComponent(String(name)));
    return {
      contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(detail, null, 2) }],
    };
  }
);

// health://session/{session_id} — full symptom session with reconstructed Q&A turns
server.registerResource(
  'session-detail',
  new ResourceTemplate('health://session/{session_id}', { list: undefined }),
  {
    title: 'Symptom Session',
    description: 'Full session record: all question/answer turns and the final assessment.',
    mimeType: 'application/json',
  },
  async (uri, { session_id }) => {
    const session = await getSession(String(session_id));
    if (!session) {
      return {
        contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify({ error: `Session "${session_id}" not found` }) }],
      };
    }
    return {
      contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(session, null, 2) }],
    };
  }
);

// ── prompts ───────────────────────────────────────────────────────────────────

server.registerPrompt(
  'symptom-checker',
  {
    title: 'Guided Symptom Checker',
    description:
      'Opens a structured, one-question-at-a-time symptom assessment with a medical disclaimer. ' +
      'Choose "standard" for a full 6-step clinical history or "fast-track" for a 3-question triage.',
    argsSchema: symptomCheckerArgs,
  },
  ({ language, urgency }) => buildSymptomCheckerPrompt({ language, urgency })
);

server.registerPrompt(
  'emergency-triage',
  {
    title: 'Emergency Triage',
    description:
      'Fast-path prompt for urgent or potentially life-threatening symptoms. ' +
      'Returns immediate first-aid steps, red flags for calling emergency services, and guidance on finding the nearest appropriate facility.',
    argsSchema: emergencyTriageArgs,
  },
  ({ symptoms }) => buildEmergencyTriagePrompt({ symptoms })
);

server.registerPrompt(
  'pre-appointment-prep',
  {
    title: 'Pre-Appointment Preparation',
    description:
      'Generates a structured checklist to help a patient prepare for a doctor visit: questions to ask, symptoms to track, medications to list, records to bring, and lifestyle context to share. ' +
      'Optionally accepts a completed symptom-check session_id to personalise the output with recorded patient history.',
    argsSchema: preAppointmentPrepArgs,
  },
  ({ condition, session_id }) => buildPreAppointmentPrepPrompt({ condition, session_id })
);

server.registerPrompt(
  'condition-explainer',
  {
    title: 'Condition Explainer',
    description:
      'Plain-language explanation of a medical condition tailored to the intended audience: ' +
      '"patient" (reassuring, jargon-free), "caregiver" (practical support guidance), ' +
      '"child" (simple words and analogies), or "medical student" (clinical depth with pathophysiology).',
    argsSchema: conditionExplainerArgs,
  },
  ({ condition, audience }) => buildConditionExplainerPrompt({ condition, audience })
);

  return server;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// HTTP request logger — logs every request with method, path, status, and latency.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    console.log(`[http] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

app.use(revokeRouter);
app.use(keysRouter);
app.use(orgsRouter);
app.use(usageRouter);

// Origin allowlist — DNS-rebinding prevention (MCP spec MUST requirement).
//
// Only browser-based web clients send an Origin header. Desktop apps and CLI
// tools (Cursor, Windsurf, Cline, Zed, Continue.dev, OpenAI Agents SDK) make
// direct HTTP calls without an Origin header and are already permitted by the
// `if (origin &&` guard below — no entry needed here for those clients.
const ALLOWED_ORIGINS = new Set([
  // Anthropic
  'https://claude.ai',
  'https://api.anthropic.com',

  // OpenAI (ChatGPT web + platform playground)
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://platform.openai.com',

  // Local development
  'http://localhost:3000',
  'http://localhost:6274', // MCP Inspector
]);

app.post('/mcp', authMiddleware, async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  if (req.user) {
    const method = req.body?.method as string | undefined;
    const params = req.body?.params as Record<string, unknown> | undefined;
    let logLabel: string | undefined;

    if (method === 'tools/call')     logLabel = `tool:${params?.name}`;
    else if (method === 'resources/read')  logLabel = `resource:${params?.uri}`;
    else if (method === 'prompts/get')     logLabel = `prompt:${params?.name}`;
    else if (method === 'initialize')      logLabel = 'initialize';

    if (logLabel) {
      console.log(`[mcp] user=${req.user.sub} tier=${req.user.tier} ${logLabel}`);
      db.query('INSERT INTO usage_log (user_id, tool_name) VALUES ($1, $2)', [req.user.sub, logLabel])
        .catch((err: unknown) => console.error('[usage-log] insert failed:', err instanceof Error ? err.message : String(err)));
    }
  }

  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Tells OAuth-aware MCP clients (e.g. MCP Inspector) that this server uses
// static Bearer tokens — no authorization server exists, tokens must be
// provided directly via the Authorization header.
app.get('/.well-known/oauth-protected-resource', (_req, res) => {
  const base = process.env.MCP_SERVER_URL ?? `http://localhost:${PORT}`;
  res.json({
    resource: base,
    bearer_methods_supported: ['header'],
  });
});

// PDF download endpoint — generates and streams the report for a completed session.
// Session IDs are 128-bit UUIDs, making them effectively unguessable without auth.
app.get('/reports/:session_id.pdf', async (req, res) => {
  try {
    const pdfBase64 = await generateReport(req.params.session_id);
    const pdfBytes = Buffer.from(pdfBase64, 'base64');
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="health-report-${req.params.session_id.slice(0, 8)}.pdf"`,
      'Content-Length': String(pdfBytes.length),
    });
    res.send(pdfBytes);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Report not found' });
  }
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'health-intelligence-mcp',
    version: '0.1.0',
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV ?? 'production',
    timestamp: new Date().toISOString(),
  });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Health Intelligence MCP server listening on port ${PORT}`);
});
