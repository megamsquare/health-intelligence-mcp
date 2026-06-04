import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchRecentArticles } from '../resources/articles.js';
import { listConditions, getConditionDetail } from '../resources/conditions.js';
import { getSession } from '../resources/sessions.js';

export function registerResources(server: McpServer): void {
  // health://articles/recent — last 50 ingested articles
  server.registerResource(
    'articles-recent',
    'health://articles/recent',
    {
      title: 'Recent Health Articles',
      description:
        'The 50 most recently ingested articles from WHO, CDC, NHS, OpenFDA, ECDC, PAHO, Africa CDC, and doctor-uploaded documents. ' +
        'Source field is one of: WHO | CDC | NHS | OpenFDA | ECDC | PAHO | AfricaCDC | Upload.',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const articles = await fetchRecentArticles();
      return {
        contents: [
          { uri: 'health://articles/recent', mimeType: 'application/json', text: JSON.stringify(articles, null, 2) },
        ],
      };
    }
  );

  // health://conditions/list — distinct condition names seen across all sessions
  server.registerResource(
    'conditions-list',
    'health://conditions/list',
    {
      title: 'Conditions List',
      description:
        'Distinct medical condition names that have appeared in completed symptom-check assessments, with session counts.',
      mimeType: 'application/json',
    },
    async (_uri) => {
      const conditions = await listConditions();
      return {
        contents: [
          { uri: 'health://conditions/list', mimeType: 'application/json', text: JSON.stringify(conditions, null, 2) },
        ],
      };
    }
  );

  // health://conditions/{name} — detail for one condition
  server.registerResource(
    'conditions-detail',
    new ResourceTemplate('health://conditions/{name}', { list: undefined }),
    {
      title: 'Condition Detail',
      description:
        'Sessions and related articles for a named condition. Each session entry includes the ICD-11 code and clinical bodies cited ' +
        '(WHO, CDC, NHS, ECDC, PAHO, Africa CDC) for that condition. Use the exact name from health://conditions/list.',
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
      description:
        'Full session record: all question/answer turns and the final assessment. ' +
        'The assessment includes urgency level, likely conditions with ICD-11 codes, ' +
        'citations from WHO/CDC/NHS/ECDC/PAHO/AfricaCDC, and recommended action.',
      mimeType: 'application/json',
    },
    async (uri, { session_id }) => {
      const session = await getSession(String(session_id));
      if (!session) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Session "${session_id}" not found` }),
            },
          ],
        };
      }
      return {
        contents: [{ uri: uri.toString(), mimeType: 'application/json', text: JSON.stringify(session, null, 2) }],
      };
    }
  );
}
