// Wspólny limit odczytu OCR dla wszystkich importów (plan zajęć – S23KC2S1P2-38, grafik pracy – S23KC2S1P2-44).
// Rozpoznawanie obrazu mocno obciąża procesor i pamięć, więc na serwerze działa naraz tylko jeden odczyt.
// Kolejne żądanie dostaje od razu odpowiedź „reader-busy” (HTTP 429) zamiast czekać w kolejce.

let busy = false;

/** Zajmuje miejsce na odczyt OCR. Zwraca funkcję zwalniającą albo null, gdy trwa już inny odczyt. */
export function tryAcquireRecognition(): (() => void) | null {
  if (busy) return null;
  busy = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    busy = false;
  };
}
