import http from 'http';
import { PlaywrightCrawler, Configuration } from 'crawlee';
import { firefox } from 'playwright-core';
import { launchOptions } from 'camoufox-js';
import { resolve } from 'path';
import { readdirSync } from 'fs';

const port = parseInt(process.env.CAMOUFOX_PORT || '8888');
const profileDir = resolve(process.env.BROWSER_PROFILE_PATH || '/tmp/browser-profile');
const apiKey = process.env.CAMOUFOX_API_KEY || '';

console.log(`[Camoufox] Starting on port ${port}`);
console.log(`[Camoufox] DISPLAY=${process.env.DISPLAY}`);
console.log(`[Camoufox] Profile: ${profileDir}`);
console.log(`[Camoufox] Auth: ${apiKey ? 'enabled' : 'disabled (set CAMOUFOX_API_KEY to enable)'}`);

// ─── Load providers ───────────────────────────────────────────────

const providers = {};
const providerFiles = readdirSync(new URL('./providers', import.meta.url))
  .filter(f => f.endsWith('.mjs'));

for (const file of providerFiles) {
  const name = file.replace('.mjs', '');
  const mod = await import(`./providers/${file}`);
  providers[name] = mod;
  console.log(`[Camoufox] Loaded provider: ${name} (auth: ${mod.config.requiresAuth})`);
}

// ─── Shared crawler runner ────────────────────────────────────────

let busy = false;

async function runPrompt(providerName, question, credentials) {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown provider: ${providerName}. Available: ${Object.keys(providers).join(', ')}`);

  const camoufoxOpts = await launchOptions({
    headless: false,
    humanize: true,
    user_data_dir: profileDir,
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
      userDataDir: profileDir,
    },
    postNavigationHooks: [
      async ({ handleCloudflareChallenge }) => {
        await handleCloudflareChallenge();
      },
    ],
    browserPoolOptions: { useFingerprints: false },
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 300,
    async requestHandler(ctx) {
      result = await provider.handler(ctx, question, credentials || {});
    },
  }, config);

  await crawler.run([provider.url]);
  await crawler.teardown();

  if (!result) throw new Error(`${providerName} returned no result`);
  return { ...result, provider: providerName };
}

// ─── HTTP Server ──────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', busy, providers: Object.keys(providers) }));
    return;
  }

  // Auth check — all endpoints below require the API key (if set)
  if (apiKey) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized — invalid or missing CAMOUFOX_API_KEY' }));
      return;
    }
  }

  if (req.method === 'GET' && req.url === '/providers') {
    const list = Object.entries(providers).map(([name, mod]) => ({
      name,
      requiresAuth: mod.config.requiresAuth,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ providers: list }));
    return;
  }

  if (req.method === 'POST' && req.url === '/ask') {
    if (busy) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Browser is busy with another prompt' }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { question, provider = 'chatgpt', email, password } = JSON.parse(body);
        if (!question) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'question is required' }));
          return;
        }

        const providerConfig = providers[provider]?.config;
        if (!providerConfig) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown provider: ${provider}. Available: ${Object.keys(providers).join(', ')}` }));
          return;
        }

        if (providerConfig.requiresAuth && (!email || !password)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Provider ${provider} requires email and password` }));
          return;
        }

        busy = true;
        const startTime = Date.now();
        console.log(`[Camoufox] ${provider}: "${question.substring(0, 80)}..."`);

        const result = await runPrompt(provider, question, { email, password });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Camoufox] ${provider} done in ${elapsed}s — ${result.answer?.length || 0} chars, ${result.sources?.length || 0} sources`);

        busy = false;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        busy = false;
        console.error('[Camoufox] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[Camoufox] Ready on port ${port}`);
  console.log(`[Camoufox] POST /ask { question, provider?, email?, password? }`);
  console.log(`[Camoufox] Providers: ${Object.keys(providers).join(', ')}`);
  console.log(`[Camoufox] VNC :5900 | noVNC http://localhost:6080/vnc.html`);
});
