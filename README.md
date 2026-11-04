# DCC Order to Dispatch

Order-to-Dispatch app for DCC Supply Chain (Okhla + Gurgaon). White desktop theme, left sidebar, hash routing.
Static HTML/JS front end on a Supabase backend. No build step.

Routes: `#/dashboard` `#/new` `#/tasks` `#/orders` `#/orders/<id>` `#/returns` `#/reports` `#/admin`

Files
- `index.html`, `style.css`, `app.js`, `config.js` – the app (config.js holds the Supabase URL and publishable key)
- `supabase/01_schema.sql`, `02_seed.sql` – schema and reference data (already applied)
- `supabase/04_app_functions.sql` – create_order and complete_step functions (run once in the SQL Editor)

Documents and photos stay on Google Drive; only links are stored.
