import sharp from 'sharp';
import { countPdfPages, PdfReadError } from '../import/classes/reader.js';
import { checkScheduleFile, type ScheduleFileType } from '../import/work-schedule/file-check.js';

export type ValidatedAiFile = { fileName: string; bytes: Buffer; type: ScheduleFileType; mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'; pageCount: number | null };
export type AiFileValidationErrorCode = 'empty-file' | 'file-too-large' | 'unsupported-format' | 'corrupted-file' | 'too-many-pages' | 'encrypted-pdf' | 'read-timeout' | 'reader-busy' | 'unreadable-pdf' | 'unreadable-image' | 'image-too-large' | 'ai-payload-too-large';

export class AiFileValidationError extends Error {
  constructor(readonly code: AiFileValidationErrorCode) { super(code); }
}

export async function validateAiFile(fileName: string, dataBase64: string, maximumPages: number, maximumImagePixels: number): Promise<ValidatedAiFile> {
  const checked = checkScheduleFile(dataBase64);
  if (!checked.ok) throw new AiFileValidationError(checked.reason);
  const extension = fileName.toLowerCase();
  const extensionMatches = checked.type === 'PDF' ? extension.endsWith('.pdf')
    : checked.type === 'PNG' ? extension.endsWith('.png') : /\.(jpe?g)$/.test(extension);
  if (!extensionMatches) throw new AiFileValidationError('unsupported-format');
  if (checked.type === 'PDF') {
    try {
      const pageCount = await countPdfPages(checked.bytes, maximumPages);
      return { fileName: fileName.slice(0, 255), bytes: checked.bytes, type: checked.type, mimeType: 'application/pdf', pageCount };
    } catch (error) {
      if (error instanceof PdfReadError && error.message === 'too-many-pages') throw new AiFileValidationError('too-many-pages');
      if (error instanceof PdfReadError && ['encrypted-pdf', 'read-timeout', 'reader-busy', 'unreadable-pdf'].includes(error.message)) {
        throw new AiFileValidationError(error.message as AiFileValidationErrorCode);
      }
      throw new AiFileValidationError('unreadable-pdf');
    }
  }
  try {
    const metadata = await sharp(checked.bytes, { limitInputPixels: maximumImagePixels }).metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > maximumImagePixels) throw new AiFileValidationError('image-too-large');
    let bytes = checked.bytes;
    const maxInlineImageBytes = 1_400_000;
    if (bytes.length > maxInlineImageBytes) {
      bytes = await sharp(checked.bytes, { limitInputPixels: maximumImagePixels })
        .rotate().flatten({ background: '#ffffff' }).resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 84, mozjpeg: true }).toBuffer();
      if (bytes.length > maxInlineImageBytes) {
        bytes = await sharp(checked.bytes, { limitInputPixels: maximumImagePixels })
          .rotate().flatten({ background: '#ffffff' }).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 72, mozjpeg: true }).toBuffer();
      }
      if (bytes.length > maxInlineImageBytes) throw new AiFileValidationError('ai-payload-too-large');
    }
    return { fileName: fileName.slice(0, 255), bytes, type: checked.type, mimeType: bytes === checked.bytes && checked.type === 'PNG' ? 'image/png' : 'image/jpeg', pageCount: 1 };
  } catch (error) {
    if (error instanceof AiFileValidationError) throw error;
    throw new AiFileValidationError('unreadable-image');
  }
}
