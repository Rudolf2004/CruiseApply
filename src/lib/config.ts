export const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
export const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && supabasePublicKey);
export const demoMode = process.env.DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
