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
  requiresAuth: false,
  stickySession: true, // keep same IP across requests (for login persistence)
};

export async function handler({ page }, question, { email, password }) {
  // Wait for page to settle
  await page.waitForTimeout(3000);

  // Handle error pages ("Oops, an error occurred!" / "Operation timed out")
  const errorHeading = page.locator('h1, h2').filter({ hasText: /error occurred|something went wrong/i }).first();
  const tryAgainBtn = page.locator('button', { hasText: 'Try again' });
  if (await errorHeading.isVisible().catch(() => false)) {
    console.log('[ChatGPT] Error page detected, clicking Try again...');
    if (await tryAgainBtn.isVisible().catch(() => false)) {
      await tryAgainBtn.click();
      await page.waitForTimeout(5000);
    } else {
      // Reload the page
      await page.reload({ waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(3000);
    }
  }

  const pageTitle = await page.title();
  const pageUrl = page.url();
  console.log(`[ChatGPT] Page: ${pageTitle} — ${pageUrl}`);

  // Detect login state — look for any "Log in" or "Sign in" button/link
  const loginBtn = page.locator('button, a').filter({ hasText: /^Log\s*in$/i }).first();
  const textarea = page.locator('#prompt-textarea');

  let loggedIn;
  try {
    loggedIn = await Promise.race([
      textarea.waitFor({ timeout: 15000 }).then(async () => {
        const hasLogin = await loginBtn.isVisible().catch(() => false);
        if (hasLogin) return false;
        return true;
      }),
      loginBtn.waitFor({ timeout: 15000 }).then(() => false),
    ]);
  } catch (e) {
    // Neither textarea nor login button found — dump page for debugging
    const html = await page.content().catch(() => 'could not get page content');
    console.log(`[ChatGPT] Neither textarea nor login found. URL: ${page.url()}`);
    console.log(`[ChatGPT] Page HTML (first 3000 chars): ${html.substring(0, 3000)}`);
    throw e;
  }

  const hasCredentials = email && password;
  console.log(`[ChatGPT] Login state: ${loggedIn ? 'logged in' : 'not logged in'}, credentials: ${hasCredentials ? 'yes' : 'no'}`);

  if (!loggedIn && hasCredentials) {
    console.log('[ChatGPT] Logging in...');
    await loginBtn.click();

    const emailInput = page.locator('input[name="email"]');
    await emailInput.waitFor({ timeout: 30000 });
    await emailInput.fill(email);

    const continueBtn = page.locator('button[type="submit"]', { hasText: 'Continue' });
    await continueBtn.waitFor({ timeout: 10000 });
    await continueBtn.click();

    const passwordH1 = page.locator('h1', { hasText: 'Enter your password' });
    await passwordH1.waitFor({ timeout: 30000 });

    const passwordInput = page.locator('input[name="current-password"]');
    await passwordInput.waitFor({ timeout: 10000 });
    await passwordInput.fill(password);

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
        await codeInput.fill(code);
        await page.locator('button', { hasText: 'Continue' }).click();
        console.log('[ChatGPT] Submitted TOTP code');
        await textarea.waitFor({ timeout: 60000 });
      } else {
        console.log('[ChatGPT] *** Enter code via VNC at http://localhost:6080/vnc.html ***');
        await textarea.waitFor({ timeout: 300000 });
      }
    }
    console.log('[ChatGPT] Login completed');
  } else if (!loggedIn && !hasCredentials) {
    console.log('[ChatGPT] No credentials, using anonymous mode');
    await textarea.waitFor({ timeout: 30000 });
  } else {
    console.log('[ChatGPT] Reusing session');
  }

  // Dismiss any popup with a close button (e.g. announcements, upsells)
  try {
    const closeBtn = page.locator('[data-testid="close-button"]');
    await closeBtn.waitFor({ timeout: 3000 });
    await closeBtn.click();
    console.log('[ChatGPT] Dismissed popup');
  } catch {}

  // Temporary chat (only available when logged in)
  const tempChatBtn = page.locator('button[aria-label="Turn on temporary chat"]');
  if (await tempChatBtn.isVisible().catch(() => false)) {
    await tempChatBtn.click();

    // Dismiss the "Temporary Chat" info dialog if it appears
    const tempChatDialog = page.locator('div[role="dialog"] button.btn-primary', { hasText: 'Continue' });
    try {
      await tempChatDialog.waitFor({ timeout: 5000 });
      await tempChatDialog.click();
      console.log('[ChatGPT] Dismissed temporary chat dialog');
    } catch {}
  }

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

  // Extract response — try clipboard first, fall back to DOM text
  let answer;
  try {
    const copyBtn = page.locator('button[aria-label="Copy response"]').first();
    await copyBtn.waitFor({ timeout: 30000 });
    await copyBtn.click();
    answer = await page.evaluate(() => navigator.clipboard.readText());
  } catch (e) {
    console.log(`[ChatGPT] Clipboard failed (${e.message.substring(0, 50)}), extracting from DOM`);
    answer = await page.locator('div[data-message-author-role="assistant"]').last().innerText();
  }
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
