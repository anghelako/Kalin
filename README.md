# KALIN

A static HTML/CSS/JavaScript care-coordination prototype using Supabase Auth.

## Run locally
1. Extract this folder.
2. Open it through a local web server (for example VS Code Live Server). Avoid opening the HTML files directly with `file://`.
3. Open `login.html` and sign in or create an account.

## Supabase setup
- Update `js/supabase.js` with your Supabase project URL and publishable/anon key.
- In Supabase Authentication > URL Configuration, add your local and deployed app URLs to the Site URL / Redirect URLs.
- Enable email confirmation if desired and ensure the email templates use the configured redirect URL.
- Never put a `service_role` key in browser code.

## Current implementation status
- Supabase sign-in, sign-up, email confirmation flow, and password recovery are wired in the auth pages.
- Dashboard session guard is shared with the calendar through `window.kalinReady`.
- The dashboard provides navigation and a starter overview.
- Calendar displays only records returned by the configured data source. It does not generate sample shifts; until a real shifts query is connected, the calendar remains empty.
- Circle creation and notifications are clearly marked as not yet connected.

## Before using real family/care data
The project does not include a confirmed database schema for circles, memberships, shifts, or notifications. Create those tables and Row Level Security policies first, then connect the calendar to authenticated database queries. Do not store sensitive care information until access rules have been reviewed and tested.
