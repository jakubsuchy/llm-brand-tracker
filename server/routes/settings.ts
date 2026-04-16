import type { Express } from "express";
import { requireRole, DEFAULT_MODELS_CONFIG, DEFAULT_BLOCKLIST, getCurrentBrandName, saveBrandName } from "./helpers";
import { storage } from "../storage";

export function registerSettingsRoutes(app: Express) {
  // browser-status is a computed probe, kept as special GET
  app.get("/api/settings/browser-status", requireRole("admin"), async (req, res) => {
    // #swagger.tags = ['Settings']
    try {
      const hasApifyToken = !!process.env.APIFY_TOKEN;
      let localUp = false;
      try {
        const url = process.env.BROWSER_ACTOR_URL || 'http://browser-actor:8888';
        const res2 = await fetch(`${url}/`, { signal: AbortSignal.timeout(3000) });
        localUp = res2.ok;
      } catch {}
      const savedMode = await storage.getSetting('browserMode');
      let mode: string;
      if (savedMode === 'local' || savedMode === 'cloud') {
        mode = savedMode;
      } else {
        mode = hasApifyToken ? 'cloud' : (localUp ? 'local' : 'none');
      }
      res.json({ mode, hasApifyToken, localContainerUp: localUp });
    } catch {
      res.json({ mode: 'none', hasApifyToken: false, localContainerUp: false });
    }
  });

  // Unified GET — some keys are public (no role), others require admin
  const PUBLIC_SETTINGS_KEYS = new Set(['brand', 'models', 'analysis-schedule']);

  app.get("/api/settings/:key", async (req, res) => {
    // #swagger.tags = ['Settings']
    const key = req.params.key;
    const { getSetting } = await import('../services/settings');

    // Role check for non-public keys
    if (!PUBLIC_SETTINGS_KEYS.has(key)) {
      const userRoles: string[] = (req as any).user?.roles || [];
      if (!userRoles.includes('admin')) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
    }

    try {
      switch (key) {
        case 'brand': {
          const brandUrl = await storage.getSetting('brandUrl');
          const brandName = await storage.getSetting('brandName');
          return res.json({ brandUrl, brandName });
        }
        case 'models': {
          const raw = await storage.getSetting('modelsConfig');
          const saved = raw ? JSON.parse(raw) : {};
          return res.json({ ...DEFAULT_MODELS_CONFIG, ...saved });
        }
        case 'openai-key':
          return res.json({ hasKey: !!(await getSetting('openaiApiKey')) });
        case 'anthropic-key':
          return res.json({ hasKey: !!(await getSetting('anthropicApiKey')) });
        case 'apify-token':
          return res.json({ hasToken: !!(await getSetting('apifyToken')) });
        case 'analysis-llm':
          return res.json({ llm: (await storage.getSetting('analysisLlm')) || 'openai' });
        case 'analysis-schedule': {
          const { getNextRunTime } = await import('../services/scheduler');
          const frequency = (await getSetting('analysisSchedule')) || 'manual';
          const nextRun = getNextRunTime();
          return res.json({ frequency, nextRun: nextRun?.toISOString() ?? null });
        }
        case 'browser-mode':
          return res.json({ mode: (await storage.getSetting('browserMode')) || 'auto' });
        case 'competitor-subdomains': {
          const value = await storage.getSetting('competitorSubdomains');
          return res.json({ prefixes: value ? value.split(',').map((s: string) => s.trim()).filter(Boolean) : ['docs'] });
        }
        case 'competitor-blocklist': {
          const value = await storage.getSetting('competitorBlocklist');
          return res.json({ entries: value ? value.split(',').map((s: string) => s.trim()).filter(Boolean) : DEFAULT_BLOCKLIST });
        }
        case 'brand-domains': {
          const value = await storage.getSetting('brandDomains');
          return res.json({ domains: value ? value.split(',').map((s: string) => s.trim()).filter(Boolean) : [] });
        }
        case 'chatgpt-credentials': {
          const email = await getSetting('chatgptEmail');
          const password = await getSetting('chatgptPassword');
          const totpSecret = await getSetting('chatgptTotpSecret');
          return res.json({ hasEmail: !!email, hasPassword: !!password, hasTotpSecret: !!totpSecret, email: email || '' });
        }
        default:
          return res.status(404).json({ error: `Unknown setting: ${key}` });
      }
    } catch (error) {
      console.error(`Error fetching setting '${key}':`, error);
      res.status(500).json({ error: `Failed to fetch setting '${key}'` });
    }
  });

  // Unified PUT — all writes require admin
  app.put("/api/settings/:key", requireRole("admin"), async (req, res) => {
    // #swagger.tags = ['Settings']
    const key = req.params.key;
    const { setSetting } = await import('../services/settings');

    try {
      switch (key) {
        case 'brand': {
          const { brandUrl, brandName } = req.body;
          if (brandUrl !== undefined) await storage.setSetting('brandUrl', brandUrl);
          if (brandName !== undefined) {
            await saveBrandName(brandName);
          }
          return res.json({ success: true });
        }
        case 'models': {
          await storage.setSetting('modelsConfig', JSON.stringify(req.body));
          return res.json({ success: true });
        }
        case 'openai-key': {
          const { apiKey } = req.body;
          if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('sk-')) {
            return res.status(400).json({ error: "Invalid API key format (must start with sk-)" });
          }
          const testRes = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
          });
          if (!testRes.ok) return res.status(400).json({ error: "Invalid API key or OpenAI service unavailable" });
          await setSetting('openaiApiKey', apiKey);
          return res.json({ success: true, message: "API key saved and validated" });
        }
        case 'anthropic-key': {
          const { apiKey } = req.body;
          if (!apiKey || typeof apiKey !== 'string') return res.status(400).json({ error: "Invalid API key format" });
          const testRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
          });
          if (!testRes.ok && testRes.status === 401) return res.status(400).json({ error: "Invalid Anthropic API key" });
          await setSetting('anthropicApiKey', apiKey);
          return res.json({ success: true, message: "Anthropic API key saved and validated" });
        }
        case 'apify-token': {
          const { token } = req.body;
          if (token) {
            const testRes = await fetch('https://api.apify.com/v2/users/me', { headers: { 'Authorization': `Bearer ${token}` } });
            if (!testRes.ok) return res.status(400).json({ error: "Invalid Apify token" });
          }
          await setSetting('apifyToken', token || '');
          return res.json({ success: true, message: token ? "Apify token saved and validated" : "Apify token removed" });
        }
        case 'analysis-llm': {
          const { llm } = req.body;
          if (llm !== 'openai' && llm !== 'anthropic') return res.status(400).json({ error: "llm must be 'openai' or 'anthropic'" });
          await setSetting('analysisLlm', llm);
          return res.json({ success: true, llm });
        }
        case 'analysis-schedule': {
          const { frequency } = req.body;
          const valid = ['manual', 'hourly', 'daily', 'weekly', 'monthly'];
          if (!frequency || !valid.includes(frequency)) return res.status(400).json({ error: "Invalid frequency. Must be one of: " + valid.join(', ') });
          const { updateSchedule, getNextRunTime } = await import('../services/scheduler');
          await setSetting('analysisSchedule', frequency);
          updateSchedule(frequency);
          const nextRun = getNextRunTime();
          return res.json({ success: true, frequency, nextRun: nextRun?.toISOString() ?? null });
        }
        case 'browser-mode': {
          const { mode } = req.body;
          if (mode !== 'local' && mode !== 'cloud') return res.status(400).json({ error: "Mode must be 'local' or 'cloud'" });
          await storage.setSetting('browserMode', mode);
          return res.json({ success: true, mode });
        }
        case 'competitor-subdomains': {
          const { prefixes } = req.body;
          if (!Array.isArray(prefixes)) return res.status(400).json({ error: "prefixes must be an array" });
          const cleaned = prefixes.map((s: string) => s.trim().toLowerCase()).filter(Boolean);
          await storage.setSetting('competitorSubdomains', cleaned.join(','));
          return res.json({ success: true, prefixes: cleaned });
        }
        case 'competitor-blocklist': {
          const { entries } = req.body;
          if (!Array.isArray(entries)) return res.status(400).json({ error: "entries must be an array" });
          const cleaned = entries.map((s: string) => s.trim().toLowerCase()).filter(Boolean);
          await storage.setSetting('competitorBlocklist', cleaned.join(','));
          return res.json({ success: true, entries: cleaned });
        }
        case 'brand-domains': {
          const { domains } = req.body;
          if (!Array.isArray(domains)) return res.status(400).json({ error: "domains must be an array" });
          const cleaned = domains.map((s: string) => s.trim().toLowerCase()).filter(Boolean);
          await storage.setSetting('brandDomains', cleaned.join(','));
          return res.json({ success: true, domains: cleaned });
        }
        case 'chatgpt-credentials': {
          const { email, password, totpSecret } = req.body;
          if (email !== undefined) await setSetting('chatgptEmail', email || '');
          if (password !== undefined) await setSetting('chatgptPassword', password || '');
          if (totpSecret !== undefined) await setSetting('chatgptTotpSecret', totpSecret || '');
          return res.json({ success: true });
        }
        case 'analysis-config': {
          const { promptsPerTopic, analysisFrequency } = req.body;
          if (!promptsPerTopic || typeof promptsPerTopic !== 'number' || promptsPerTopic < 1 || promptsPerTopic > 20) {
            return res.status(400).json({ error: "Invalid prompts per topic value" });
          }
          if (!analysisFrequency || !['manual', 'daily', 'weekly', 'monthly'].includes(analysisFrequency)) {
            return res.status(400).json({ error: "Invalid analysis frequency value" });
          }
          process.env.PROMPTS_PER_TOPIC = promptsPerTopic.toString();
          process.env.ANALYSIS_FREQUENCY = analysisFrequency;
          return res.json({ success: true });
        }
        default:
          return res.status(404).json({ error: `Unknown setting: ${key}` });
      }
    } catch (error) {
      console.error(`Error saving setting '${key}':`, error);
      res.status(500).json({ error: `Failed to save setting '${key}'` });
    }
  });
}
