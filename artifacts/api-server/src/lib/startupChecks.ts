// Boot-time configuration assertions. Fail fast (and loudly) on deployment
// mistakes that silently weaken security in production.
//
// Pure and side-effect free (takes an env object, throws on misconfiguration)
// so it can be unit-tested without booting the server.

const DEFAULT_DB_PASSWORD = "openboard";

export interface StartupEnv {
  NODE_ENV?: string | undefined;
  DATABASE_URL?: string | undefined;
  DOMAIN?: string | undefined;
}

/** Extract the password component from a postgres:// URL, if any. */
function parseDbPassword(databaseUrl?: string): string | undefined {
  if (!databaseUrl) return undefined;
  try {
    const url = new URL(databaseUrl);
    return url.password ? decodeURIComponent(url.password) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Throws if the process is configured in a way that is unsafe for the intended
 * environment. Call once at startup, before accepting traffic.
 *
 *  - M1: DOMAIN set (production intent) but NODE_ENV !== 'production' → session
 *    cookies are issued without the Secure flag. Refuse.
 *  - H1: NODE_ENV === 'production' with the default dev database password. Refuse.
 */
export function checkStartupConfig(env: StartupEnv = process.env): void {
  const isProd = env.NODE_ENV === "production";

  // M1 — production intent (a DOMAIN) without production mode.
  if (env.DOMAIN && env.DOMAIN.trim() !== "" && !isProd) {
    throw new Error(
      `DOMAIN is set ("${env.DOMAIN}") but NODE_ENV is "${env.NODE_ENV ?? "unset"}", not "production". ` +
        "Session cookies would be issued WITHOUT the Secure flag, exposing them over plain HTTP. " +
        "Set NODE_ENV=production for the production profile, or unset DOMAIN for local/dev.",
    );
  }

  // H1 — default database password in production.
  if (isProd && parseDbPassword(env.DATABASE_URL) === DEFAULT_DB_PASSWORD) {
    throw new Error(
      `Refusing to start in production with the default database password ("${DEFAULT_DB_PASSWORD}"). ` +
        "Set POSTGRES_PASSWORD to a strong secret (e.g. `openssl rand -hex 32`) and update DATABASE_URL.",
    );
  }
}
