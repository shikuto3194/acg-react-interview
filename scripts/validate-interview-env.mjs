import { loadEnv } from 'vite';

const localEnv = loadEnv('production', process.cwd(), 'VITE_');
const env = { ...localEnv, ...process.env };
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Interview build requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}

let parsedUrl;
try {
  parsedUrl = new URL(supabaseUrl);
} catch {
  throw new Error('VITE_SUPABASE_URL must be a valid HTTPS URL.');
}

if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.supabase.co')) {
  throw new Error('Interview build only accepts an HTTPS Supabase project URL.');
}
if (parsedUrl.hostname === 'nnthvbizvqpufpfkzlho.supabase.co') {
  throw new Error('Interview build cannot target the production Supabase project.');
}
if (/service_role|sb_secret_/i.test(supabaseKey)) {
  throw new Error('A server-only Supabase key must never be used in a browser build.');
}

console.log(`Interview Supabase target validated: ${parsedUrl.hostname}`);
