import { type Express } from 'express';
import multer from 'multer';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { authMiddleware } from '../middleware/auth.js';
import { ingestDocument } from '../tools/ingest-document.js';
import { generateReport } from '../tools/generate-report.js';
import { db } from '../db/client.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB cap
});

// Only browser-based web clients send an Origin header. Desktop apps and CLI
// tools (Cursor, Windsurf, Cline, Zed, Continue.dev) make direct HTTP calls
// without an Origin header and are already permitted by the `if (origin &&`
// guard in the /mcp handler — no entry needed here for those clients.
const ALLOWED_ORIGINS = new Set([
  'https://claude.ai',
  'https://api.anthropic.com',
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://platform.openai.com',
  'http://localhost:3000',
  'http://localhost:6274', // MCP Inspector
]);

export function registerAppRoutes(app: Express, createServer: () => McpServer): void {
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

      if (method === 'tools/call')        logLabel = `tool:${params?.name}`;
      else if (method === 'resources/read') logLabel = `resource:${params?.uri}`;
      else if (method === 'prompts/get')    logLabel = `prompt:${params?.name}`;
      else if (method === 'initialize')     logLabel = 'initialize';

      if (logLabel) {
        console.log(`[mcp] user=${req.user.sub} tier=${req.user.tier} ${logLabel}`);
        db.query('INSERT INTO usage_log (user_id, tool_name) VALUES ($1, $2)', [req.user.sub, logLabel]).catch(
          (err: unknown) =>
            console.error('[usage-log] insert failed:', err instanceof Error ? err.message : String(err))
        );
      }
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Tells OAuth-aware MCP clients that this server uses static Bearer tokens —
  // no authorization server exists, tokens must be provided via the Authorization header.
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    const base = process.env.MCP_SERVER_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    res.json({ resource: base, bearer_methods_supported: ['header'] });
  });

  // PDF download — generates and streams the report for a completed session.
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

  // Document upload — doctors POST a file (multipart/form-data, field name "file").
  // Auth-gated with the same Bearer token used for MCP. Supports PDF, DOCX, TXT, MD, CSV up to 20 MB.
  app.post('/upload', authMiddleware, upload.single('file'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'No file received. Send a multipart/form-data POST with a field named "file".' });
      return;
    }
    try {
      const result = await ingestDocument(req.file.buffer, req.file.originalname, req.file.mimetype);
      console.log(
        `[upload] user=${req.user?.sub} file="${req.file.originalname}" size=${req.file.size} ingested=${result.ingested}`
      );
      if (result.ingested) {
        db.query('INSERT INTO usage_log (user_id, tool_name) VALUES ($1, $2)', [
          req.user?.sub ?? 'anonymous',
          'upload:document',
        ]).catch((err: unknown) =>
          console.error('[usage-log] insert failed:', err instanceof Error ? err.message : String(err))
        );
      }
      res.json(result);
    } catch (err) {
      console.error(`[upload] error: ${err instanceof Error ? err.message : String(err)}`);
      res.status(422).json({ error: err instanceof Error ? err.message : 'Document processing failed' });
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
}
