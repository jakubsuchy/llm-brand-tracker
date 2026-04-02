// Universal Cloudflare Turnstile solver
// Detects Turnstile challenge pages, waits for the dynamically-injected
// challenge iframe, finds the checkbox, clicks it, and waits for redirect.

import { log } from 'apify';

/**
 * Waits for a Cloudflare challenge iframe to appear in the page's frame tree.
 * The challenge script at /cdn-cgi/challenge-platform/ injects the iframe dynamically.
 */
async function waitForTurnstileFrame(page, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frames = page.frames();
    const cfFrame = frames.find(f =>
      f.url().includes('challenges.cloudflare.com') ||
      f.url().includes('cf-chl-widget') ||
      f.url().includes('cdn-cgi/challenge-platform')
    );
    if (cfFrame) {
      log.info(`[Turnstile] Found challenge frame: ${cfFrame.url().substring(0, 100)}`);
      return cfFrame;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

/**
 * Detects if the current page is a Cloudflare challenge.
 */
async function isChallengePresent(page) {
  return page.evaluate(() => {
    // Only detect actual full-page Cloudflare challenge pages, not normal pages with CF scripts
    const title = document.title || '';
    const isChallengePage = title === 'Just a moment...';
    const bodyText = document.body?.innerText || '';
    const hasVerifyText = bodyText.includes('Verify you are human');
    const hasSecurityText = bodyText.includes('Performing security verification');
    const hasChallengeElement = !!document.querySelector('#challenge-running, #challenge-stage, .cf-turnstile');
    return isChallengePage || hasVerifyText || hasSecurityText || hasChallengeElement;
  });
}

/**
 * Attempts to solve a Cloudflare Turnstile challenge on the page.
 * Returns true if solved (or no challenge found), false if failed.
 *
 * @param {import('playwright-core').Page} page
 * @param {object} [options]
 * @param {number} [options.maxAttempts=5] - Max attempts to solve after finding checkbox
 * @param {number} [options.frameTimeoutMs=30000] - How long to wait for the challenge iframe
 * @param {number} [options.solveWaitMs=5000] - Wait after click for verification/redirect
 */
export async function solveTurnstile(page, options = {}) {
  const {
    maxAttempts = 5,
    frameTimeoutMs = 30000,
    solveWaitMs = 5000,
  } = options;

  if (!(await isChallengePresent(page))) return true;

  log.info('[Turnstile] Challenge detected, waiting for challenge iframe...');

  // Wait for the dynamically-injected iframe
  const frame = await waitForTurnstileFrame(page, frameTimeoutMs);

  if (!frame) {
    // No iframe found — might be a non-interactive challenge that auto-resolves
    log.info('[Turnstile] No challenge iframe found, waiting for auto-resolve...');
    await page.waitForTimeout(10000);
    if (!(await isChallengePresent(page))) {
      log.info('[Turnstile] Challenge auto-resolved!');
      return true;
    }
    log.warning('[Turnstile] Challenge persists but no interactive iframe found');
    return false;
  }

  // Wait for checkbox to become visible inside the iframe
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check if challenge already resolved
    if (!(await isChallengePresent(page))) {
      log.info('[Turnstile] Challenge resolved!');
      return true;
    }

    try {
      // Try clicking inside the challenge frame — body click often suffices for Turnstile
      const selectors = ['input[type="checkbox"]', 'body'];
      for (const sel of selectors) {
        const el = frame.locator(sel).first();
        const isVisible = await el.isVisible({ timeout: 3000 }).catch(() => false);
        if (!isVisible) continue;

        log.info(`[Turnstile] Clicking "${sel}" in challenge frame (attempt ${attempt})...`);
        await el.click({ timeout: 5000, force: true });
        await page.waitForTimeout(solveWaitMs);

        // Check if clicking resolved the challenge
        if (!(await isChallengePresent(page))) {
          log.info('[Turnstile] Challenge solved!');
          return true;
        }

        // Also check if the turnstile response token was populated
        const hasToken = await page.evaluate(() => {
          const input = document.querySelector('input[name="cf-turnstile-response"]');
          return input && input.value && input.value.length > 0;
        });
        if (hasToken) {
          log.info('[Turnstile] Token populated, waiting for redirect...');
          await page.waitForTimeout(5000);
          return true;
        }
      }
    } catch (e) {
      log.warning(`[Turnstile] Attempt ${attempt} failed: ${e.message}`);
    }

    await page.waitForTimeout(2000);
  }

  log.warning('[Turnstile] Could not solve challenge after all attempts');
  return false;
}
