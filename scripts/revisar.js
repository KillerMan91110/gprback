#!/usr/bin/env node
// Revisión rápida del back antes de un commit:  npm run revisar
//
// 1. Carga cada archivo de routes/ y lib/ (errores de sintaxis, require rotos, nombres que no
//    existen al exportar…). No abre el servidor ni toca la base.
// 2. Opcional, contra un servidor que ya esté corriendo (por ejemplo uno temporal en 5098):
//      REVISAR_URL=http://localhost:5098 REVISAR_EMAIL=... REVISAR_PASS=... npm run revisar
//    entra con esa cuenta y llama a los endpoints principales de solo lectura; avisa si alguno
//    no responde 2xx. Usa una cuenta de prueba local, nunca producción.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const errores = [];

// ---- 1. carga de módulos (silenciando los console.log que hacen algunos al cargar)
const log = console.log;
for (const dir of ['lib', 'routes']) {
  for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((x) => x.endsWith('.js'))) {
    try {
      console.log = () => {};
      require(path.join(ROOT, dir, f));
    } catch (e) {
      errores.push(`${dir}/${f} no carga: ${e.message.split('\n')[0]}`);
    } finally {
      console.log = log;
    }
  }
}
// server.js monta rutas por nombre: que cada require('./routes/...') exista
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
for (const m of server.matchAll(/require\('\.\/(routes|lib)\/([a-zA-Z0-9_]+)'\)/g)) {
  if (!fs.existsSync(path.join(ROOT, m[1], `${m[2]}.js`))) errores.push(`server.js pide ${m[1]}/${m[2]}.js, que no existe`);
}

// ---- nombres usados sin definir (variables o funciones que se movieron de archivo, typos…)
if (!process.argv.includes('--sin-lint')) {
  const { execSync } = require('child_process');
  try {
    execSync("npx -y eslint@8 --no-eslintrc --env node,es2022 --parser-options ecmaVersion:2022 --rule no-undef:error lib routes server.js", { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    const out = String(e.stdout || '').trim();
    if (out) errores.push(`Nombres sin definir:
${out}`);
    else console.log('  (no se pudo correr eslint para revisar nombres sin definir; se omite)');
  }
}

async function enVivo() {
  const base = process.env.REVISAR_URL;
  if (!base) return 'sin prueba en vivo (define REVISAR_URL, REVISAR_EMAIL y REVISAR_PASS para hacerla)';
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: process.env.REVISAR_EMAIL, password: process.env.REVISAR_PASS }),
  }).then((r) => r.json()).catch((e) => ({ error: e.message }));
  if (!login.token) { errores.push(`En vivo: no se pudo entrar (${login.error ?? 'sin token'})`); return null; }
  const id = login.player?.id ?? login.user?.id ?? login.playerId;
  const auth = { Authorization: `Bearer ${login.token}` };
  const rutas = [
    '/api/world/noticias', '/api/world/mitico', '/api/zones',
    `/api/player/${id}/stats`, `/api/player/${id}/inventory`, `/api/player/${id}/equipment`,
    `/api/player/${id}/coleccion/bestiario`, `/api/player/${id}/coleccion/cartas`,
    `/api/player/${id}/world/nodes?zone=1`, `/api/player/${id}/world/ofrenda`,
    `/api/player/${id}/market/listings`, `/api/player/${id}/market/mine`,
    `/api/player/${id}/social/overview`, `/api/player/${id}/pets`,
  ];
  let ok = 0;
  for (const r of rutas) {
    const res = await fetch(base + r, { headers: auth }).catch((e) => ({ status: 0, statusText: e.message }));
    if (res.status >= 200 && res.status < 300) ok++;
    else errores.push(`En vivo: GET ${r} → ${res.status} ${res.statusText ?? ''}`.trim());
  }
  return `${ok}/${rutas.length} endpoints respondieron bien`;
}

enVivo().then((vivo) => {
  if (errores.length) {
    console.log(`\n❌ Errores (${errores.length}):\n${errores.map((e) => `  • ${e}`).join('\n')}\n`);
    process.exit(1);
  }
  console.log(`\n✅ Todo carga bien${vivo ? ` · ${vivo}` : ''}.\n`);
  process.exit(0);
});
