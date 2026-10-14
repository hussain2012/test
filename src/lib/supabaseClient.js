import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

<<<<<<< HEAD
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variable.');
=======
const missingEnvironmentVariables = [
  ['VITE_SUPABASE_URL', supabaseUrl],
  ['VITE_SUPABASE_ANON_KEY', supabaseAnonKey],
].filter(([, value]) => !value).map(([name]) => name);

if (missingEnvironmentVariables.length > 0) {
  const message = `Missing required environment variables: ${missingEnvironmentVariables.join(', ')}`;
  console.error(`[supabaseClient] ${message}`);
  throw new Error(message);
>>>>>>> b486d065cb59b63d9f1bc6445334ca0122d71301
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
