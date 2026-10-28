// Lokalny OCR grafiku pracy (S23KC2S1P2-44). Uruchamiany w osobnym wątku (ocr-worker.mjs).
// Ta sama technologia co w imporcie planu zajęć (historyjka 38): sharp do przygotowania obrazu
// i Tesseract.js z modelem dołączonym do aplikacji. Bez pobierania modeli, bez usług zewnętrznych, bez zapisu pliku.
// Model polski, bo grafiki zawierają imiona i nazwiska z polskimi znakami.
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const model = require('@tesseract.js-data/pol');

const DARK = 140;

/**
 * Usuwa linie siatki tabeli (długie poziome i pionowe kreski). Tesseract traktuje obramowane komórki
 * jak obrazki i pomija ich tekst, dlatego przed OCR zamalowujemy kreski na biało. Litery są dużo krótsze niż te linie.
 */
function removeTableLines(data, width, height) {
  const minHorizontal = Math.max(150, Math.round(width * 0.12));
  const minVertical = Math.max(90, Math.round(height * 0.06));
  const erase = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const dark = x < width && data[y * width + x] < DARK;
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        if (x - start >= minHorizontal) erase.push([start, y, x - start, 1]);
        start = -1;
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      const dark = y < height && data[y * width + x] < DARK;
      if (dark && start < 0) start = y;
      if (!dark && start >= 0) {
        if (y - start >= minVertical) erase.push([x, start, 1, y - start]);
        start = -1;
      }
    }
  }
  // Zamalowujemy z marginesem 1 px, żeby nie zostały szare krawędzie linii.
  for (const [left, top, w, h] of erase) {
    for (let y = Math.max(0, top - 1); y < Math.min(height, top + h + 1); y++) {
      for (let x = Math.max(0, left - 1); x < Math.min(width, left + w + 1); x++) data[y * width + x] = 255;
    }
  }
}

/**
 * Binaryzacja adaptacyjna (metoda Bradleya): piksel jest ciemny, gdy jest wyraźnie ciemniejszy od średniej z otoczenia.
 * Radzi sobie z nierównym oświetleniem, cieniem i zdjęciem ekranu, gdzie jeden globalny próg zawodzi.
 */
function adaptiveThreshold(data, width, height) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += data[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row;
    }
  }
  const half = Math.max(8, Math.round(width / 48));
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half), y1 = Math.min(height, y + half + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half), x1 = Math.min(width, x + half + 1);
      const sum = integral[y1 * (width + 1) + x1] - integral[y0 * (width + 1) + x1] - integral[y1 * (width + 1) + x0] + integral[y0 * (width + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      out[y * width + x] = data[y * width + x] < mean * 0.82 ? 1 : 0;
    }
  }
  return out;
}

/**
 * Usuwa z obrazu binarnego elementy, które nie są tekstem: siatkę tabeli (także krzywą na zdjęciu robionym pod kątem),
 * ramkę ekranu, krawędzie kartki i drobne kropki szumu. Litery to małe, osobne plamki – zostają.
 */
function removeNonText(binary, width, height) {
  const labels = new Int32Array(width * height);
  const parent = [0];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!binary[i]) continue;
      const up = y > 0 ? labels[i - width] : 0;
      const left = x > 0 ? labels[i - 1] : 0;
      if (!up && !left) { parent.push(parent.length); labels[i] = parent.length - 1; }
      else if (up && left) { const a = find(up), b = find(left); labels[i] = Math.min(a, b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
      else labels[i] = up || left;
    }
  }
  const count = parent.length;
  const minX = new Int32Array(count).fill(width), minY = new Int32Array(count).fill(height);
  const maxX = new Int32Array(count), maxY = new Int32Array(count), area = new Int32Array(count);
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const root = find(labels[i]);
    labels[i] = root;
    const x = i % width, y = (i - x) / width;
    if (x < minX[root]) minX[root] = x;
    if (x > maxX[root]) maxX[root] = x;
    if (y < minY[root]) minY[root] = y;
    if (y > maxY[root]) maxY[root] = y;
    area[root]++;
  }
  const remove = new Uint8Array(count);
  for (let label = 1; label < count; label++) {
    if (!area[label]) continue;
    const w = maxX[label] - minX[label] + 1, h = maxY[label] - minY[label] + 1;
    if (w > width * 0.15 || h > height * 0.1 || area[label] < 6) remove[label] = 1;
  }
  const image = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i++) image[i] = labels[i] && !remove[labels[i]] ? 0 : 255;
  return image;
}

