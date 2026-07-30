import { createClient } from '@supabase/supabase-js'

// The project URL is hardcoded here (it isn't a secret - it's a public
// endpoint, protected by Row Level Security) after repeated trouble getting
// it saved correctly as a Cloudflare build variable. The anon key still
// comes from the environment variable, since that one saved correctly.
const supabaseUrl = 'https://wmvcdjmoxdfmyrtxwbc.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_ANON_KEY. Check Cloudflare: osbusiness -> Settings -> Build -> Variables and secrets.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
