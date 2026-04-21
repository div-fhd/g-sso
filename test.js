const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const account = {
  format: 'F1',
  login: 'waller8272',
  password: '5j5et4j4oK',
  email: 'pushkin_18iq6@rambler.ru',
  authtoken: 'ff702dc436e7a4065e1dba9c8662bbfc8ff63aea',
  twofa: 'FGTKUMSUO34ELEGK'
};

async function verifyAuth(page) {
  await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const url = page.url();
  const isLoggedIn = url.includes('/home') && !url.includes('/login');
  console.log('[AUTH] URL:', url);
  console.log('[AUTH] Status:', isLoggedIn ? 'VALID' : 'INVALID');
  return isLoggedIn;
}

async function loginManual(page, account) {
  console.log('[LOGIN] Starting manual login...');
  await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.fill('[autocomplete="username"]', account.login);
  await page.click('[data-testid="LoginForm_Login_Button"]');
  await page.waitForTimeout(1500);

  await page.fill('[name="password"]', account.password);
  await page.click('[data-testid="LoginForm_Login_Button"]');
  await page.waitForTimeout(2000);

  if (account.twofa) {
    const tfaInput = await page.$('[data-testid="ocfEnterTextTextInput"]').catch(() => null);
    if (tfaInput) {
      console.log('[LOGIN] 2FA required...');
      await tfaInput.fill(account.twofa);
      await page.click('[data-testid="ocfEnterTextNextButton"]');
      await page.waitForTimeout(2000);
    }
  }

  console.log('[LOGIN] Done — URL:', page.url());
}
async function grokAuth(page) {
  await page.goto('https://accounts.x.ai/sign-in?redirect=grok-com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // اغلق الـ cookie popup اولا بـ JS
  await page.evaluate(() => {
    const reject = document.getElementById('onetrust-reject-all-handler');
    if (reject) reject.click();
  });
  await page.waitForTimeout(1000);

  // اضغط الزر بـ locator
  await page.locator('button.min-h-10[class*="--btn-bg:hsl"]').click();

  // await page.waitForURL(url => !url.includes('accounts.x.ai'), { timeout: 30000 });
  // console.log('[DONE] URL:', page.url());

  // const cookies = await page.context().cookies();
  // cookies.forEach(c => console.log(`  ${c.name}=${c.value.substring(0, 40)} [${c.domain}]`));
}
// بعد grokAuth أضف هاد
async function authorizeApp(page) {
  console.log('[OAUTH] Waiting for Authorize app button...');
  
  const btn = await page.waitForSelector(
    '[data-testid="OAuth_Consent_Button"]',
    { state: 'visible', timeout: 15000 }
  );

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
    btn.click()
  ]);

  console.log('[OAUTH] Done — URL:', page.url());
}
(async () => {
  console.log('[START] Launching browser...');
  const browser = await chromium.launch({ headless: false });
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

  // Step 1: verify auth
  const isValid = await verifyAuth(page);

  // Step 2: login manually if needed
  if (!isValid) {
    console.log('[AUTH] Token invalid — trying manual login...');
    await loginManual(page, account);
    const recheck = await verifyAuth(page);
    if (!recheck) throw new Error('[AUTH] Login failed');
  }

  // Step 3: Grok OAuth
  await grokAuth(page);
  // Step 4: Authorize app
  await authorizeApp(page);

  const fs = require('fs');

    // بعد ما يوصل grok.com
    await page.waitForLoadState('domcontentloaded');

    const cookies = await page.context().cookies();

    const sso = cookies.find(c => c.name === 'sso' && c.domain.includes('grok.com'));

    if (sso) {
      const firstPart = sso.value.split('.')[0];
      console.log('[SSO HEADER]', firstPart);
      require('fs').writeFileSync('sso.txt', firstPart);
    }

  console.log('[DONE] All steps completed — keeping browser open for 30s...');
  await page.waitForTimeout(30000);
  await browser.close();
})();