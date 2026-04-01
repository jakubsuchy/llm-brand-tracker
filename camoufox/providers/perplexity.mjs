// Perplexity provider — no login required

export const config = {
  requiresAuth: false,
};

export async function handler({ page }, question) {
  // Wait for input — Perplexity uses a Lexical contenteditable div, not a real input
  const input = page.locator('#ask-input');
  try {
    await input.waitFor({ timeout: 30000 });
  } catch (e) {
    // Dump page HTML for debugging
    const html = await page.content().catch(() => 'could not get page content');
    console.log(`[Perplexity] #ask-input not found. URL: ${page.url()}`);
    console.log(`[Perplexity] Page HTML (first 3000 chars): ${html.substring(0, 3000)}`);
    throw e;
  }
  console.log('[Perplexity] Page loaded');

  // Dismiss popups — Google sign-in prompt, Perplexity sign-in modal, etc.
  for (let i = 0; i < 3; i++) {
    let dismissed = false;
    // Close any button with aria-label="Close" (covers both popups)
    for (const btn of await page.locator('button[aria-label="Close"]').all()) {
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        console.log('[Perplexity] Dismissed popup');
        dismissed = true;
        await page.waitForTimeout(500);
      }
    }
    // Also press Escape to close any modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (!dismissed) break;
  }

  // Write question to clipboard
  await page.evaluate(async (text) => {
    await navigator.clipboard.writeText(text);
  }, question);

  // Try paste up to 3 times — popups can steal focus
  let entered = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    await input.click();
    await page.waitForTimeout(300);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(800);

    entered = await input.textContent();
    console.log(`[Perplexity] Paste attempt ${attempt}: ${entered.length} chars (expected ${question.length})`);
    if (entered.length > 0) break;

    // Dismiss any new popups that appeared
    for (const btn of await page.locator('button[aria-label="Close"]').all()) {
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        console.log('[Perplexity] Dismissed popup during retry');
      }
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }

  // Final fallback: keyboard.type
  if (entered.length === 0) {
    console.log('[Perplexity] Paste failed, falling back to keyboard.type...');
    await input.click();
    await page.waitForTimeout(300);
    await page.keyboard.type(question, { delay: 30 });
    await page.waitForTimeout(500);
    entered = await input.textContent();
    console.log(`[Perplexity] keyboard.type entered ${entered.length} chars`);
  }

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

  // Extract response — try clipboard first, fall back to DOM text
  let answer;
  try {
    await copyBtn.click();
    answer = await page.evaluate(() => navigator.clipboard.readText());
  } catch (e) {
    console.log(`[Perplexity] Clipboard failed (${e.message.substring(0, 50)}), extracting from DOM`);
    answer = await page.locator('div.prose').last().innerText();
  }
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
