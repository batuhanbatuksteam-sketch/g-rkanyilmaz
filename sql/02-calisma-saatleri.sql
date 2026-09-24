-- =====================================================================
-- Gürkan Yılmaz — The Barber — Çalışma saatleri
-- Her berber kendi haftalık programını panelden belirler.
-- kurulum.sql'den SONRA çalıştırılır.
-- =====================================================================

create table if not exists calisma_saatleri (
  berber_id text not null references berberler(id) on delete cascade,
  gun       int  not null check (gun between 0 and 6),   -- 0 = Pazar
  acilis    time not null default '10:00',
  kapanis   time not null default '21:00',
  kapali    boolean not null default false,              -- izin günü
  primary key (berber_id, gun),
  constraint saat_sirasi check (kapanis > acilis)
);

-- Varsayılan: Pazartesi–Cumartesi 10:00–21:00, Pazar kapalı
insert into calisma_saatleri (berber_id, gun, acilis, kapanis, kapali)
select b.id, g, time '10:00', time '21:00', (g = 0)
from berberler b, generate_series(0, 6) g
on conflict (berber_id, gun) do nothing;

-- ---------------------------------------------------------------- güvenlik
alter table calisma_saatleri enable row level security;
revoke all on calisma_saatleri from anon;

-- Berber yalnızca kendi programını görür ve değiştirir
drop policy if exists cs_oku on calisma_saatleri;
create policy cs_oku on calisma_saatleri
  for select to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists cs_guncelle on calisma_saatleri;
create policy cs_guncelle on calisma_saatleri
  for update to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()))
  with check (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

-- ---------------------------------------------------------------- uygunluk
-- Artık ızgara sabit 10:00–20:00 değil; berberin o güne yazdığı saatlerden üretilir.
create or replace function gun_uygunluk(p_berber text, p_tarih date)
returns table(saat text, musait boolean)
language sql
stable
security definer
set search_path = public
as $$
  with sa as (
    select acilis, kapanis
    from calisma_saatleri
    where berber_id = p_berber
      and gun = extract(dow from p_tarih)
      and not kapali
  ),
  izgara as (
    -- sa boşsa (izin günü) generate_series hiç satır üretmez
    select generate_series(
      (p_tarih + (select acilis  from sa)) at time zone 'Europe/Istanbul',
      (p_tarih + (select kapanis from sa)) at time zone 'Europe/Istanbul'
        - interval '1 hour',
      interval '1 hour'
    ) as t
  )
  select
    to_char(i.t at time zone 'Europe/Istanbul', 'HH24:MI'),
    i.t > now() + interval '30 minutes'
    and not exists (
      select 1 from randevular r
      where r.berber_id = p_berber
        and r.durum <> 'iptal'
        and not (r.durum = 'beklemede'
                 and r.olusturuldu < now() - interval '30 minutes')
        and tstzrange(r.baslangic, r.bitis)
            && tstzrange(i.t, i.t + interval '1 hour')
    )
  from izgara i;
$$;

grant execute on function gun_uygunluk(text, date) to anon, authenticated;

-- randevu_olustur da berberin çalışma saatine uymalı
create or replace function calisiyor_mu(p_berber text, p_tarih date, p_saat time)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from calisma_saatleri
    where berber_id = p_berber
      and gun = extract(dow from p_tarih)
      and not kapali
      and p_saat >= acilis
      and p_saat < kapanis
  );
$$;
