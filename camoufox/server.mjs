import http from 'http';
import { resolve } from 'path';
import { readdirSync } from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { Camoufox } from 'camoufox-js';

// Import crawlee's Cloudflare handler (exports field blocks subpath imports, so use require)
let handleCloudflareChallenge;
try {
  const _require = createRequire(import.meta.url);
  const mod = _require('/app/node_modules/@crawlee/playwright/internals/utils/playwright-utils.js');
  handleCloudflareChallenge = mod.playwrightUtils.handleCloudflareChallenge;
  console.log('[Camoufox] Loaded Crawlee Cloudflare handler');
} catch (e) {
  console.log(`[Camoufox] Could not load Crawlee Cloudflare handler: ${e.message}`);
  handleCloudflareChallenge = async () => {};
}

const port = parseInt(process.env.CAMOUFOX_PORT || '8888');
const profileDir = resolve(process.env.BROWSER_PROFILE_PATH || '/tmp/browser-profile');
const apiKey = process.env.CAMOUFOX_API_KEY || '';
const apifyProxyPassword = process.env.APIFY_PROXY_PASSWORD || '';
const apifyProxyCountry = process.env.APIFY_PROXY_COUNTRY || 'US';

// Stable session ID for the container lifetime — same residential IP across all requests.
// Restarting the container rotates the IP.
const proxySessionId = apifyProxyPassword ? `camoufox${Date.now()}` : '';

console.log(`[Camoufox] Starting on port ${port}`);
console.log(`[Camoufox] DISPLAY=${process.env.DISPLAY}`);
console.log(`[Camoufox] Profile: ${profileDir}`);
console.log(`[Camoufox] Auth: ${apiKey ? 'enabled' : 'disabled'}`);
console.log(`[Camoufox] Proxy: ${apifyProxyPassword ? `Apify residential (country: ${apifyProxyCountry}, session: ${proxySessionId})` : 'disabled'}`);

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

// ─── Browser helpers ──────────────────────────────────────────────

function buildBrowserOpts() {
  const opts = {
    headless: false,
    geoip: !!apifyProxyPassword,
  };
  if (apifyProxyPassword) {
    opts.proxy = {
      server: 'http://proxy.apify.com:8000',
      username: `groups-RESIDENTIAL,session-${proxySessionId},country-${apifyProxyCountry}`,
      password: apifyProxyPassword,
    };
  }
  return opts;
}

// ─── Startup self-test ────────────────────────────────────────────

async function startupTest() {
  console.log('[Camoufox] Running startup self-test...');
  console.log('[Camoufox] DISPLAY at test time:', process.env.DISPLAY);
  const opts = buildBrowserOpts();
  console.log('[Camoufox] Browser opts:', JSON.stringify({ ...opts, proxy: opts.proxy ? { ...opts.proxy, password: '***' } : undefined }, null, 2));

  // Network connectivity checks
  try {
    const directResp = await fetch('https://httpbin.org/ip', { signal: AbortSignal.timeout(10000) });
    console.log(`[Camoufox] Direct fetch (no proxy): ${(await directResp.text()).trim()}`);
  } catch (e) {
    console.log(`[Camoufox] Direct fetch FAILED: ${e.message}`);
  }

  if (apifyProxyPassword) {
    try {
      const username = `groups-RESIDENTIAL,session-${proxySessionId},country-${apifyProxyCountry}`;
      const curlResult = execSync(
        `curl -s --max-time 10 -x "http://proxy.apify.com:8000" -U "${username}:${apifyProxyPassword}" https://httpbin.org/ip`,
        { encoding: 'utf8' }
      );
      console.log(`[Camoufox] Curl via proxy: ${curlResult.trim()}`);
    } catch (e) {
      console.log(`[Camoufox] Curl via proxy FAILED: ${e.message}`);
    }

    try {
      const dns = execSync('getent hosts proxy.apify.com', { encoding: 'utf8' });
      console.log(`[Camoufox] DNS proxy.apify.com: ${dns.trim()}`);
    } catch (e) {
      console.log(`[Camoufox] DNS lookup FAILED: ${e.message}`);
    }
  }

  // Browser test
  let browser;
  try {
    browser = await Camoufox(opts);
    console.log('[Camoufox] Browser launched OK');

    const page = await browser.newPage();
    console.log('[Camoufox] Page created OK');

    const resp = await page.goto('https://httpbin.org/ip', { timeout: 30000 });
    const body = await resp.text();
    console.log(`[Camoufox] Self-test PASSED — IP: ${body.trim()}`);
  } catch (err) {
    console.error(`[Camoufox] Self-test FAILED: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

await startupTest();

// ─── Browser runner ───────────────────────────────────────────────

let busy = false;

async function runPrompt(providerName, question, credentials) {
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown provider: ${providerName}. Available: ${Object.keys(providers).join(', ')}`);

  console.log(`[Camoufox] Launching browser for ${providerName}...`);
  const browser = await Camoufox(buildBrowserOpts());
  const page = await browser.newPage();

  let result = null;
  try {
    console.log(`[Camoufox] Navigating to ${provider.url}...`);
    await page.goto(provider.url, { waitUntil: 'load', timeout: 60000 });

    // Handle Cloudflare challenge if present
    try {
      await handleCloudflareChallenge(page, provider.url, null, { verbose: true });
    } catch (e) {
      console.log(`[Camoufox] Cloudflare: ${e.message}`);
    }

    console.log(`[Camoufox] Page loaded, running handler...`);

    result = await Promise.race([
      provider.handler({ page }, question, credentials || {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Handler timeout (300s)')), 300000)),
    ]);
  } finally {
    await browser.close().catch(() => {});
  }

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
