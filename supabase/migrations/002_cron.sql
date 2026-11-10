-- Runs the notification engine every 5 minutes (free: pg_cron + pg_net are included in Supabase).
-- Before running, replace the two placeholders below, then paste into Supabase > SQL Editor > Run.
--   YOUR_PROJECT_REF : the part before .supabase.co in your project URL
--   YOUR_CRON_SECRET : the same long random text you saved as the CRON_SECRET secret
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('ela-notify-tick') where exists (select 1 from cron.job where jobname = 'ela-notify-tick');

select cron.schedule(
  'ela-notify-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR_CRON_SECRET'),
    body := '{"action":"tick"}'::jsonb
  );
  $$
);
