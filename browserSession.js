const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

async function launchSession(account, proxy) {
  const contextOptions = {
    ...(proxy && {
      proxy: {
        server: `${proxy.type}://${proxy.host}:${proxy.port}`,
        username: proxy.user || undefined,
        password: proxy.pass || undefined,
      }
    }),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  };

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext(contextOptions);

  // حقن الكوكيز/التوكن حسب الصيغة
  if (account.format === 'F2' && account.auth_token) {
    await context.addCookies([
      { name: 'auth_token', value: account.auth_token, domain: '.x.com', path: '/' },
      { name: 'ct0', value: account.session_token, domain: '.x.com', path: '/' }
    ]);
  } else if (account.format === 'F1' && account.authtoken) {
    await context.addCookies([
      { name: 'auth_token', value: account.authtoken, domain: '.x.com', path: '/' }
    ]);
  }

  const page = await context.newPage();

  // الخطوة 1: X.com
  await page.goto('https://x.com', { waitUntil: 'networkidle' });
  
  // الخطوة 2: Grok OAuth
  await page.goto(
    'https://accounts.x.ai/sign-in?redirect=grok-com',
    { waitUntil: 'networkidle' }
  );

  // إذا طلب login يدوي
  const needsLogin = await page.$('[data-testid="LoginForm_Login_Button"]');
  if (needsLogin) {
    await loginManual(page, account);
  }

  return { browser, context, page };
}

async function loginManual(page, account) {
  await page.fill('[autocomplete="username"]', account.login);
  await page.click('[data-testid="LoginForm_Login_Button"]');
  await page.waitForTimeout(1500);
  await page.fill('[name="password"]', account.password);
  await page.click('[data-testid="LoginForm_Login_Button"]');
  // 2FA إذا موجود
  if (account.twofa) {
    await page.waitForSelector('[data-testid="ocfEnterTextTextInput"]', { timeout: 5000 }).catch(() => {});
    const tfaInput = await page.$('[data-testid="ocfEnterTextTextInput"]');
    if (tfaInput) {
      await tfaInput.fill(account.twofa);
      await page.click('[data-testid="ocfEnterTextNextButton"]');
    }
  }
}

module.exports = { launchSession };