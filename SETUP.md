# Threadline — Setup

## 1. Install dependencies
```
npm install
```

## 2. Set up environment variables
Copy `.env.local.example` to `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — your project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — your service role key (server-side only)

## 3. Run SQL migrations
In your Supabase project, run the SQL files in order:
1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_rls.sql`

## 4. Create Supabase Storage bucket
Create a bucket called `exports` (private) for PDF export storage.

## 5. Run dev server
```
npm run dev
```

Open http://localhost:3000
