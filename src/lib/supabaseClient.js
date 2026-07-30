import { createClient } from '@supabase/supabase-js'

// The project URL is hardcoded here (it isn't a secret - it's a public
// endpoint, protected by Row Level Security). Confirmed directly from
// Supabase's own dashboard "Copy -> Project URL" panel.
const supabaseUrl = 'https://wwmvcdjmoxdfmyrtxwbc.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseAnonKey) {
  console.error(
    'Missing VITE_SUPABASE_ANON_KEY. Check Cloudflare: osbusiness -> Settings -> Build -> Variables and secrets.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
