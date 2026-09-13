import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// TODO: replace with your own project's values
// Find these in Supabase dashboard > Project Settings > API
const SUPABASE_URL = "https://vlymcpnfrlfvejpdylrj.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZseW1jcG5mcmxmdmVqcGR5bHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkxMDY4NTMsImV4cCI6MjEwNDY4Mjg1M30.rCOnpLIW4OhER2-T3jy3A5xybMOmt3k2Td6j97oEPg4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
