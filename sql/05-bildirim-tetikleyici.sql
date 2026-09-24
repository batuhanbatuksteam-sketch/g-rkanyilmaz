-- =====================================================================
-- Gürkan Yılmaz — The Barber — Yeni randevu düşünce Edge Function'ı çağıran tetikleyici
-- 04-bildirimler.sql'den ve `supabase functions deploy randevu-bildir`
-- komutundan SONRA çalıştırılır.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

create or replace function randevu_bildirim_tetikle()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url  text := 'https://BURAYA-PROJE-REF.supabase.co/functions/v1/randevu-bildir';
  v_anon text := 'BURAYA-ANON-KEY';
begin
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_anon
               ),
    body    := jsonb_build_object(
                 'type', 'INSERT',
                 'table', 'randevular',
                 'record', to_jsonb(new)
               ),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists randevu_bildirim on randevular;
create trigger randevu_bildirim
  after insert on randevular
  for each row
  execute function randevu_bildirim_tetikle();
