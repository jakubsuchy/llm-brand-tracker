import crypto from 'crypto';
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as SamlStrategy } from '@node-saml/passport-saml';
import { db } from '../db';
import { users, roles, userRoles, type UserWithRoles } from '@shared/schema';
import { eq, sql, count } from 'drizzle-orm';
import { storage } from '../storage';

// --- Password hashing ---

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 310000, 32, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      resolve({ hash: derivedKey.toString('hex'), salt });
    });
  });
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 310000, 32, 'sha256', (err, derivedKey) => {
      if (err) return reject(err);
      const hashBuffer = Buffer.from(hash, 'hex');
      resolve(crypto.timingSafeEqual(derivedKey, hashBuffer));
    });
  });
}

// --- API key generation ---

export function generateApiKey(): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(crypto.randomBytes(32), salt, 100000, 32, 'sha256');
  return key.toString('base64url');
}

// --- User queries ---

export async function findUserByEmail(email: string) {
  const result = await db.select().from(users).where(eq(users.email, email));
  return result[0] || null;
}

export async function findUserById(id: number): Promise<UserWithRoles | null> {
  const result = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      hashedPassword: users.hashedPassword,
      salt: users.salt,
      googleId: users.googleId,
      apiKey: users.apiKey,
      createdAt: users.createdAt,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.id, userRoles.userId))
    .leftJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(users.id, id));

  if (result.length === 0) return null;

  const user = result[0];
  const roleNames = result.map(r => r.roleName).filter(Boolean) as string[];

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    hashedPassword: user.hashedPassword,
    salt: user.salt,
    googleId: user.googleId,
    apiKey: user.apiKey,
    createdAt: user.createdAt,
    roles: roleNames,
  };
}

export async function getUserCount(): Promise<number> {
  const result = await db.select({ value: count() }).from(users);
  return result[0].value;
}

export async function createUser(email: string, fullName: string, password: string | null) {
  let hashedPassword: string | null = null;
  let salt: string | null = null;

  if (password) {
    const hashed = await hashPassword(password);
    hashedPassword = hashed.hash;
    salt = hashed.salt;
  }

  const result = await db
    .insert(users)
    .values({ email, fullName, hashedPassword, salt, apiKey: generateApiKey() })
    .returning();

  return result[0];
}

export async function assignRole(userId: number, roleName: string) {
  const role = await db.select().from(roles).where(eq(roles.name, roleName));
  if (role.length === 0) throw new Error(`Role '${roleName}' not found`);
  await db.insert(userRoles).values({ userId, roleId: role[0].id });
}

export async function removeUserRoles(userId: number) {
  await db.delete(userRoles).where(eq(userRoles.userId, userId));
}

export async function findUserByApiKey(key: string): Promise<UserWithRoles | null> {
  const result = await db.select().from(users).where(eq(users.apiKey, key));
  if (result.length === 0) return null;
  return findUserById(result[0].id);
}

export async function regenerateApiKey(userId: number): Promise<string> {
  const newKey = generateApiKey();
  await db.update(users).set({ apiKey: newKey }).where(eq(users.id, userId));
  return newKey;
}

export async function getAllUsersWithRoles(): Promise<UserWithRoles[]> {
  const result = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      hashedPassword: users.hashedPassword,
      salt: users.salt,
      googleId: users.googleId,
      apiKey: users.apiKey,
      createdAt: users.createdAt,
      roleName: roles.name,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.id, userRoles.userId))
    .leftJoin(roles, eq(userRoles.roleId, roles.id));

  const userMap = new Map<number, UserWithRoles>();
  for (const row of result) {
    if (!userMap.has(row.id)) {
      userMap.set(row.id, {
        id: row.id,
        email: row.email,
        fullName: row.fullName,
        hashedPassword: row.hashedPassword,
        salt: row.salt,
        googleId: row.googleId,
        apiKey: row.apiKey,
        createdAt: row.createdAt,
        roles: [],
      });
    }
    if (row.roleName) {
      userMap.get(row.id)!.roles.push(row.roleName);
    }
  }

  return Array.from(userMap.values());
}

