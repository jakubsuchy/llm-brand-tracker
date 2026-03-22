// ChatGPT provider — requires login with email/password + optional TOTP

let _otpauth = null;
try { _otpauth = await import('otpauth'); } catch {}

function generateTOTP() {
  const raw = process.env.CHATGPT_TOTP_SECRET;
  if (!raw || !_otpauth) return null;
  try {
    const { TOTP, Secret, URI } = _otpauth;
    if (raw.startsWith('otpauth://')) return URI.parse(raw).generate();
    const cleaned = raw.replace(/[\s-]/g, '').toUpperCase();
    return new TOTP({ secret: Secret.fromBase32(cleaned), digits: 6, period: 30 }).generate();
  } catch (err) {
    console.error('[ChatGPT] TOTP failed:', err.message);
    return null;
  }
}

export const config = {
  requiresAuth: true,
};

export async function handler({ page }, question, { email, password }) {
  const textarea = page.locator('#prompt-textarea');
  const loginBtn = page.locator('button.btn-primary', { hasText: 'Log in' });

  const loggedIn = await Promise.race([
    textarea.waitFor({ timeout: 15000 }).then(() => true),
    loginBtn.waitFor({ timeout: 15000 }).then(() => false),
  ]);

  if (!loggedIn) {
    console.log('[ChatGPT] Logging in...');
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
      const code = generateTOTP();
      if (code) {
        await codeInput.pressSequentially(code, { delay: 50 });
        await page.locator('button', { hasText: 'Continue' }).click();
        console.log('[ChatGPT] Submitted TOTP code');
        await textarea.waitFor({ timeout: 60000 });
      } else {
        console.log('[ChatGPT] *** Enter code via VNC at http://localhost:6080/vnc.html ***');
        await textarea.waitFor({ timeout: 300000 });
      }
    }
    console.log('[ChatGPT] Login completed');
  } else {
    console.log('[ChatGPT] Reusing session');
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
  console.log('[ChatGPT] Submitted question');

  // Wait for response
  await page.locator('div[data-message-author-role="assistant"]').first().waitFor({ timeout: 60000 });
  const stopBtn = page.locator('button[aria-label="Stop streaming"]');
  await stopBtn.waitFor({ timeout: 30000 }).catch(() => {});
  await stopBtn.waitFor({ state: 'hidden', timeout: 120000 });

  // Copy via clipboard
  const copyBtn = page.locator('button[aria-label="Copy response"]').first();
  await copyBtn.waitFor({ timeout: 30000 });
  await copyBtn.click();
  const answer = await page.evaluate(() => navigator.clipboard.readText());
  console.log(`[ChatGPT] Response: ${answer.length} chars`);

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
    console.log(`[ChatGPT] Found ${count} sources`);
  } catch {
    console.log('[ChatGPT] No sources');
  }

  return { question, answer: answer.trim(), sources, url: page.url(), timestamp: new Date().toISOString() };
}

export const url = 'https://chatgpt.com';
