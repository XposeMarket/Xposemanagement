Create `messages-media` bucket (Supabase)

Recommended: private bucket named `messages-media`.

Steps (Supabase UI):

1. Open your Supabase project and go to "Storage" → "Buckets".
2. Click "New bucket".
3. Set bucket ID: `messages-media`.
4. Leave "Public" unchecked (private bucket).
5. Click "Create".

Optional: configure CORS, lifecycle rules, and retention per your policy.

Environment variable:
- Set `SUPABASE_MEDIA_BUCKET=messages-media` on your server (the code defaults to this if not set).

Notes:
- The server upload endpoint (`/api/messaging/upload`) uses the server-side `SUPABASE_SERVICE_ROLE_KEY` to upload files and returns a signed URL (1 hour TTL) for Twilio to fetch.
- Keep the service role key server-side only; never expose it to clients.
