-- Hash existing plaintext API keys (SHA-256)
-- Plaintext keys are base64url (~43 chars), hashed keys are hex (64 chars)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE users
SET api_key = encode(digest(api_key, 'sha256'), 'hex')
WHERE api_key IS NOT NULL
  AND length(api_key) < 64;
