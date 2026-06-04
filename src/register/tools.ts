import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ingestHealthNews } from '../tools/ingest-health-news.js';
import { ingestDocument } from '../tools/ingest-document.js';
import { searchHealthContent } from '../tools/search-health-content.js';
import { startSymptomCheck, answerSymptomQuestion } from '../tools/symptom-checker.js';
import { findNearbySpecialists } from '../services/google-maps.js';
import { generateReport } from '../tools/generate-report.js';

export function registerTools(server: McpServer): void {
  // ── ingest_health_news ──────────────────────────────────────────────────────

  server.registerTool(
    'ingest_health_news',
    {
      description:
        'Fetch and store verified health news from WHO, CDC, NHS, OpenFDA, ECDC, PAHO, and Africa CDC. ' +
        'Call this to refresh the article database before searching. Returns counts of new and duplicate articles. ' +
        'Does NOT search symptoms or conditions — use search_health_content for that.',
      inputSchema: {
        sources: z
          .array(z.enum(['WHO', 'CDC', 'NHS', 'OpenFDA', 'ECDC', 'PAHO', 'AfricaCDC']))
          .default(['WHO', 'CDC', 'NHS', 'OpenFDA', 'ECDC', 'PAHO', 'AfricaCDC'])
          .describe('Which sources to fetch. Defaults to all seven.'),
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

  // ── ingest_document ─────────────────────────────────────────────────────────

  server.registerTool(
    'ingest_document',
    {
      description:
        'Upload a medical document (PDF, DOCX, TXT, Markdown, CSV) to make its contents searchable and available for assessment enrichment. ' +
        'Accepts the file as a base64-encoded string. Duplicate uploads of the same file are silently ignored (SHA-256 dedup). ' +
        'Once ingested, the document text is indexed by FTS and can be returned as a citation source in symptom assessments. ' +
        'Supported formats: PDF, DOCX, TXT, MD, CSV, JSON. Maximum file size: 20 MB.',
      inputSchema: {
        content_base64: z.string().describe('Base64-encoded file content'),
        filename: z
          .string()
          .describe('Original filename including extension, e.g. "malaria-treatment-guidelines-2024.pdf"'),
        mime_type: z
          .string()
          .optional()
          .describe(
            'MIME type of the file, e.g. "application/pdf". Inferred from filename if omitted.'
          ),
      },
      annotations: {
        title: 'Ingest Medical Document',
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ content_base64, filename, mime_type }) => {
      try {
        const buffer = Buffer.from(content_base64, 'base64');
        if (buffer.length > 20 * 1024 * 1024) {
          return { isError: true, content: [{ type: 'text', text: 'File exceeds 20 MB limit.' }] };
        }
        const result = await ingestDocument(buffer, filename, mime_type ?? 'application/octet-stream');
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Document ingestion failed: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // ── search_health_content ───────────────────────────────────────────────────

  server.registerTool(
    'search_health_content',
    {
      description:
        'Full-text search across stored articles from WHO, CDC, NHS, OpenFDA, ECDC, PAHO, and Africa CDC, with optional live PubMed research search. ' +
        'Returns stored articles ranked by relevance plus optional PubMed results. ' +
        'Call ingest_health_news first if stored results are empty. ' +
        'Does NOT diagnose conditions — use start_symptom_check for symptom assessment.',
      inputSchema: {
        query: z
          .string()
          .describe('Search keywords or medical terms, e.g. "influenza vaccine" or "drug recall metformin"'),
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

  // ── start_symptom_check ─────────────────────────────────────────────────────

  server.registerTool(
    'start_symptom_check',
    {
      description:
        'Begin a multi-step symptom assessment. Creates a new session and returns a session_id plus the first question. ' +
        'Always ask the user for their country before calling this tool — it enables region-specific conditions ' +
        'such as malaria (Nigeria, Ghana, Kenya…), dengue (Brazil, India, Philippines…), and typhoid to appear in the assessment. ' +
        'Call answer_symptom_question with the session_id and each answer to progress through all steps. ' +
        'The assessment is NOT a medical diagnosis — it is informational only.',
      inputSchema: {
        country: z
          .string()
          .optional()
          .describe(
            'Country or region the patient is in, e.g. "Nigeria", "India", "Brazil". Enables region-specific conditions in the assessment.'
          ),
      },
      annotations: {
        title: 'Start Symptom Check',
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async ({ country }) => {
      try {
        const result = await startSymptomCheck(country);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to start session: ${err instanceof Error ? err.message : String(err)}` }],
        };
      }
    }
  );

  // ── answer_symptom_question ─────────────────────────────────────────────────

  server.registerTool(
    'answer_symptom_question',
    {
      description:
        'Submit an answer for the current symptom check step. Returns the next question, or when done:true, returns the full assessment. ' +
        'Call start_symptom_check first to get a session_id. Steps must be answered in order. ' +
        'For enum/integer questions, answer is a string or number. For yes/no questions, answer is a JSON object like {"fever": true, "cough": false}.',
      inputSchema: {
        session_id: z.string().uuid().describe('Session ID returned by start_symptom_check'),
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

  // ── find_specialists ────────────────────────────────────────────────────────

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
          .describe(
            'Location to search near — city name, full address, or postal/zip code, e.g. "Chicago, IL" or "SW1A 1AA"'
          ),
        specialty: z
          .string()
          .describe(
            'Medical specialty or facility type, e.g. "cardiologist", "urgent care", "general practitioner", "dermatologist"'
          ),
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

  // ── generate_medical_report ─────────────────────────────────────────────────

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
}
