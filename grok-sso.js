const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const os = require('os');
chromium.use(StealthPlugin());

const CONCURRENCY = 10;

function loadAccounts(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(line => {
      const [login, password, email, mailpassword, authtoken, twofa] = line.split(':');
      return { login, password, email, mailpassword, authtoken, twofa };
    });
}

async function processAccount(account) {
  // مجلد مؤقت فريد لكل حساب
  const userDataDir = path.join(os.tmpdir(), `xops_${account.login}_${Date.now()}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  await context.addCookies([{
    name: 'auth_token',
    value: account.authtoken,
    domain: '.x.com',
    path: '/',
    httpOnly: true,
    secure: true
  }]);

  const page = await context.newPage();

  try {
    // ===== Step 1: تحقق من التوكن =====
    console.log(`[${account.login}] Checking auth token...`);
    try {
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch {
      console.log(`[${account.login}] SKIP — timeout on x.com`);
      return { login: account.login, status: 'skipped' };
    }

    await page.waitForTimeout(2000);
    const isValid = page.url().includes('/home') && !page.url().includes('/login');

    if (!isValid) {
      console.log(`[${account.login}] SKIP — token invalid`);
      return { login: account.login, status: 'skipped' };
    }
    console.log(`[${account.login}] Token valid`);

    // ===== Step 2: افتح Grok sign-in =====
    console.log(`[${account.login}] Opening Grok sign-in...`);
    await page.goto('https://accounts.x.ai/sign-in?redirect=grok-com', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(10000);

    // اغلق cookie popup
    await page.evaluate(() => {
      const btn = document.getElementById('onetrust-reject-all-handler');
      if (btn) btn.click();
    });
    await page.waitForTimeout(1000);

    // ===== Step 3: اضغط Login with X =====
    console.log(`[${account.login}] Clicking Login with X...`);
    await page.locator('button.min-h-10[class*="--btn-bg:hsl"]').click();
    await page.waitForTimeout(3000);

    // ===== Step 4: اضغط Authorize app =====
    console.log(`[${account.login}] Waiting for Authorize button...`);
    const btn = await page.waitForSelector(
      '[data-testid="OAuth_Consent_Button"]',
      { state: 'visible', timeout: 10000 }
    );
    console.log(`[${account.login}] Clicking Authorize app...`);
    await btn.click();

    // انتظر وصول grok.com
    // await page.waitForURL(url => url.includes('grok.com'), { timeout: 30000 });
    // await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(10000);
    console.log(`[${account.login}] Reached grok.com`);

    // ===== Step 5: احفظ SSO =====
    const cookies = await context.cookies(['https://grok.com']);
    const sso = cookies.find(c => c.name === 'sso');

    if (sso) {
      console.log(`[${account.login}] SUCCESS — SSO saved`);
      fs.appendFileSync('results.txt', `${account.login}:${sso.value}\n`);
      return { login: account.login, status: 'success' };
    }

    console.log(`[${account.login}] NO_SSO — cookie not found`);
    return { login: account.login, status: 'no_sso' };

  } catch (err) {
    console.log(`[${account.login}] ERROR — ${err.message.split('\n')[0]}`);
    return { login: account.login, status: 'error' };

  } finally {
    await context.close();
    // امسح المجلد المؤقت بعد الإغلاق
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function runQueue(accounts, concurrency) {
  const results = [];
  const queue = [...accounts];

  async function worker() {
    while (queue.length > 0) {
      const account = queue.shift();
      console.log(`\n[QUEUE] Processing: ${account.login} — remaining: ${queue.length}`);
      results.push(await processAccount(account));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, accounts.length) }, worker));
  return results;
}

(async () => {
  const accounts = loadAccounts('accounts.txt');
  if (fs.existsSync('results.txt')) fs.unlinkSync('results.txt');

  console.log(`[START] ${accounts.length} accounts — concurrency: ${CONCURRENCY}\n`);
  const results = await runQueue(accounts, CONCURRENCY);

  const s  = results.filter(r => r.status === 'success').length;
  const sk = results.filter(r => r.status === 'skipped').length;
  const e  = results.filter(r => r.status === 'error').length;
  const n  = results.filter(r => r.status === 'no_sso').length;

  console.log(`\n[DONE] success=${s} skipped=${sk} no_sso=${n} errors=${e}`);
  console.log('[SAVED] results.txt');
})();