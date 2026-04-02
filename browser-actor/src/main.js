// Apify SDK - toolkit for building Apify Actors (Read more at https://docs.apify.com/sdk/js/)
import http from 'http';
import { Actor, log } from 'apify';
// Crawlee - web scraping and browser automation library (Read more at https://crawlee.dev)
import { PlaywrightCrawler, Configuration } from 'crawlee';
import { firefox } from 'playwright-core';
import { launchOptions } from 'camoufox-js';
import { solveTurnstile } from './turnstile.js';
import { startScreenshots, stopScreenshots } from './screenshot.js';
// Import providers
import * as chatgptProvider from './providers/chatgpt.js';
import * as perplexityProvider from './providers/perplexity.js';

const providers = { chatgpt: chatgptProvider, perplexity: perplexityProvider };

async function runPrompt(provider, question, credentials, proxyConfiguration) {
  const camoufoxOpts = await launchOptions({
    headless: false,
    humanize: true,
  });

  const config = new Configuration({ persistStorage: false });
  let result = null;

  const crawler = new PlaywrightCrawler({
    launchContext: {
      launcher: firefox,
      launchOptions: {
        ...camoufoxOpts,
        firefoxUserPrefs: {
          ...camoufoxOpts.firefoxUserPrefs,
          'dom.events.asyncClipboard.readText': true,
          'dom.events.testing.asyncClipboard': true,
        },
      },
    },
    postNavigationHooks: [
      async ({ handleCloudflareChallenge, page }) => {
        startScreenshots(page);
        await handleCloudflareChallenge();
        await solveTurnstile(page);
      },
    ],
    proxyConfiguration,
    browserPoolOptions: { useFingerprints: false },
    navigationTimeoutSecs: 120,
    requestHandlerTimeoutSecs: 600,
    async requestHandler(ctx) {
      result = await provider.handler(ctx, question, credentials || {});
    },
  }, config);

  await crawler.run([provider.url]);
  stopScreenshots();
  await crawler.teardown();

  if (!result) throw new Error(`${provider === chatgptProvider ? 'ChatGPT' : 'Perplexity'} returned no result`);
  return result;
}

function parseInput(input) {
  let prompts = input.prompts;
  if (typeof prompts === 'string') prompts = [prompts];
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('Input "prompts" must be a non-empty array of strings.');
  }

  const providerName = input.provider || 'perplexity';
  const provider = providers[providerName];
  if (!provider) {
    throw new Error(`Unknown provider "${providerName}". Available: ${Object.keys(providers).join(', ')}`);
  }

  const credentials = {
    email: input.chatgptEmail || null,
    password: input.chatgptPassword || null,
    totpSecret: input.chatgptTotpSecret || null,
  };

  return { prompts, providerName, provider, credentials };
}

// ─── Standard batch mode ─────────────────────────────────────────

async function runBatchMode() {
  const input = await Actor.getInput();

  if (!input) {
    await Actor.fail('No input provided.');
    return;
  }

  const { prompts, providerName, provider, credentials } = parseInput(input);

  const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
  });

  log.info(`Starting with provider "${providerName}", ${prompts.length} prompt(s)`);

  let successCount = 0;

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    log.info(`Processing prompt ${i + 1}/${prompts.length}: "${prompt.substring(0, 80)}"`);

    const startTime = Date.now();

    try {
      const result = await runPrompt(provider, prompt, credentials, proxyConfiguration);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      await Actor.pushData({ ...result, provider: providerName });
      successCount++;

      log.info(`Completed ${i + 1}/${prompts.length} in ${elapsed}s: ${result.answer?.length || 0} chars, ${result.sources?.length || 0} sources`);
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log.error(`Failed prompt ${i + 1}/${prompts.length} after ${elapsed}s: ${err.message}`);

      await Actor.pushData({
        question: prompt,
        answer: null,
        error: err.message,
        sources: [],
        provider: providerName,
        url: null,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (successCount === 0) {
    await Actor.fail(`All ${prompts.length} prompt(s) failed.`);
  } else {
    log.info(`Finished: ${successCount}/${prompts.length} prompt(s) succeeded.`);
  }
}

// ─── Standby server mode ─────────────────────────────────────────

async function runStandbyMode() {
  let proxyConfiguration;
  try {
    proxyConfiguration = await Actor.createProxyConfiguration({
      groups: ['RESIDENTIAL'],
      countryCode: 'US',
    });
  } catch {
    log.warning('Could not create proxy configuration, running without proxy');
  }

  let busy = false;

  const server = http.createServer(async (req, res) => {
    // Readiness probe
    if (req.headers['x-apify-container-server-readiness-probe']) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready', busy, providers: Object.keys(providers) }));
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', busy, providers: Object.keys(providers) }));
      return;
    }

    // Only accept POST for prompts
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Use POST with { "prompts": [...], "provider": "perplexity" }' }));
      return;
    }

    if (busy) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Browser is busy with another request. Try again shortly.' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const input = JSON.parse(body);
        const { prompts, providerName, provider, credentials } = parseInput(input);

        busy = true;
        log.info(`[Standby] Received ${prompts.length} prompt(s) for ${providerName}`);

        const results = [];

        for (let i = 0; i < prompts.length; i++) {
          const prompt = prompts[i];
          const startTime = Date.now();
          log.info(`[Standby] Processing prompt ${i + 1}/${prompts.length}: "${prompt.substring(0, 80)}"`);

          try {
            const result = await runPrompt(provider, prompt, credentials, proxyConfiguration);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const item = { ...result, provider: providerName };
            results.push(item);
            await Actor.pushData(item);
            log.info(`[Standby] Completed ${i + 1}/${prompts.length} in ${elapsed}s`);
          } catch (err) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            log.error(`[Standby] Failed prompt ${i + 1}/${prompts.length} after ${elapsed}s: ${err.message}`);
            const errorItem = {
              question: prompt,
              answer: null,
              error: err.message,
              sources: [],
              provider: providerName,
              url: null,
              timestamp: new Date().toISOString(),
            };
            results.push(errorItem);
            await Actor.pushData(errorItem);
          }
        }

        busy = false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(results));
      } catch (err) {
        busy = false;
        log.error(`[Standby] Error: ${err.message}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  const port = Actor.config.get('standbyPort');
  server.listen(port, () => {
    log.info(`[Standby] Server listening on port ${port}`);
    log.info(`[Standby] POST / with { "prompts": [...], "provider": "perplexity" }`);
  });
}

// ─── Entry point ─────────────────────────────────────────────────

await Actor.init();

try {
  if (Actor.config.get('metaOrigin') === 'STANDBY') {
    log.info('Starting in Standby mode (HTTP server)');
    await runStandbyMode();
  } else {
    log.info('Starting in batch mode');
    await runBatchMode();
    await Actor.exit();
  }
} catch (err) {
  log.error('Actor failed with unexpected error', { message: err.message, stack: err.stack });
  await Actor.fail(err.message);
}
