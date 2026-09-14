# SOLDI

Web app responsive per la gestione finanziaria personale. Usa Vite e Supabase (PostgreSQL, Auth e Row Level Security) ed è pubblicata dal repository esistente su Vercel.

## Configurazione

1. Copia `.env.example` in `.env.local` e inserisci URL e chiave pubblicabile Supabase.
2. Esegui `supabase/migrations/202609140001_core.sql` nel progetto Supabase.
3. Esegui `npm install`, poi `npm run dev`.

La configurazione di produzione usa `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. La chiave publishable è destinata al client; token OAuth, service-role key e altri segreti devono restare lato server e non usare il prefisso `VITE_`.

Il database applica RLS per utente, vincoli anti-duplicato, un movimento utilizzabile in una sola riconciliazione e stato fattura prudente (`to_review` predefinito). Le scadenze si aprono e chiudono automaticamente in base allo stato fattura.
