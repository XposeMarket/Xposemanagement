-- Cleanup orphan jobs script
-- Usage: open in Supabase SQL editor, replace SHOP_ID with your shop UUID
-- This script:
-- 1) finds jobs in the `data.jobs` JSONB for the shop whose appointment_id does not exist in `appointments`
-- 2) backs those job objects into `job_cleanup_backups`
-- 3) removes them from the `data.jobs` JSONB
-- 4) deletes corresponding rows from the canonical `jobs` table
-- Review the SELECT output before committing the DELETE/UPDATE steps.

BEGIN;

-- Replace the value below with your shop id when running in Supabase
-- Example: '209e54d1-8815-4e6b-8917-74ecc88a5faa'
-- The script creates a temp table `tmp_params` to hold the shop id so this file
-- works in Supabase's SQL editor (which does not support psql backslash commands).
CREATE TEMP TABLE IF NOT EXISTS tmp_params (shop_id uuid);
TRUNCATE tmp_params;
INSERT INTO tmp_params (shop_id) VALUES ('209e54d1-8815-4e6b-8917-74ecc88a5faa');

-- Create a backup table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.job_cleanup_backups (
  shop_id uuid,
  job_id uuid,
  appointment_id text,
  job_obj jsonb,
  backed_up_at timestamptz DEFAULT now()
);

-- Build a temporary table of orphan jobs (appointment_id points to no appointment)
CREATE TEMP TABLE tmp_orphan_jobs AS
SELECT
  d.shop_id::uuid AS shop_id,
  (j.elem ->> 'job_id')::uuid AS job_id,
  (j.elem ->> 'appointment_id') AS appointment_id,
  j.elem AS job_obj
FROM data d
CROSS JOIN LATERAL jsonb_array_elements(d.jobs) AS j(elem)
WHERE d.shop_id::uuid = (SELECT shop_id FROM tmp_params)
  AND (j.elem ->> 'appointment_id') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM appointments a WHERE a.id::text = (j.elem ->> 'appointment_id')
  );

-- Preview orphan count and rows (inspect before proceeding)
SELECT count(*) AS orphan_count FROM tmp_orphan_jobs;
SELECT * FROM tmp_orphan_jobs LIMIT 200;

-- If the above looks correct, backup the orphan rows into job_cleanup_backups
INSERT INTO public.job_cleanup_backups (shop_id, job_id, appointment_id, job_obj)
SELECT shop_id, job_id, appointment_id, job_obj FROM tmp_orphan_jobs;

-- Remove orphan jobs from the data.jobs JSONB for the shop
UPDATE data
SET jobs = COALESCE(
  (
    SELECT jsonb_agg(elem) FROM jsonb_array_elements(data.jobs) elem
    WHERE (elem ->> 'job_id') NOT IN (SELECT job_id::text FROM tmp_orphan_jobs)
  ), '[]'::jsonb
)
WHERE shop_id::uuid = (SELECT shop_id FROM tmp_params);

-- Delete corresponding rows from the canonical jobs table (if they exist there)
DELETE FROM jobs
WHERE id::text IN (SELECT job_id::text FROM tmp_orphan_jobs);

-- Final verification: show remaining jobs/appointments counts for the shop
SELECT jsonb_array_length(jobs) AS data_jobs_count FROM data WHERE shop_id::uuid = (SELECT shop_id FROM tmp_params);
SELECT count(*) FROM jobs WHERE shop_id::uuid = (SELECT shop_id FROM tmp_params);

COMMIT;

-- Notes:
-- - The script uses a simple text-cast comparison (a.id::text = appointment_id text) to avoid UUID-vs-text
--   operator errors in Postgres. If your `appointments.id` column is text, the cast is harmless.
-- - Always run the SELECT preview steps first (they are included) and confirm the IDs before running.
-- - The backup table `job_cleanup_backups` stores removed job objects so you can inspect/restore if needed.
