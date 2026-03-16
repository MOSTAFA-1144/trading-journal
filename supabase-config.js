/* ============================================================
   Supabase Configuration
   ============================================================ */

const SUPABASE_URL = 'https://rppcjwgucoydavanzpsf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwcGNqd2d1Y295ZGF2YW56cHNmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NTY4NDgsImV4cCI6MjA4OTIzMjg0OH0.WlHOpct26DlpROUR50Y_MD9fUWF50M550wmYqV5I_A8';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
