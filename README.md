# Campus Room Booking (Supabase edition)

An online room booking and appointment system for campus resources
(e.g. the wellness room), with QR check-in, no-show tracking, and an
appeal process.

## Stack
- Frontend: HTML, CSS, JavaScript (PWA)
- Backend: Supabase (Auth, Postgres database, Storage, Postgres functions)

Chosen over Firebase because Supabase's database functions run on the
free tier with no billing/plan upgrade required — Firebase Cloud
Functions need the paid Blaze plan, which wasn't available in this
project's environment.

## Project structure
```
roombook/
├── public/                       Static site (deploy as-is)
│   ├── index.html                 Login / signup page
│   ├── manifest.json              PWA manifest
│   ├── sw.js                       Service worker (offline caching)
│   ├── css/style.css
│   └── js/
│       ├── supabase-config.js      <-- fill in your project URL + anon key
│       ├── auth.js
│       └── register-sw.js
└── supabase/
    └── migrations/
        └── 0001_init.sql          Tables, RLS policies, and functions:
                                     book_appointment, check_in_with_qr,
                                     sweep_no_shows, review_appeal
```

## First-time setup
1. Create a project at https://supabase.com/dashboard
2. Go to SQL Editor > New query, paste the contents of
   `supabase/migrations/0001_init.sql`, and run it. This creates all
   tables, security policies, and functions in one go.
3. Go to Project Settings > API, copy your Project URL and anon public
   key into `public/js/supabase-config.js`.
4. Go to Authentication > Providers, confirm Email is enabled.
5. Insert at least one room to test with, e.g. in the SQL Editor:
   ```sql
   insert into public.rooms (room_name, room_type, capacity, location)
   values ('Wellness Room', 'wellness', 3, 'Student Center, 2nd floor');
   ```
6. Deploy `public/` to any static host (Firebase Hosting, Netlify,
   Vercel, GitHub Pages, etc.) — Supabase itself doesn't host your
   frontend, only the backend.

## How the capacity + no-show logic works now
- Booking calls `supabase.rpc('book_appointment', {...})` — the
  capacity check and insert happen atomically inside Postgres, so two
  simultaneous bookings can't both slip through.
- QR check-in calls `supabase.rpc('check_in_with_qr', { p_token })`.
- No-show sweeping calls `supabase.rpc('sweep_no_shows')` — since this
  project doesn't have a way to run it on an automatic schedule yet,
  call it whenever the staff dashboard loads (or on a `setInterval`
  while that page is open). If your Supabase project has the `pg_cron`
  extension available, you can schedule it directly in Postgres instead.

## Still to build
- Booking calendar UI (dashboard.html)
- QR scanner staff page (checkin.html)
- Appeal submission form
- Admin dashboard page
- PWA icons (192x192, 512x512 PNGs in public/icons/)
