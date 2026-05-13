import 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { ingestHealthNews } from './tools/ingest-health-news.js';
import { searchHealthContent } from './tools/search-health-content.js';
import { startSymptomCheck, answerSymptomQuestion } from './tools/symptom-checker.js';
import { findNearbySpecialists } from './services/google-maps.js';
import { generateReport } from './tools/generate-report.js';

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
      'Returns the PDF as a base64-encoded blob. Requires a completed session (done:true returned by answer_symptom_question).',
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
      const pdfBase64 = await generateReport(session_id);
      return {
        content: [
          {
            type: 'text',
            text: `Medical report generated for session ${session_id}. The PDF is attached below.`,
          },
          {
            type: 'resource',
            resource: {
              uri: `health-report://${session_id}.pdf`,
              mimeType: 'application/pdf',
              blob: pdfBase64,
            },
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

// ── HTTP server ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Allowed origins for DNS-rebinding prevention (spec MUST requirement)
const ALLOWED_ORIGINS = new Set([
  'https://claude.ai',
  'https://api.anthropic.com',
  'http://localhost:3000',
  'http://localhost:6274', // MCP Inspector
]);

app.post('/mcp', async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'health-intelligence-mcp', version: '0.1.0' });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Health Intelligence MCP server listening on port ${PORT}`);
});
