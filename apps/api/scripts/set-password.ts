// Administrator: ustawienie hasła konta KAC albo założenie konta (np. przy REGISTRATION_MODE=closed).
// Także pierwsze hasło dla kont sprzed logowania – np. konta z danymi demonstracyjnymi (student.demo@example.test).
//
// Użycie (z katalogu głównego repozytorium):
//   npm run auth:set-password -- student.demo@example.test
//   npm run auth:set-password -- anna@example.test --create --first Anna --last Nowak
// Hasło: zmienna środowiskowa KAC_NEW_PASSWORD albo pytanie w terminalu (wpisywane znaki nie są wyświetlane i nie trafiają do historii).
// Ustawienie hasła wylogowuje wszystkie urządzenia tego konta, zdejmuje blokadę po nieudanych próbach i unieważnia kod odzyskiwania
// (administrator ustawia hasło zwykle wtedy, gdy kod zaginął – ktoś mógł go znaleźć). Nowy kod użytkownik tworzy w Ustawienia → Konto.
import { createInterface } from 'node:readline';
import { pool } from '../src/database.js';
import { hashPassword, passwordProblem, PASSWORD_MIN_LENGTH } from '../src/auth/password.js';
import { PostgresAuthRepository } from '../src/auth/repository.js';

const args = process.argv.slice(2);
const email = args.find((arg, index) => !arg.startsWith('--') && !['--first', '--last', '--zone'].includes(args[index - 1] ?? ''));
const option = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const create = args.includes('--create');

function askHidden(question: string): Promise<string> {
  const reader = createInterface({ input: process.stdin, output: process.stdout, terminal: true }) as ReturnType<typeof createInterface> & { _writeToOutput?: (text: string) => void };
  process.stdout.write(question);
  reader._writeToOutput = () => {};
  return new Promise((resolve) => reader.question('', (answer) => { reader.close(); process.stdout.write('\n'); resolve(answer); }));
}

async function main() {
  if (!pool) throw new Error('Brak DATABASE_URL – ustaw go w .env.');
  if (!email) throw new Error('Podaj adres e-mail konta, np. npm run auth:set-password -- student.demo@example.test');
  const repository = new PostgresAuthRepository(pool);
  let user = await repository.findUserByEmail(email);
  if (!user && !create) throw new Error(`Nie ma konta ${email}. Dodaj --create, żeby je założyć.`);

  let password = process.env.KAC_NEW_PASSWORD ?? '';
  if (!password) {
    password = await askHidden(`Nowe hasło dla ${email} (min. ${PASSWORD_MIN_LENGTH} znaków): `);
    if (password !== await askHidden('Powtórz hasło: ')) throw new Error('Hasła się różnią – nic nie zmieniono.');
  }
  const problem = passwordProblem(password, email);
  if (problem) throw new Error(`Hasło odrzucone (${problem}) – nic nie zmieniono.`);

  if (!user) user = await repository.createUser({ email, firstName: option('--first') ?? 'Użytkownik', lastName: option('--last') ?? '', timeZone: option('--zone') ?? 'Europe/Warsaw' });
  await repository.setPassword(user.id, await hashPassword(password));
  await repository.setRecoveryCode(user.id, null);
  await repository.ensureAccountDefaults(user.id);
  const revoked = await repository.revokeSessions(user.id, 'reset_hasla', null);
  console.log(`Hasło ustawione dla ${user.email}.${revoked ? ` Wylogowano urządzenia: ${revoked}.` : ''}`);
  console.log(user.hasRecoveryCode
    ? 'Dotychczasowy kod odzyskiwania przestał działać – po zalogowaniu utwórz nowy w Ustawienia → Konto.'
    : 'Konto nie ma kodu odzyskiwania – po zalogowaniu utwórz go w Ustawienia → Konto.');
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
