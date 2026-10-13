import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

if (!supabaseUrl) {
  console.warn(
    "[Supabase] VITE_SUPABASE_URL is not configured. Supabase features will not work."
  );
}

if (!supabaseAnonKey) {
  console.warn(
    "[Supabase] VITE_SUPABASE_ANON_KEY is not configured. Supabase features will not work."
  );
}

/**
 * Capture the original URL before Supabase's auth callback detection can
 * exchange a PKCE code or otherwise clean the browser URL.
 */
export const initialAuthCallbackUrl =
  typeof window !== "undefined" ? window.location.href : "";

/**
 * Browser Supabase client.
 *
 * The anon/publishable key is safe to expose in browser code.
 * Never use the service-role key here.
 */
export const supabase = createClient(
  supabaseUrl ?? "",
  supabaseAnonKey ?? "",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  }
);

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
