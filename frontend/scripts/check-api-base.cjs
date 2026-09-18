/**
 * Checks src/lib/api-base.ts (which FastAPI address the app calls) without a test
 * runner: transpiles it with the project's TypeScript and runs fixed scenarios.
 *
 * Run: node scripts/check-api-base.cjs
 */
/* global __dirname */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/lib/api-base.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const mod = { exports: {} };
new Function('module', 'exports', outputText)(mod, mod.exports);
const { resolveApiBase } = mod.exports;

// [scenario, EXPO_PUBLIC_API_URL baked into the build, host the app loaded from, expected]
const cases = [
  ['stale localhost build opened from a phone on the LAN', 'http://localhost:8000', '192.168.1.104', 'http://192.168.1.104:8000'],
  ['laptop LAN IP changed since the build', 'http://192.168.1.104:8000', '192.168.1.57', 'http://192.168.1.57:8000'],
  ['env unset, page loaded over the LAN', undefined, '10.0.0.8', 'http://10.0.0.8:8000'],
  ['desktop browser on localhost', 'http://localhost:8000', 'localhost', 'http://localhost:8000'],
  ['production URL is used exactly as configured', 'https://api.example.com', 'app.example.com', 'https://api.example.com'],
  ['production URL untouched even from a LAN page', 'https://api.example.com', '192.168.1.104', 'https://api.example.com'],
  ['local env never follows a public page host', 'http://localhost:8000', 'app.example.com', 'http://localhost:8000'],
  ['host unknown keeps the configured URL', 'http://192.168.1.104:8000', undefined, 'http://192.168.1.104:8000'],
  ['custom port kept, trailing slash trimmed', 'http://localhost:9001/', '172.20.1.4', 'http://172.20.1.4:9001'],
  ['172.32.x is public, not private LAN', 'http://localhost:8000', '172.32.0.1', 'http://localhost:8000'],
];

let failed = 0;
for (const [label, configured, host, expected] of cases) {
  const actual = resolveApiBase(configured, host);
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}${ok ? '' : ` (got ${actual}, expected ${expected})`}`);
}
console.log(`RESULT: ${cases.length - failed}/${cases.length} api-base checks passed`);
process.exit(failed ? 1 : 0);
