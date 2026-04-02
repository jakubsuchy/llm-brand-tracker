// ChatGPT provider — login optional (email/password + optional TOTP)

import { log } from 'apify';

let _otpauth = null;
try { _otpauth = await import('otpauth'); } catch {}

function generateTOTP(totpSecret) {
  if (!totpSecret || !_otpauth) return null;
  try {
    const { TOTP, Secret, URI } = _otpauth;
    if (totpSecret.startsWith('otpauth://')) return URI.parse(totpSecret).generate();
    const cleaned = totpSecret.replace(/[\s-]/g, '').toUpperCase();
    return new TOTP({ secret: Secret.fromBase32(cleaned), digits: 6, period: 30 }).generate();
  } catch (err) {
    log.error('[ChatGPT] TOTP failed:', { message: err.message });
    return null;
  }
}

export const config = {
  requiresAuth: false,
};

export async function handler({ page }, question, { email, password, totpSecret }) {
  const textarea = page.locator('#prompt-textarea');
  const loginBtn = page.locator('button.btn-primary', { hasText: 'Log in' });

  const loggedIn = await Promise.race([
    textarea.waitFor({ timeout: 15000 }).then(() => true),
    loginBtn.waitFor({ timeout: 15000 }).then(() => false),
  ]);

  if (!loggedIn && email) {
    log.info('[ChatGPT] Logging in...');
    await loginBtn.click();

    const emailInput = page.locator('input[name="email"]');
    await emailInput.waitFor({ timeout: 30000 });
    await emailInput.pressSequentially(email, { delay: 80 });

    const continueBtn = page.locator('button[type="submit"]', { hasText: 'Continue' });
    await continueBtn.waitFor({ timeout: 10000 });
    await continueBtn.click();

    const passwordH1 = page.locator('h1', { hasText: 'Enter your password' });
    await passwordH1.waitFor({ timeout: 30000 });

    const passwordInput = page.locator('input[name="current-password"]');
    await passwordInput.waitFor({ timeout: 10000 });
    await passwordInput.pressSequentially(password, { delay: 80 });

    const passwordContinue = page.locator('button', { hasText: 'Continue' });
    await passwordContinue.click();

    // Check for TOTP verification
    const verifyH1 = page.locator('h1', { hasText: 'Verify your identity' });
    const afterPassword = await Promise.race([
      textarea.waitFor({ timeout: 60000 }).then(() => 'logged-in'),
      verifyH1.waitFor({ timeout: 60000 }).then(() => 'needs-verification'),
    ]);

    if (afterPassword === 'needs-verification') {
      const codeInput = page.locator('input[name="code"]');
      await codeInput.waitFor({ timeout: 10000 });
      const code = generateTOTP(totpSecret);
      if (code) {
        await codeInput.pressSequentially(code, { delay: 50 });
        await page.locator('button', { hasText: 'Continue' }).click();
        log.info('[ChatGPT] Submitted TOTP code');
        await textarea.waitFor({ timeout: 60000 });
      } else {
        throw new Error('TOTP verification required but no totpSecret provided. Cannot proceed without manual intervention.');
      }
    }
    log.info('[ChatGPT] Login completed');
  } else if (!loggedIn && !email) {
    log.info('[ChatGPT] No credentials provided, continuing without login');
    // Wait for textarea to appear (guest/anonymous mode)
    await textarea.waitFor({ timeout: 30000 });
  } else {
    log.info('[ChatGPT] Reusing session');
  }

  // Temporary chat
  const tempChatBtn = page.locator('button[aria-label="Turn on temporary chat"]');
  await tempChatBtn.waitFor({ timeout: 15000 });
  await tempChatBtn.click();
  await page.locator('h1', { hasText: 'Temporary Chat' }).first().waitFor({ timeout: 15000 });

  // Ask
  await textarea.waitFor({ timeout: 10000 });
  await textarea.fill(question);
  await page.locator('#composer-submit-button').click();
  log.info('[ChatGPT] Submitted question');

  // Wait for response
  await page.locator('div[data-message-author-role="assistant"]').first().waitFor({ timeout: 60000 });
  const stopBtn = page.locator('button[aria-label="Stop streaming"]');
  await stopBtn.waitFor({ timeout: 30000 }).catch(() => {});
  await stopBtn.waitFor({ state: 'hidden', timeout: 120000 });

  // Intercept clipboard write — patch writeText before clicking copy
  await page.evaluate(() => {
    window.__capturedClipboard = '';
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (text) => { window.__capturedClipboard = text; return orig(text); };
  });
  const copyBtn = page.locator('button[aria-label="Copy response"]').first();
  await copyBtn.waitFor({ timeout: 30000 });
  await copyBtn.click();
  await page.waitForTimeout(500);

  // Try intercepted value first, then readText as fallback
  let answer = await page.evaluate(() => window.__capturedClipboard);
  if (!answer) {
    try {
      answer = await page.evaluate(() => navigator.clipboard.readText());
    } catch {}
  }
  log.info(`[ChatGPT] Response: ${answer.length} chars`);

  // Sources
  const sources = [];
  try {
    const sourcesBtn = page.locator('button[aria-label="Sources"]').first();
    await sourcesBtn.waitFor({ timeout: 10000 });
    await sourcesBtn.click();
    const sourcesSection = page.locator('section[aria-label="Sources"]');
    await sourcesSection.waitFor({ timeout: 10000 });
    const sourceLinks = sourcesSection.locator('ul li a');
    const count = await sourceLinks.count();
    for (let i = 0; i < count; i++) {
      const link = sourceLinks.nth(i);
      const href = await link.getAttribute('href');
      const titleDiv = link.locator('div.break-words');
      const title = await titleDiv.textContent().catch(() => '');
      if (href) sources.push({ href, title: title?.trim() || '' });
    }
    log.info(`[ChatGPT] Found ${count} sources`);
  } catch {
    log.info('[ChatGPT] No sources');
  }

  return { question, answer: answer.trim(), sources, url: page.url(), timestamp: new Date().toISOString() };
}

export const url = 'https://chatgpt.com';
