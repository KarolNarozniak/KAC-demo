import { randomUUID } from 'node:crypto';
import type { FunctionTool, ResponseInputItem, Response as OpenAIResponse } from 'openai/resources/responses/responses.js';
import type { ImportSource } from '../import/session.js';
import type { ImportRow } from '../import/rules.js';
import type { FoundryResponsesProvider } from './foundry.js';
import { importInstructions, KAC_ASSISTANT_INSTRUCTIONS } from './prompts.js';

export type AiFile = { fileName: string; mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; bytes: Buffer };
export type ExtractedImportRow = Omit<ImportRow, 'id' | 'category'> & { eventType: 'event' | 'off_day' | 'break' | 'header' };
export type AiExtractResult = { rows: ImportRow[]; usage: { inputTokens: number; outputTokens: number }; responseId: string };
export class AiInvalidOutputError extends Error {}

const extractionSchema = {
  type: 'object', additionalProperties: false, required: ['rows'],
  properties: {
    rows: { type: 'array', maxItems: 300, items: { type: 'object', additionalProperties: false,
      required: ['eventType', 'title', 'date', 'startTime', 'endTime', 'location', 'employee', 'confidence', 'sourcePage', 'sourceSnippet', 'unresolvedFields'],
      properties: {
        eventType: { type: 'string', enum: ['event', 'off_day', 'break', 'header'] },
        title: { type: 'string' }, date: { type: ['string', 'null'] }, startTime: { type: ['string', 'null'] }, endTime: { type: ['string', 'null'] },
        location: { type: ['string', 'null'] }, employee: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        sourcePage: { type: ['integer', 'null'] }, sourceSnippet: { type: ['string', 'null'] }, unresolvedFields: { type: 'array', items: { type: 'string' }, maxItems: 20 },
      },
    } },
  },
} as const;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export class AiService {
  constructor(private readonly foundry: FoundryResponsesProvider) {}

  async extractSchedule(file: AiFile, source: Extract<ImportSource, 'classes' | 'work'>, userName: string): Promise<AiExtractResult> {
    const input: ResponseInputItem[] = [{ type: 'message', role: 'user', content: [
      { type: 'input_text', text: importInstructions(source, userName) },
      ...(file.mimeType === 'application/pdf'
        ? [{ type: 'input_file' as const, filename: file.fileName, file_data: file.bytes.toString('base64'), detail: 'high' as const }]
        : [{ type: 'input_image' as const, image_url: `data:${file.mimeType};base64,${file.bytes.toString('base64')}`, detail: 'high' as const }]),
    ] }];
    const response = await this.foundry.respond({
      store: false,
      instructions: importInstructions(source, userName),
      input,
      text: { format: { type: 'json_schema', name: 'kac_schedule_import', strict: true, schema: extractionSchema } },
      max_output_tokens: 8000,
    });
      let payload: { rows: ExtractedImportRow[] };
      try { payload = JSON.parse(response.output_text) as { rows: ExtractedImportRow[] }; }
      catch { throw new AiInvalidOutputError('invalid_ai_output_json'); }
      if (!payload || !Array.isArray(payload.rows) || payload.rows.length > 300) throw new AiInvalidOutputError('invalid_ai_output_schema');
      const rows = payload.rows.filter((row) => row && row.eventType === 'event').map((raw): ImportRow => {
        const row = raw as ExtractedImportRow;
        const date = typeof row.date === 'string' && datePattern.test(row.date) ? row.date : '';
        const startTime = typeof row.startTime === 'string' && timePattern.test(row.startTime) ? row.startTime : '';
        const endTime = typeof row.endTime === 'string' && timePattern.test(row.endTime) ? row.endTime : '';
        const unresolved = new Set(Array.isArray(row.unresolvedFields) ? row.unresolvedFields.filter((field): field is string => typeof field === 'string' && field.length <= 80) : []);
        if (!date) unresolved.add('date');
        if (!startTime) unresolved.add('startTime');
        if (!endTime) unresolved.add('endTime');
        const extractedTitle = typeof row.title === 'string' ? row.title.trim().slice(0, 200) : '';
        const title = extractedTitle || (source === 'work' ? 'Praca' : '');
        if (!title && source === 'classes') unresolved.add('title');
        const employee = typeof row.employee === 'string' ? row.employee.trim().slice(0, 200) : '';
        if (source === 'work' && !employee) unresolved.add('employee');
        // Location is optional; a blank/uncertain room should not make the time row incomplete.
        unresolved.delete('location');
        if (source === 'work' && title === 'Praca') unresolved.delete('title');
        return {
          id: randomUUID(), title, date, startTime, endTime,
          category: source === 'work' ? 'Work' : 'Class', location: typeof row.location === 'string' ? row.location.trim().slice(0, 200) || undefined : undefined,
          employee: source === 'work' ? employee || undefined : undefined,
          confidence: Math.max(0, Math.min(1, Number.isFinite(row.confidence ?? Number.NaN) ? row.confidence ?? 0 : 0)),
          sourcePage: Number.isInteger(row.sourcePage) && (row.sourcePage ?? 0) > 0 ? row.sourcePage ?? undefined : undefined,
          sourceSnippet: typeof row.sourceSnippet === 'string' ? row.sourceSnippet.trim().slice(0, 160) || undefined : undefined,
          unresolvedFields: [...unresolved],
        };
      });
      return { rows, usage: { inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 }, responseId: response.id };
  }

  async sendAssistantMessage(input: ResponseInputItem[], tools: FunctionTool[]) {
    return this.foundry.respond({
      store: false,
      instructions: KAC_ASSISTANT_INSTRUCTIONS,
      input,
      tools,
      parallel_tool_calls: false,
      max_output_tokens: 1200,
    });
  }
}

export { extractionSchema };
