import 'dotenv/config';

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};

if (!env.supabaseUrl || !env.supabaseAnonKey || !env.supabaseServiceRoleKey) {
  console.error('Missing Supabase environment variables. Copy .env.example to .env and fill values.');
  process.exit(1);
}