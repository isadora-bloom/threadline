import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:3003';
const OUT = 'C:/Users/Ismar/threadline/.pw-check';
fs.mkdirSync(OUT, { recursive: true });
const creds = JSON.parse(fs.readFileSync(`${OUT}/creds.json`, 'utf8'));

// Discover a recordId for profile pages.
// Seed: query via anon client to find any record in the registry.
async function pickRecord() {
  const { createClient } = await import('@supabase/supabase-js');
  const c = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data } = await c.from('import_records').select('id').limit(1);
  return data?.[0]?.id ?? null;
}
const sampleRecordId = await pickRecord();
console.log('sample record:', sampleRecordId);

const routes = [
  '/',
  '/lookup',
  '/registry',
  ...(sampleRecordId ? [`/registry/${sampleRecordId}`] : []),
  '/intelligence',
  '/intelligence/analysis',
  '/my-watchlist',
  '/needing-attention',
  '/cases',
  '/research',
  '/profile',
  '/guide',
  '/feedback',
  '/submit',
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

// Sign in via API (faster than UI form) — hit login page, then POST to Supabase via the client
const loginPage = await context.newPage();
const loginErrs = [];
loginPage.on('pageerror', (e) => loginErrs.push(String(e)));
loginPage.on('console', (m) => { if (m.type() === 'error') loginErrs.push('console:' + m.text()); });
await loginPage.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 90000 });
await loginPage.fill('#email', creds.email);
await loginPage.fill('#password', creds.password);
await loginPage.click('button[type="submit"]');
// supabase.signInWithPassword is async; wait for the handler to set session then redirect.
await loginPage.waitForURL(
  (url) => !url.pathname.startsWith('/login'),
  { timeout: 60000, waitUntil: 'domcontentloaded' }
).catch((e) => console.error('login wait failed:', String(e)));
await loginPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
console.log('post-login url:', loginPage.url(), 'errs:', loginErrs);
await loginPage.screenshot({ path: `${OUT}/auth_post-login.png` });
await loginPage.close();

const results = [];
for (const route of routes) {
  const page = await context.newPage();
  const consoleMsgs = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMsgs.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('requestfailed', (req) =>
    failedRequests.push({ url: req.url(), failure: req.failure()?.errorText })
  );
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push({ url: res.url(), status: res.status() });
    }
  });

  let finalUrl = null, status = null, title = null, errorText = null;
  try {
    const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 120000 });
    status = resp?.status() ?? null;
    finalUrl = page.url();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    title = await page.title().catch(() => null);
    const slug = 'auth' + route.replace(/[\/\[\]]/g, '_') || 'auth_root';
    await page.screenshot({ path: `${OUT}/${slug}.png` }).catch((e) => (errorText = (errorText || '') + '\nscreenshot:' + String(e)));
  } catch (err) {
    errorText = String(err);
  }

  results.push({
    route, finalUrl, status, title, errorText, pageErrors,
    consoleMsgs: consoleMsgs.slice(0, 30),
    failedRequests: failedRequests.slice(0, 30),
  });
  await page.close();
  const flag = (pageErrors.length + consoleMsgs.length + failedRequests.length) ? ' ⚠' : '';
  console.log(`[done] ${route} -> ${finalUrl} (${status})${flag}`);
}

await browser.close();
fs.writeFileSync(`${OUT}/auth_report.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/auth_report.json`);
