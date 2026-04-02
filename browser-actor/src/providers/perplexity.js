// Perplexity provider — no login required

import { log } from 'apify';

export const config = {
  requiresAuth: false,
};

export async function handler({ page }, question) {
  // Wait for input
  const input = page.locator('#ask-input');
  await input.waitFor({ timeout: 30000 });
  log.info('[Perplexity] Page loaded');

  // Dismiss any popups that appeared after page load
  try {
    const closeBtn = page.locator('button[aria-label="Close"], button[aria-label="close"]').first();
    await closeBtn.waitFor({ timeout: 3000 });
    await closeBtn.click();
    log.info('[Perplexity] Dismissed popup');
    await page.waitForTimeout(500);
  } catch {}

  // Ask
  await input.fill(question);
  const submitBtn = page.locator('button[aria-label="Submit"]');
  await submitBtn.waitFor({ timeout: 10000 });
  await submitBtn.click();
  log.info('[Perplexity] Submitted question');

  // Wait for response — copy button appears when done
  const copyBtn = page.locator('button[aria-label="Copy"]').first();
  await copyBtn.waitFor({ timeout: 120000 });
  await page.waitForTimeout(2000); // let it finish rendering

  // Intercept clipboard write — patch writeText before clicking copy
  await page.evaluate(() => {
    window.__capturedClipboard = '';
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (text) => { window.__capturedClipboard = text; return orig(text); };
  });
  await copyBtn.click();
  await page.waitForTimeout(500);

  // Try intercepted value first, then readText as fallback
  let answer = await page.evaluate(() => window.__capturedClipboard);
  if (!answer) {
    try {
      answer = await page.evaluate(() => navigator.clipboard.readText());
    } catch {}
  }
  log.info(`[Perplexity] Response: ${answer.length} chars`);

  // Sources
  const sources = [];
  try {
    const sourcesBtn = page.locator('button').filter({ hasText: /sources/i }).first();
    await sourcesBtn.waitFor({ timeout: 10000 });
    await sourcesBtn.click();
    await page.waitForTimeout(1000);

    const sidebar = page.locator('div.group\\/search-side-content');
    await sidebar.waitFor({ timeout: 10000 });

    const sourceLinks = sidebar.locator('a[href]');
    const count = await sourceLinks.count();
    for (let i = 0; i < count; i++) {
      const link = sourceLinks.nth(i);
      const href = await link.getAttribute('href');
      const title = await link.textContent().catch(() => '');
      if (href && href.startsWith('http')) {
        sources.push({ href, title: title?.trim() || '' });
      }
    }
    log.info(`[Perplexity] Found ${sources.length} sources`);
  } catch (e) {
    log.info('[Perplexity] No sources:', { message: e.message });
  }

  return { question, answer: answer.trim(), sources, url: page.url(), timestamp: new Date().toISOString() };
}

export const url = 'https://www.perplexity.ai';
