import 'node:process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import express from 'express';
import { revokeRouter } from './routes/revoke.js';
import { keysRouter } from './routes/keys.js';
import { orgsRouter } from './routes/orgs.js';
import { usageRouter } from './routes/usage.js';
import { adminRouter } from './routes/admin.js';
import { registerTools } from './register/tools.js';
import { registerResources } from './register/resources.js';
import { registerPrompts } from './register/prompts.js';
import { registerAppRoutes } from './routes/app-routes.js';

function createServer(): McpServer {
  const server = new McpServer(
    { name: 'health-intelligence', version: '0.1.0' },
    {
      instructions:
        'Use ingest_health_news to populate the article database (7 sources: WHO, CDC, NHS, OpenFDA, ECDC, PAHO, AfricaCDC), then search_health_content to find articles. ' +
        'For symptom checking: ALWAYS ask the patient for their country first, then call start_symptom_check with the country param, then call answer_symptom_question for each step until done:true is returned. ' +
        'The completed assessment includes ICD-11 codes and citations from clinical bodies for each condition. ' +
        'generate_medical_report requires a completed symptom session (done:true) — it returns a download URL for a PDF that includes ICD codes and source citations. ' +
        'Always remind users that health information here is not a substitute for professional medical advice.',
    }
  );

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

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
app.use(adminRouter);

registerAppRoutes(app, createServer);

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Health Intelligence MCP server listening on port ${PORT}`);
});
