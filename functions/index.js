const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrlSecret = defineSecret('SUPABASE_URL');
const supabaseAnonKeySecret = defineSecret('SUPABASE_ANON_KEY');
const supabaseServiceRoleSecret = defineSecret('SUPABASE_SERVICE_ROLE_KEY');

const ALLOWED_ORIGINS = new Set([
  'https://spark-smirk.web.app',
  'https://spark-smirk.firebaseapp.com',
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5000',
]);

function applySecurityHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('X-Content-Type-Options', 'nosniff');
}

exports.api = onRequest(
  {
    region: 'europe-west1',
    secrets: [supabaseUrlSecret, supabaseAnonKeySecret, supabaseServiceRoleSecret],
    cors: false,
  },
  async (req, res) => {
    applySecurityHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    const requestPath = (req.path || '/').replace(/\/+$/, '') || '/';
    const supabaseUrl = (supabaseUrlSecret.value() || '').trim();
    const supabaseAnonKey = (supabaseAnonKeySecret.value() || '').trim();
    const supabaseServiceRoleKey = (supabaseServiceRoleSecret.value() || '').trim();

    if (req.method === 'GET' && requestPath === '/api/auth/config') {
      if (!supabaseUrl || !supabaseAnonKey) {
        res.status(503).json({
          error: 'SUPABASE_SECRETS_NOT_CONFIGURED',
          message: 'Os segredos SUPABASE_URL e SUPABASE_ANON_KEY não estão configurados no Secret Manager.',
        });
        return;
      }

      res.status(200).json({
        url: supabaseUrl,
        anonKey: supabaseAnonKey,
      });
      return;
    }

    if (req.method === 'POST' && requestPath === '/api/auth/verify') {
      if (!supabaseUrl || !supabaseServiceRoleKey) {
        res.status(503).json({
          authenticated: false,
          error: 'SUPABASE_ADMIN_SECRET_NOT_CONFIGURED',
        });
        return;
      }

      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

      if (!token) {
        res.status(401).json({
          authenticated: false,
          error: 'MISSING_BEARER_TOKEN',
        });
        return;
      }

      try {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        });

        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !data?.user) {
          res.status(401).json({
            authenticated: false,
            error: 'INVALID_TOKEN',
          });
          return;
        }

        res.status(200).json({
          authenticated: true,
          user: {
            id: data.user.id,
            email: data.user.email,
            role: data.user.role,
          },
        });
        return;
      } catch (err) {
        console.error('Erro na verificação de token Supabase:', err);
        res.status(500).json({
          authenticated: false,
          error: 'VERIFICATION_INTERNAL_ERROR',
        });
        return;
      }
    }

    res.status(404).json({ error: 'ENDPOINT_NOT_FOUND' });
  }
);
