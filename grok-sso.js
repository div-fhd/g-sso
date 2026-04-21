const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
chromium.use(StealthPlugin());

const CONCURRENCY = 3;

function loadAccounts(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(line => {
      const [login, password, email, mailpassword, authtoken, twofa] = line.split(':');
      return { login, password, email, mailpassword, authtoken, twofa, format: 'F1' };
    });
}

async function verifyAuth(page) {
  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000);
  } catch {
    return false;
  }
  const url = page.url();
  const isLoggedIn = url.includes('/home') && !url.includes('/login');
  console.log(`[AUTH] ${url} — ${isLoggedIn ? 'VALID' : 'INVALID'}`);
  return isLoggedIn;
}

async function grokAuth(page) {
  await page.goto('https://accounts.x.ai/sign-in?redirect=grok-com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const reject = document.getElementById('onetrust-reject-all-handler');
    if (reject) reject.click();
  });
  await page.waitForTimeout(1000);

  await page.locator('button.min-h-10[class*="--btn-bg:hsl"]').click();
}

async function authorizeApp(page) {
  // انتظر إما زر الموافقة أو redirect مباشر لـ grok.com
  const result = await Promise.race([
    page.waitForSelector('[data-testid="OAuth_Consent_Button"]', {
      state: 'visible', timeout: 10000
    }).then(() => 'consent'),
    page.waitForURL(url => url.includes('grok.com'), {
      timeout: 10000
    }).then(() => 'already_authorized'),
  ]).catch(() => 'timeout');

  if (result === 'already_authorized') {
    console.log('[OAUTH] Already authorized — redirect direct');
    return;
  }

  if (result === 'timeout') {
    throw new Error('OAuth timeout');
  }

  const btn = await page.$('[data-testid="OAuth_Consent_Button"]');
  await Promise.all([
    page.waitForURL(url => url.includes('grok.com'), { timeout: 30000 }),
    btn.click()
  ]);
  console.log('[OAUTH] Authorized — URL:', page.url());
}

async function processAccount(account) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
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
    const isValid = await verifyAuth(page);
    if (!isValid) {
      console.log(`[SKIP] ${account.login} — token invalid`);
      return { login: account.login, status: 'skipped' };
    }

    await grokAuth(page);
    await authorizeApp(page);

    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const cookies = await context.cookies(['https://grok.com']);
    const sso = cookies.find(c => c.name === 'sso');

    if (sso) {
      console.log(`[SUCCESS] ${account.login} — SSO: ${sso.value.substring(0, 30)}...`);
      fs.appendFileSync('results.txt', `${account.login}:${sso.value}\n`);
      return { login: account.login, status: 'success', sso: sso.value };
    }

    console.log(`[NO_SSO] ${account.login} — no sso cookie found`);
    return { login: account.login, status: 'no_sso' };

  } catch (err) {
    console.log(`[ERROR] ${account.login} — ${err.message.split('\n')[0]}`);
    return { login: account.login, status: 'error', error: err.message };

  } finally {
    await context.clearCookies();
    await context.close();
    await browser.close();
  }
}

async function runQueue(accounts, concurrency) {
  const results = [];
  const queue = [...accounts];

  async function worker() {
    while (queue.length > 0) {
      const account = queue.shift();
      console.log(`[QUEUE] ${account.login} — remaining: ${queue.length}`);
      const result = await processAccount(account);
      results.push(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, accounts.length) }, worker));
  return results;
}

(async () => {
  const accounts = loadAccounts('accounts.txt');
  console.log(`[START] ${accounts.length} accounts — concurrency: ${CONCURRENCY}`);

  // امسح الملف القديم
  if (fs.existsSync('results.txt')) fs.unlinkSync('results.txt');

  const results = await runQueue(accounts, CONCURRENCY);

  const success = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const noSso   = results.filter(r => r.status === 'no_sso').length;
  const errors  = results.filter(r => r.status === 'error').length;

  console.log(`\n[DONE] success=${success} skipped=${skipped} no_sso=${noSso} errors=${errors}`);
  console.log('[SAVED] results.txt');
})();