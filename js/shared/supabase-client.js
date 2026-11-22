import { createClient } from '@supabase/supabase-js';

let cachedConfig = null;
let cachedClient = null;
let configLoadPromise = null;

/**
 * Resolve Supabase client configuration from Vite env variables (local dev)
 * or from the Firebase Secret Manager backed endpoint (/api/auth/config).
 */
export async function loadSupabaseConfig() {
  if (cachedConfig) return cachedConfig;
  if (configLoadPromise) return configLoadPromise;

  configLoadPromise = (async () => {
    const envUrl = (
      import.meta.env.VITE_SUPABASE_URL ||
      import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
      ''
    ).trim();
    const envKey = (
      import.meta.env.VITE_SUPABASE_ANON_KEY ||
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      ''
    ).trim();

    if (envUrl && envKey) {
      cachedConfig = {
        url: envUrl,
        anonKey: envKey,
        source: 'vite-env',
      };
      return cachedConfig;
    }

    try {
      const response = await window.fetch('/api/auth/config', {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });

      if (response.ok) {
        const data = await response.json();
        const remoteUrl = (data && typeof data.url === 'string' ? data.url : '').trim();
        const remoteKey = (data && typeof data.anonKey === 'string' ? data.anonKey : '').trim();

        if (remoteUrl && remoteKey) {
          cachedConfig = {
            url: remoteUrl,
            anonKey: remoteKey,
            source: 'firebase-secrets',
          };
          return cachedConfig;
        }
      }
    } catch {
      // Fail closed when remote config is unreachable
    }

    return null;
  })();

  try {
    return await configLoadPromise;
  } finally {
    configLoadPromise = null;
  }
}

/**
 * Returns an initialized Supabase client or null if credentials are not configured.
 */
export async function getSupabaseClient() {
  if (cachedClient) return cachedClient;

  const config = await loadSupabaseConfig();
  if (!config || !config.url || !config.anonKey) {
    return null;
  }

  cachedClient = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'spark_smirk_supabase_auth',
    },
  });

  return cachedClient;
}

/**
 * Validates the current Supabase session strictly on the server via getUser()
 * and optionally cross-checks via Firebase Function /api/auth/verify when deployed.
 */
export async function verifyAuthenticatedUser() {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    return {
      authenticated: false,
      configured: false,
      user: null,
      session: null,
      reason: 'SUPABASE_NOT_CONFIGURED',
    };
  }

  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const session = sessionData?.session || null;

    if (sessionError || !session || !session.access_token) {
      return {
        authenticated: false,
        configured: true,
        user: null,
        session: null,
        reason: 'NO_ACTIVE_SESSION',
      };
    }

    // Server-side verification against Supabase Auth API (prevents spoofed local storage tokens)
    const { data: userData, error: userError } = await supabase.auth.getUser(session.access_token);
    if (userError || !userData?.user) {
      await supabase.auth.signOut().catch(() => {});
      return {
        authenticated: false,
        configured: true,
        user: null,
        session: null,
        reason: 'INVALID_OR_EXPIRED_SESSION',
      };
    }

    return {
      authenticated: true,
      configured: true,
      user: userData.user,
      session,
      reason: 'OK',
    };
  } catch {
    return {
      authenticated: false,
      configured: true,
      user: null,
      session: null,
      reason: 'VERIFICATION_FAILED',
    };
  }
}

/**
 * Cross-checks the Supabase JWT with the Firebase Functions backend and loads user profile/permissions.
 * Fails closed when backend rejects (401/403).
 */
export async function verifyWithBackendEndpoint(accessToken) {
  if (!accessToken) return { authenticated: false, status: 401, profile: null };
  try {
    const res = await window.fetch('/api/auth/verify', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { authenticated: true, status: 200, profile: null, offlineFallback: true };
    }

    const payload = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403 || !res.ok) {
      return {
        authenticated: false,
        status: res.status,
        error: payload?.error || 'UNAUTHORIZED',
        profile: null,
      };
    }

    return {
      authenticated: Boolean(payload?.authenticated),
      status: res.status,
      user: payload?.user || null,
      profile: payload?.profile || null,
    };
  } catch {
    return { authenticated: true, status: 200, profile: null, offlineFallback: true };
  }
}

/**
 * Performs an authenticated JSON request to /api/** using the current Supabase access token.
 */
export async function authenticatedApiFetch(endpoint, options = {}) {
  const supabase = await getSupabaseClient();
  if (!supabase) {
    throw new Error('Cliente Supabase não configurado.');
  }

  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) {
    throw new Error('Sessão expirada. Inicie sessão novamente.');
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };

  const response = await window.fetch(endpoint, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('API administrativa indisponível neste servidor.');
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Erro HTTP ${response.status}`);
  }
  return payload;
}

/**
 * Signs out cleanly from Supabase and clears any local auth state.
 */
export async function signOutUser() {
  const supabase = await getSupabaseClient();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Proceed with local storage cleanup even if network signOut fails
    }
  }
  try {
    window.localStorage.removeItem('spark_smirk_supabase_auth');
  } catch {
    // Ignore storage access errors
  }
}