// --- Seed roles ---

export async function seedRoles() {
  const roleNames = ['user', 'analyst', 'admin'];
  for (const name of roleNames) {
    await db
      .insert(roles)
      .values({ name })
      .onConflictDoNothing({ target: roles.name });
  }
}

export async function backfillApiKeys() {
  const usersWithoutKey = await db.select({ id: users.id }).from(users).where(sql`${users.apiKey} IS NULL`);
  if (usersWithoutKey.length === 0) return;
  for (const u of usersWithoutKey) {
    await db.update(users).set({ apiKey: generateApiKey() }).where(eq(users.id, u.id));
  }
  console.log(`[Auth] Backfilled API keys for ${usersWithoutKey.length} user(s)`);
}

// --- Auth provider configuration (DB-stored) ---

export interface AuthProviderConfig {
  google?: {
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    callbackUrl?: string;
    autoCreateUsers?: boolean;   // default true — create user on first login
    allowedDomain?: string;      // if set, only emails from this domain can login
  };
  saml?: {
    enabled: boolean;
    entryPoint: string;
    issuer: string;
    cert: string;
    callbackUrl?: string;
    signatureAlgorithm?: string;
    wantAssertionsSigned?: boolean;
    wantAuthnResponseSigned?: boolean;
    autoCreateUsers?: boolean;   // default true
    allowedDomain?: string;      // if set, only emails from this domain can login
  };
}

export async function getAuthProviderConfig(): Promise<AuthProviderConfig> {
  const raw = await storage.getSetting('authProviders');
  if (raw) {
    try {
      return JSON.parse(raw) as AuthProviderConfig;
    } catch {
      // Fall through to env-var fallback
    }
  }

  // Fallback: read Google config from env vars
  const config: AuthProviderConfig = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    config.google = {
      enabled: true,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: '/api/auth/google/callback',
    };
  }
  return config;
}

export async function saveAuthProviderConfig(config: AuthProviderConfig): Promise<void> {
  await storage.setSetting('authProviders', JSON.stringify(config));
}

function validateDomain(email: string, allowedDomain?: string): void {
  if (!allowedDomain) return;
  const domain = email.split('@')[1]?.toLowerCase();
  if (domain !== allowedDomain.toLowerCase()) {
    throw new Error(`Login restricted to @${allowedDomain} email addresses`);
  }
}

export async function findOrCreateSamlUser(
  profile: { email?: string; nameID?: string; displayName?: string; firstName?: string; lastName?: string },
  options?: { autoCreateUsers?: boolean; allowedDomain?: string }
): Promise<UserWithRoles> {
  const email = profile.email || profile.nameID;
  if (!email) throw new Error('SAML profile has no email or nameID');

  validateDomain(email, options?.allowedDomain);

  const fullName = profile.displayName
    || [profile.firstName, profile.lastName].filter(Boolean).join(' ')
    || email;

  // Try to find by email
  const byEmail = await db.select().from(users).where(eq(users.email, email));
  if (byEmail.length > 0) {
    const user = await findUserById(byEmail[0].id);
    return user!;
  }

  // Auto-create check
  if (options?.autoCreateUsers === false) {
    throw new Error('No account found. Contact an administrator to create your account.');
  }

  // Create new user
  const result = await db
    .insert(users)
    .values({ email, fullName, apiKey: generateApiKey() })
    .returning();

  await assignRole(result[0].id, 'user');
  const user = await findUserById(result[0].id);
  return user!;
}

