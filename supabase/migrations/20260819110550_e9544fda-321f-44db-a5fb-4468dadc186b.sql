CREATE OR REPLACE FUNCTION public.recheck_plan_weather_if_needed()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  has_work boolean;
  secret text;
begin
  select exists (
    select 1 from public.outfit_plans
    where status = 'planned'
      and date between (current_date - 1) and (current_date + 2)
  ) into has_work;

  if not has_work then
    return;
  end if;

  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'scan_worker_secret';

  if secret is null then
    raise warning '[AURA] scan_worker_secret not found in Vault — weather recheck skipped';
    return;
  end if;

  perform net.http_post(
    url := 'https://aura-wardrobe-intelligence.lovable.app/api/public/hooks/recheck-plan-weather',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', secret
    ),
    body := jsonb_build_object('limit', 200)
  );
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.recheck_plan_weather_if_needed() FROM PUBLIC, anon, authenticated;