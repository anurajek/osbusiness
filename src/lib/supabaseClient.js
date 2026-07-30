import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // This fires if .env is missing or the dev server wasn't restarted after adding it.
  console.error(
    'Missing Supabase environment variables. Check that .env has ' +
    'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set, then restart `npm run dev`.'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
