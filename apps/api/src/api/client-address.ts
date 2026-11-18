// Adres klienta jako klucz limitów żądań. Za Azure App Service adres pochodzi z X-Forwarded-For (TRUST_PROXY) i bywa podany z portem
// („203.0.113.5:51234”) – bez obcięcia portu każde połączenie miałoby osobny licznik i limit logowania by nie działał.
export function clientAddress(address: string | undefined): string {
  const value = (address ?? '').trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  if (bracketed) return bracketed[1]!;
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (ipv4WithPort) return ipv4WithPort[1]!;
  return value || 'unknown';
}

/**
 * Liczba zaufanych pośredników → funkcja dla Fastify (ufa tylu przeskokom licząc od serwera API). Typy Fastify 5 nie przyjmują liczby,
 * a przekazana mimo to dawała w testach adres pośrednika zamiast klienta (patrz tests/auth.test.ts).
 */
export const trustProxyOption = (value: boolean | number) =>
  typeof value === 'number' ? (_address: string, hop: number) => hop < value : value;
