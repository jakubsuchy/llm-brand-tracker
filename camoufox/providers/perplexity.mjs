// Perplexity provider — no login required

export const config = {
  requiresAuth: false,
};

export async function handler({ page }, question) {
  // Wait for input — Perplexity uses a Lexical contenteditable div, not a real input
  const input = page.locator('#ask-input');
  await input.waitFor({ timeout: 30000 });
  console.log('[Perplexity] Page loaded');

  // Click to focus, then type character-by-character (fill() doesn't work on Lexical editors)
  await input.click();
  await page.waitForTimeout(300);
  await page.keyboard.type(question, { delay: 20 });
  await page.waitForTimeout(500);

  // Submit — try aria-label first, fall back to Enter key
  const submitBtn = page.locator('button[aria-label="Submit"]');
  try {
    await submitBtn.waitFor({ timeout: 5000 });
    await submitBtn.click();
  } catch {
    console.log('[Perplexity] Submit button not found, pressing Enter');
    await page.keyboard.press('Enter');
  }
  console.log('[Perplexity] Submitted question');

  // Wait for response — copy button appears when done
  const copyBtn = page.locator('button[aria-label="Copy"]').first();
  await copyBtn.waitFor({ timeout: 120000 });
  await page.waitForTimeout(2000); // let it finish rendering

  // Copy via clipboard
  await copyBtn.click();
  const answer = await page.evaluate(() => navigator.clipboard.readText());
  console.log(`[Perplexity] Response: ${answer.length} chars`);

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
    console.log(`[Perplexity] Found ${sources.length} sources`);
  } catch (e) {
    console.log('[Perplexity] No sources:', e.message);
  }

  return { question, answer: answer.trim(), sources, url: page.url(), timestamp: new Date().toISOString() };
}

export const url = 'https://www.perplexity.ai';
