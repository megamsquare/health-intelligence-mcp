import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import type { Assessment } from '../symptom/assessment.js';

export interface ReportData {
  session_id: string;
  created_at: string;
  answers: {
    primary_symptom: string;
    duration: string;
    severity: number;
    associated_symptoms: Record<string, boolean>;
    medical_history: Record<string, boolean>;
    emergency_flags: Record<string, boolean>;
  };
  assessment: Assessment;
}

const MARGIN = 50;

export async function generateMedicalReport(data: ReportData): Promise<string> {
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const blue = rgb(0.12, 0.29, 0.59);
  const black = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.45, 0.45, 0.45);
  const white = rgb(1, 1, 1);
  const urgencyColor = {
    EMERGENCY: rgb(0.78, 0.1, 0.1),
    URGENT: rgb(0.85, 0.45, 0.05),
    SOON: rgb(0.85, 0.45, 0.05),
    ROUTINE: rgb(0.1, 0.55, 0.2),
  }[data.assessment.urgency];

  // Header bar
  page.drawRectangle({ x: 0, y: height - 72, width, height: 72, color: blue });
  page.drawText('HEALTH INTELLIGENCE MCP', {
    x: MARGIN, y: height - 32, font: bold, size: 18, color: white,
  });
  page.drawText('Symptom Assessment Report — Bring this document to your doctor', {
    x: MARGIN, y: height - 50, font: regular, size: 10, color: rgb(0.8, 0.9, 1),
  });
  page.drawText(
    `Generated: ${new Date(data.created_at).toLocaleDateString('en-US', { dateStyle: 'long' })}  ·  Session: ${data.session_id}`,
    { x: MARGIN, y: height - 65, font: regular, size: 8, color: rgb(0.65, 0.78, 0.92) }
  );

  let y = height - 82;

  // Disclaimer strip
  page.drawRectangle({ x: MARGIN, y: y - 22, width: width - MARGIN * 2, height: 22, color: rgb(1, 0.95, 0.85) });
  page.drawText(
    'FOR INFORMATIONAL PURPOSES ONLY — NOT A MEDICAL DIAGNOSIS — SEE DISCLAIMER BELOW',
    { x: MARGIN + 6, y: y - 14, font: bold, size: 7.5, color: rgb(0.7, 0.35, 0) }
  );
  y -= 34;

  // Urgency banner
  page.drawRectangle({ x: MARGIN, y: y - 30, width: width - MARGIN * 2, height: 30, color: urgencyColor });
  page.drawText(`${data.assessment.urgency}:  ${data.assessment.urgency_message}`, {
    x: MARGIN + 10, y: y - 20, font: bold, size: 13, color: white,
  });
  y -= 46;

  // Primary complaint
  y = drawSection(page, bold, 'PRIMARY COMPLAINT', y, blue, width);
  y = drawLine(page, regular, `${data.answers.primary_symptom}`, MARGIN + 4, y, 11, black);
  y = drawLine(page, regular, `Duration: ${data.answers.duration}  ·  Severity: ${data.answers.severity}/10`, MARGIN + 4, y, 10, muted);
  y -= 8;

  // Associated symptoms
  const assocYes = Object.entries(data.answers.associated_symptoms)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '));
  y = drawSection(page, bold, 'ASSOCIATED SYMPTOMS', y, blue, width);
  y = drawWrapped(page, regular, assocYes.length > 0 ? assocYes.join(', ') : 'None reported', MARGIN + 4, y, 10, black, width - MARGIN * 2 - 8);
  y -= 8;

  // Medical history
  const histYes = Object.entries(data.answers.medical_history)
    .filter(([, v]) => v)
    .map(([k]) => k.replace(/_/g, ' '));
  y = drawSection(page, bold, 'MEDICAL HISTORY', y, blue, width);
  y = drawWrapped(page, regular, histYes.length > 0 ? histYes.join(', ') : 'None reported', MARGIN + 4, y, 10, black, width - MARGIN * 2 - 8);
  y -= 8;

  // Possible conditions
  y = drawSection(page, bold, 'POSSIBLE CONDITIONS', y, blue, width);
  for (const c of data.assessment.likely_conditions) {
    y = drawLine(page, bold, `•  ${c.condition}`, MARGIN + 4, y, 10, black);
    if (c.notes) {
      y = drawWrapped(page, regular, c.notes, MARGIN + 14, y, 9, muted, width - MARGIN * 2 - 18);
    }
    y -= 4;
  }
  y -= 4;

  // Recommended action
  y = drawSection(page, bold, 'RECOMMENDED ACTION', y, blue, width);
  y = drawWrapped(page, regular, data.assessment.recommended_action, MARGIN + 4, y, 10, black, width - MARGIN * 2 - 8);
  y -= 20;

  // Footer disclaimer
  page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.5, color: muted });
  y -= 14;
  y = drawLine(page, bold, 'IMPORTANT DISCLAIMER', MARGIN, y, 8, muted);
  drawWrapped(page, regular, data.assessment.disclaimer, MARGIN, y, 7.5, muted, width - MARGIN * 2);

  const bytes = await doc.save();
  return Buffer.from(bytes).toString('base64');
}

function drawSection(page: PDFPage, font: PDFFont, text: string, y: number, color: ReturnType<typeof rgb>, pageWidth: number): number {
  page.drawText(text, { x: MARGIN, y, font, size: 9, color });
  page.drawLine({ start: { x: MARGIN, y: y - 3 }, end: { x: pageWidth - MARGIN, y: y - 3 }, thickness: 0.4, color });
  return y - 16;
}

function drawLine(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, color: ReturnType<typeof rgb>): number {
  page.drawText(text, { x, y, font, size, color });
  return y - size - 4;
}

function drawWrapped(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size: number, color: ReturnType<typeof rgb>, maxWidth: number): number {
  const words = text.split(' ');
  let currentLine = '';
  let currentY = y;

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(testLine, size) > maxWidth && currentLine) {
      page.drawText(currentLine, { x, y: currentY, font, size, color });
      currentY -= size + 4;
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    page.drawText(currentLine, { x, y: currentY, font, size, color });
    currentY -= size + 4;
  }
  return currentY;
}
