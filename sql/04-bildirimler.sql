-- =====================================================================
-- Gürkan Yılmaz — The Barber — Push bildirimleri
--
-- Berberin telefonu, bildirim gönderebilmemiz için buraya bir "token"
-- kaydeder. Yeni randevu düşünce Edge Function bu tokenlara push atar.
--
-- Önceki dosyalardan SONRA çalıştırılır.
-- =====================================================================

create table if not exists cihazlar (
  token       text primary key,           -- FCM cihaz anahtarı
  berber_id   text not null references berberler(id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android', 'web')),
  son_gorulme timestamptz not null default now(),
  eklendi     timestamptz not null default now()
);

create index if not exists cihaz_berber_ix on cihazlar (berber_id);

alter table cihazlar enable row level security;
revoke all on cihazlar from anon;

-- Berber yalnızca kendi cihazını kaydeder ve görür.
drop policy if exists cihaz_oku on cihazlar;
create policy cihaz_oku on cihazlar
  for select to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists cihaz_ekle on cihazlar;
create policy cihaz_ekle on cihazlar
  for insert to authenticated
  with check (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists cihaz_guncelle on cihazlar;
create policy cihaz_guncelle on cihazlar
  for update to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()))
  with check (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists cihaz_sil on cihazlar;
create policy cihaz_sil on cihazlar
  for delete to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

-- ---------------------------------------------------------------- bildirim metni
-- Edge Function'ın göndereceği başlık ve gövdeyi veritabanı hazırlar;
-- böylece saat dilimi ve hizmet adı tek yerde doğru olur.
create or replace function randevu_bildirimi(p_randevu_id uuid)
returns table(berber_id text, baslik text, govde text, tokenlar text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    r.berber_id,
    'Yeni randevu',
    r.musteri_ad || ' · ' ||
      to_char(r.baslangic at time zone 'Europe/Istanbul', 'DD.MM HH24:MI') || ' · ' ||
      coalesce(h.ad, 'Hizmet'),
    coalesce(array_agg(c.token) filter (where c.token is not null), '{}')
  from randevular r
  left join hizmetler h on h.id = r.hizmet_id
  left join cihazlar  c on c.berber_id = r.berber_id
  where r.id = p_randevu_id
  group by r.berber_id, r.musteri_ad, r.baslangic, h.ad;
$$;