async function prepareVariants(bytes) {
  const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning', animated: false }).autoOrient();
  const metadata = await image.metadata();
  if (!['png', 'jpeg'].includes(metadata.format) || (metadata.pages ?? 1) !== 1 || metadata.width > 6000 || metadata.height > 8000) {
    throw new Error('unreadable-image');
  }
  // Skalujemy do ok. 2000–3000 px szerokości: małe zrzuty powiększamy, duże zdjęcia z telefonu zmniejszamy.
  const width = metadata.autoOrient?.width ?? metadata.width;
  const target = Math.round(width < 1600 ? Math.min(width * 2, 2400) : width > 3200 ? 3000 : width);
  const toPng = (pixels, info) => sharp(pixels, { raw: { width: info.width, height: info.height, channels: 1 } })
    .withMetadata({ density: 300 }).png().toBuffer();

  // Wariant 1 – zrzut ekranu, PDF zapisany jako obraz, skan: globalny kontrast i usunięcie prostych linii siatki.
  const clean = await image.clone().flatten({ background: 'white' }).greyscale().normalise()
    .resize({ width: target, kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  removeTableLines(clean.data, clean.info.width, clean.info.height);

  // Wariant 2 – zdjęcie z telefonu (kartka, ekran): lekkie rozmycie przeciw mory, binaryzacja adaptacyjna
  // i usunięcie wszystkiego, co nie wygląda jak litery (krzywa siatka, ramka ekranu, cienie).
  const photo = await image.clone().flatten({ background: 'white' }).greyscale()
    .resize({ width: target, kernel: 'lanczos3' }).blur(1.2).raw().toBuffer({ resolveWithObject: true });
  const binary = removeNonText(adaptiveThreshold(photo.data, photo.info.width, photo.info.height), photo.info.width, photo.info.height);

  return [
    { name: 'photo', png: await toPng(binary, photo.info) },
    { name: 'clean', png: await toPng(clean.data, clean.info) },
  ];
}

/**
 * Zwraca linie tekstu z obrazu (z pewnością odczytu 0–1) w dwóch wariantach przygotowania obrazu.
 * Który wariant jest lepszy, wybiera czytnik po interpretacji tekstu (local-reader.ts).
 */
export async function recognizeScheduleLines(bytes) {
  const variants = await prepareVariants(bytes);
  const worker = await createWorker('pol', 1, { langPath: model.langPath, cacheMethod: 'none', gzip: true });
  try {
    // Tryb „jeden blok tekstu” czyta tabelę wiersz po wierszu, z zachowaniem odstępów między kolumnami.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: '1', user_defined_dpi: '300' });
    const results = [];
    for (const variant of variants) {
      const { data } = await worker.recognize(variant.png, { rotateAuto: true }, { blocks: true, text: true });
      const lines = (data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
      results.push({
        name: variant.name,
        lines: lines
          .map((line) => ({
            text: line.text.replace(/\s+/g, ' ').trim(),
            confidence: Math.max(0, Math.min(1, line.confidence / 100)),
            // Położenie słów w poziomie – do przypisania komórek tabeli do kolumn z datami.
            words: (line.words ?? []).map((word) => ({ text: word.text, x0: word.bbox.x0, x1: word.bbox.x1 })),
          }))
          .filter((line) => line.text.length > 0)
          .slice(0, 2000),
      });
    }
    return results;
  } finally {
    await worker.terminate();
  }
}
