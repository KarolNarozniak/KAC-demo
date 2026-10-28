// Małe, poprawne pliki testowe tworzone w kodzie, żeby nie trzymać w repozytorium plików binarnych.

/** Minimalny poprawny PNG 1×1 piksel. */
export const pngBytes = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

/** Minimalny plik JPEG: znacznik początku, nagłówek JFIF i znacznik końca. */
export const jpgBytes = () =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9), Buffer.from([0xff, 0xd9])]);

/** Minimalny dokument PDF z jedną linią grafiku. */
export const pdfBytes = () =>
  Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% Grafik: 2026-11-02 16:00-20:00 Student Demo\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1');

export const toBase64 = (bytes: Buffer) => bytes.toString('base64');
