// Centralized settings access — DB values override env vars.
// Settings are cached in memory and refreshed on write.

import { storage } from '../storage';

const cache = new Map<string, string | null>();

// Keys that can be stored in DB and override env vars
const SETTING_KEYS = [
  'openaiApiKey',
  'apifyToken',
  'chatgptEmail',
  'chatgptPassword',
  'chatgptTotpSecret',
] as const;

// Map setting keys to their env var equivalents
const ENV_MAP: Record<string, string> = {
  openaiApiKey: 'OPENAI_API_KEY',
  apifyToken: 'APIFY_TOKEN',
  chatgptEmail: 'CHATGPT_EMAIL',
  chatgptPassword: 'CHATGPT_PASSWORD',
  chatgptTotpSecret: 'CHATGPT_TOTP_SECRET',
};

/**
 * Get a setting value. Checks DB first (cached), falls back to env var.
 */
export async function getSetting(key: string): Promise<string> {
  // Check cache first
  if (cache.has(key)) {
    const cached = cache.get(key);
    if (cached) return cached;
  }

  // Try DB
  const dbValue = await storage.getSetting(key);
  if (dbValue) {
    cache.set(key, dbValue);
    return dbValue;
  }

  // Fall back to env var
  const envKey = ENV_MAP[key];
  const envValue = envKey ? process.env[envKey] || '' : '';
  cache.set(key, envValue || null);
  return envValue;
}

/**
 * Set a setting value in the DB and update cache.
 * Also updates process.env so existing code that reads env vars directly picks it up.
 */
export async function setSetting(key: string, value: string): Promise<void> {
  await storage.setSetting(key, value);
  cache.set(key, value || null);

  // Also set the env var so code that reads process.env directly gets the new value
  const envKey = ENV_MAP[key];
  if (envKey) {
    process.env[envKey] = value;
  }
}

/**
 * Load all DB settings into cache and process.env at startup.
 */
export async function loadSettingsIntoEnv(): Promise<void> {
  for (const key of SETTING_KEYS) {
    const dbValue = await storage.getSetting(key);
    if (dbValue) {
      cache.set(key, dbValue);
      const envKey = ENV_MAP[key];
      if (envKey) {
        // DB values override env vars
        process.env[envKey] = dbValue;
      }
    }
  }
  console.log(`[Settings] Loaded ${SETTING_KEYS.length} settings from DB`);
}