export async function configureAuthProviders(): Promise<void> {
  const config = await getAuthProviderConfig();

  // --- Google ---
  if (config.google?.enabled && config.google.clientId && config.google.clientSecret) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: config.google.clientId,
          clientSecret: config.google.clientSecret,
          callbackURL: config.google.callbackUrl || (process.env.APP_URL ? `${process.env.APP_URL}/api/auth/google/callback` : '/api/auth/google/callback'),
          scope: ['profile', 'email'],
        },
        async (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
          try {
            const user = await findOrCreateGoogleUser(profile, {
              autoCreateUsers: config.google?.autoCreateUsers !== false,
              allowedDomain: config.google?.allowedDomain,
            });
            return done(null, user);
          } catch (err) {
            return done(err as Error);
          }
        }
      )
    );
  } else {
    // Unregister Google strategy if it was previously registered
    passport.unuse('google');
  }

  // --- SAML ---
  if (config.saml?.enabled && config.saml.entryPoint && config.saml.issuer && config.saml.cert) {
    passport.use(
      new SamlStrategy(
        {
          entryPoint: config.saml.entryPoint,
          issuer: config.saml.issuer,
          idpCert: config.saml.cert,
          callbackUrl: config.saml.callbackUrl || (process.env.APP_URL ? `${process.env.APP_URL}/api/auth/saml/callback` : '/api/auth/saml/callback'),
          signatureAlgorithm: (config.saml.signatureAlgorithm as any) || 'sha256',
          wantAssertionsSigned: config.saml.wantAssertionsSigned ?? true,
          wantAuthnResponseSigned: config.saml.wantAuthnResponseSigned ?? false,
        },
        // Verify callback
        async (profile: any, done: any) => {
          try {
            const user = await findOrCreateSamlUser({
              email: profile.email || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
              nameID: profile.nameID,
              displayName: profile.displayName,
              firstName: profile.firstName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'],
              lastName: profile.lastName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'],
            }, {
              autoCreateUsers: config.saml?.autoCreateUsers !== false,
              allowedDomain: config.saml?.allowedDomain,
            });
            return done(null, user);
          } catch (err) {
            return done(err as Error);
          }
        },
        // Logout callback
        async (_profile: any, done: any) => {
          done(null);
        }
      )
    );
  } else {
    // Unregister SAML strategy if it was previously registered
    passport.unuse('saml');
  }
}

// --- Google OAuth ---

export async function findOrCreateGoogleUser(
  googleProfile: { id: string; emails?: { value: string }[]; displayName?: string },
  options?: { autoCreateUsers?: boolean; allowedDomain?: string }
): Promise<UserWithRoles> {
  const googleId = googleProfile.id;
  const email = googleProfile.emails?.[0]?.value;
  const fullName = googleProfile.displayName || email || 'Google User';

  if (email) validateDomain(email, options?.allowedDomain);

  // Try to find by googleId
  const byGoogleId = await db.select().from(users).where(eq(users.googleId, googleId));
  if (byGoogleId.length > 0) {
    const user = await findUserById(byGoogleId[0].id);
    return user!;
  }

  // Try to find by email
  if (email) {
    const byEmail = await db.select().from(users).where(eq(users.email, email));
    if (byEmail.length > 0) {
      await db.update(users).set({ googleId }).where(eq(users.id, byEmail[0].id));
      const user = await findUserById(byEmail[0].id);
      return user!;
    }
  }

  // Auto-create check
  if (options?.autoCreateUsers === false) {
    throw new Error('No account found. Contact an administrator to create your account.');
  }

  if (!email) throw new Error('Google profile has no email');
  const result = await db
    .insert(users)
    .values({ email, fullName, googleId, apiKey: generateApiKey() })
    .returning();

  await assignRole(result[0].id, 'user');
  const user = await findUserById(result[0].id);
  return user!;
}

// --- Passport configuration ---

export function configurePassport() {
  // Local strategy (always active)
  passport.use(
    new LocalStrategy(
      { usernameField: 'email' },
      async (email, password, done) => {
        try {
          const user = await findUserByEmail(email);
          if (!user) return done(null, false, { message: 'Invalid credentials' });
          if (!user.hashedPassword || !user.salt) {
            return done(null, false, { message: 'Password login not available for this account' });
          }
          const valid = await verifyPassword(password, user.hashedPassword, user.salt);
          if (!valid) return done(null, false, { message: 'Invalid credentials' });
          const userWithRoles = await findUserById(user.id);
          return done(null, userWithRoles);
        } catch (err) {
          return done(err);
        }
      }
    )
  );

  // Serialize / deserialize
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await findUserById(id);
      done(null, user);
    } catch (err) {
      done(err);
    }
  });
}
