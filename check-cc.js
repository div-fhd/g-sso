const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");
const path = require("path");
const os = require("os");
chromium.use(StealthPlugin());

const CONCURRENCY = 1;

function loadResults(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((line) => {
      const [login, sso] = line.split(":");
      return { login, sso };
    });
}

function randomDelay(min = 50, max = 150) {
  return Math.floor(Math.random() * (max - min) + min);
}

async function humanType(page, selector, text) {
  await page.waitForSelector(selector, { state: "visible", timeout: 15000 });
  await page.click(selector);
  await page.waitForTimeout(randomDelay(200, 500));
  for (const char of text) {
    await page.type(selector, char, { delay: randomDelay(50, 150) });
  }
}

async function processAccount(account) {
  const userDataDir = path.join(os.tmpdir(), `xops_sub_${account.login}_${Date.now()}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "en-US",
    timezoneId: "America/New_York",
  });

  const page = await context.newPage();

  try {
    // ===== Step 1: حقن SSO =====
    console.log(`[${account.login}] Injecting SSO...`);
    await context.addCookies([{
      name: "sso",
      value: account.sso,
      domain: ".grok.com",
      path: "/",
      httpOnly: false,
      secure: true,
    }]);

    // ===== Step 2: افتح صفحة الاشتراك =====
    console.log(`[${account.login}] Opening subscribe page...`);
    await page.goto("https://grok.com/#subscribe", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(randomDelay(3000, 5000));

    // ===== Step 3: اضغط Claim free offer =====
    console.log(`[${account.login}] Clicking Claim free offer...`);
    const btn = await page.waitForSelector('button:has-text("Claim free offer")', { state: "visible", timeout: 15000 });
    await page.waitForTimeout(randomDelay(500, 1500));
    await btn.click();
    await page.waitForTimeout(randomDelay(3000, 5000));
    // ===== Step 4: تحديد Card =====
    // console.log(`[${account.login}] Selecting Card...`);
    // await page.waitForTimeout(randomDelay(1000, 2000));

    // await page.locator('[data-testid="card-accordion-item"]').click();
              
    // ===== Step 4: ادخل بيانات البطاقة بطريقة بشرية =====
    console.log(`[${account.login}] Filling card details...`);
    await humanType(page, "#cardNumber",   "5294150478594655");
    await humanType(page, "#cardExpiry",   "10/28");
    await humanType(page, "#cardCvc",      "779");
    await humanType(page, "#billingName",  "fahd you");
    console.log(`[${account.login}] Card details filled`);

    // ===== Step 5: اضغط Start trial =====
    await page.waitForTimeout(randomDelay(1000, 3000));
    await page.click('[data-testid="hosted-payment-submit-button"]');
    console.log(`[${account.login}] Clicked Start trial`);
    await page.waitForTimeout(10000);
    // ===== Step 6: انتظر النتيجة =====
    const result = await Promise.race([
      page.waitForSelector('p:has-text("declined"), .Alert--error', {
        state: 'visible', timeout: 20000
      }).then(() => 'declined'),
      
      page.waitForURL(url => !url.toString().includes('checkout.stripe.com'), {
        timeout: 20000
      }).then(() => 'success'),
      
      // كل أنواع الكابتشا
      page.waitForSelector([
        'iframe[src*="turnstile"]',
        'iframe[src*="captcha"]',
        'iframe[src*="recaptcha"]',
        'iframe[src*="challenges.cloudflare"]',
        '[class*="captcha"]',
        '#cf-turnstile',
      ].join(', '), {
        state: 'visible', timeout: 20000
      }).then(() => 'captcha'),

    ]).catch((err) => {
      console.log(`[${account.login}] Race error: ${err.message.split('\n')[0]}`);
      return 'timeout';
    });

    if (result === 'captcha') {
      console.log(`[${account.login}] CAPTCHA detected — skipping`);
      fs.appendFileSync('captcha.txt', `${account.login}\n`);
      return { login: account.login, status: 'captcha' };
    }

    if (result === "declined") {
      const text = await page.$eval('p:has-text("declined"), .Alert--error', (el) => el.textContent);
      console.log(`[${account.login}] DECLINED — ${text.trim()}`);
      fs.appendFileSync("declined.txt", `${account.login}\n`);
      return { login: account.login, status: "declined" };
    }

    if (result === "success") {
      console.log(`[${account.login}] SUCCESS — URL: ${page.url()}`);
      fs.appendFileSync("subscribe-results.txt", `${account.login}:${page.url()}\n`);
      return { login: account.login, status: "success" };
    }

    console.log(`[${account.login}] TIMEOUT`);
    return { login: account.login, status: "timeout" };

  } catch (err) {
    console.log(`[${account.login}] ERROR — ${err.message.split("\n")[0]}`);
    return { login: account.login, status: "error" };

  } finally {
    await context.close();
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
  const accounts = loadResults("results.txt");
  if (fs.existsSync("subscribe-results.txt")) fs.unlinkSync("subscribe-results.txt");

  console.log(`[START] ${accounts.length} accounts — concurrency: ${CONCURRENCY}\n`);
  const results = await runQueue(accounts, CONCURRENCY);

  const s  = results.filter((r) => r.status === "success").length;
  const d  = results.filter((r) => r.status === "declined").length;
  const c  = results.filter((r) => r.status === "captcha").length;
  const t  = results.filter((r) => r.status === "timeout").length;
  const e  = results.filter((r) => r.status === "error").length;

  console.log(`\n[DONE] success=${s} declined=${d} captcha=${c} timeout=${t} errors=${e}`);
})();