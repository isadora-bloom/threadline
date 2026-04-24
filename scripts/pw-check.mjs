import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:3003';
const OUT = 'C:/Users/Ismar/threadline/.pw-check';
fs.mkdirSync(OUT, { recursive: true });

const routes = [
  '/landing',
  '/',
  '/login',
  '/guide',
  '/privacy',
  '/terms',
  '/submit',
  '/feedback',
  '/registry',
  '/intelligence',
  '/intelligence/analysis',
  '/my-watchlist',
  '/needing-attention',
  '/lookup',
  '/cases',
  '/research',
  '/profile',
];

const results = [];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

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

  let finalUrl = null;
  let status = null;
  let title = null;
  let errorText = null;
  try {
    const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 90000 });
    status = resp?.status() ?? null;
    finalUrl = page.url();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    title = await page.title().catch(() => null);
    const slug = route.replace(/[\/]/g, '_') || 'root';
    await page.screenshot({ path: `${OUT}/${slug}.png`, fullPage: true });
  } catch (err) {
    errorText = String(err);
  }

  results.push({
    route,
    finalUrl,
    status,
    title,
    errorText,
    pageErrors,
    consoleMsgs: consoleMsgs.slice(0, 20),
    failedRequests: failedRequests.slice(0, 20),
  });
  await page.close();
  console.log(`[done] ${route} -> ${finalUrl} (${status})`);
}

await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
console.log(`\nWrote ${OUT}/report.json`);
