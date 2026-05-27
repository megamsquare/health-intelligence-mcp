import { createHash } from 'node:crypto';
import { db } from '../db/client.js';
import { parseDocument } from '../services/document-parser.js';

export interface IngestDocumentResult {
  ingested: boolean;
  skipped: boolean;
  article_id?: string;
  title: string;
  characters_extracted: number;
}

export async function ingestDocument(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<IngestDocumentResult> {
  const { title, text } = await parseDocument(buffer, mimeType, filename);

  const externalId = createHash('sha256').update(buffer).digest('hex');
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'file';
  const tags = ['doctor-upload', ext];

  const result = await db.query<{ id: string }>(
    `INSERT INTO health_articles (source, external_id, title, summary, tags)
     VALUES ('Upload', $1, $2, $3, $4)
     ON CONFLICT (source, external_id) DO NOTHING
     RETURNING id`,
    [externalId, title, text, tags]
  );

  if (result.rows.length === 0) {
    return { ingested: false, skipped: true, title, characters_extracted: text.length };
  }

  return {
    ingested: true,
    skipped: false,
    article_id: result.rows[0].id,
    title,
    characters_extracted: text.length,
  };
}
