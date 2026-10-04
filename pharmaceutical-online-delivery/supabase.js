// Replace with values from Supabase > Project Settings > API.
// Use ONLY the public anon key here. NEVER put the service_role key in frontend code.
const SUPABASE_URL = "https://rblsjcgrxsnjlqokghyl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJibHNqY2dyeHNuamxxb2tnaHlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExMjE3MjUsImV4cCI6MjEwNjY5NzcyNX0.6PjV7Vkm--SjzT7tTapl4S-xPHkPWGarRZ2Xtiptbu8";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
