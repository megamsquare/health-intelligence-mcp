import { createRequire } from 'node:module';
const pdfParse = createRequire(import.meta.url)('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
import mammoth from 'mammoth';

export interface ParsedDocument {
  title: string;
  text: string;
}

const SUPPORTED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
]);

export function isSupportedMimeType(mimeType: string): boolean {
  return SUPPORTED_TYPES.has(mimeType) || mimeType.startsWith('text/');
}

export async function parseDocument(buffer: Buffer, mimeType: string, filename: string): Promise<ParsedDocument> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const data = await pdfParse(buffer);
    const lines = data.text.split('\n').map((l: string) => l.trim()).filter(Boolean);
    const title = lines[0]?.slice(0, 500) || filename;
    return { title, text: data.text };
  }

  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    const lines = result.value.split('\n').map(l => l.trim()).filter(Boolean);
    const title = lines[0]?.slice(0, 500) || filename;
    return { title, text: result.value };
  }

  if (ext === 'doc') {
    throw new Error(
      'Legacy .doc format is not supported. Please save the file as .docx or .pdf and re-upload.'
    );
  }

  // Plain text, markdown, CSV, JSON, etc.
  const text = buffer.toString('utf-8');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const title = lines[0]?.slice(0, 500) || filename;
  return { title, text };
}
