-- =====================================================================
-- Gürkan Yılmaz — The Barber — Randevu veritabanı kurulumu
-- Supabase → SQL Editor → hepsini yapıştır → Run
--
-- SIRA ÖNEMLİ: önce bu dosya, SONRA 02-calisma-saatleri.sql.
-- Bu dosyadaki gun_uygunluk() ızgarayı 10:00–20:00 sabit üretir;
-- 02 onu berberin kendi programını okuyan sürümle değiştirir.
-- Bu dosyayı tekrar çalıştırırsan 02'yi de tekrar çalıştır.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------- tablolar

create table if not exists berberler (
  id       text primary key,          -- 'gurkan' | 'berkay'
  ad       text not null,
  telefon  text not null,             -- '+905XXXXXXXXX' — wa.me linki için
  aktif    boolean not null default true
);

create table if not exists hizmetler (
  id      text primary key,           -- 'sac' | 'sakal' | 'sacsakal'
  ad      text not null,
  sure_dk int  not null,
  fiyat   int  not null
);

create table if not exists randevular (
  id          uuid primary key default gen_random_uuid(),
  berber_id   text not null references berberler(id),
  hizmet_id   text not null references hizmetler(id),
  musteri_ad  text not null,
  musteri_tel text not null,          -- '905XXXXXXXXX'
  baslangic   timestamptz not null,
  bitis       timestamptz not null,
  durum       text not null default 'beklemede'
              check (durum in ('beklemede','onayli','iptal')),
  olusturuldu timestamptz not null default now(),

  -- Aynı berbere çakışan iki randevu yazılamaz.
  -- Çifte rezervasyona karşı asıl koruma bu.
  constraint cakisma_yok exclude using gist (
    berber_id with =,
    tstzrange(baslangic, bitis) with &&
  ) where (durum <> 'iptal')
);

create index if not exists randevu_gun_ix
  on randevular (berber_id, baslangic) where durum <> 'iptal';

-- Hangi Supabase kullanıcısı hangi berber
create table if not exists berber_hesap (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  berber_id text not null references berberler(id)
);

-- ---------------------------------------------------------------- veri

insert into hizmetler (id, ad, sure_dk, fiyat) values
  ('sac','Saç',30,600),
  ('sakal','Sakal',30,300),
  ('sacsakal','Saç & Sakal',60,900)
on conflict (id) do update
  set ad = excluded.ad, sure_dk = excluded.sure_dk, fiyat = excluded.fiyat;

-- ⚠️ TELEFONLAR ÖRNEK. Gerçek numaralarla değiştir — WhatsApp yönlendirmesi
--    bunları kullanıyor. Biçim: +90 + 10 hane, boşluksuz.
--    js/db.js içindeki BERBERLER.tel ile AYNI numara olmalı (oradaki '+' yok).
insert into berberler (id, ad, telefon) values
  ('gurkan','Gürkan Yılmaz','+905358373452'),
  ('berkay','Berkay Özer','+905444636866')
on conflict (id) do update
  set ad = excluded.ad, telefon = excluded.telefon;

-- ---------------------------------------------------------------- güvenlik
-- Tarayıcı tablolara DOĞRUDAN erişemez. Her şey aşağıdaki iki fonksiyondan geçer.

alter table randevular    enable row level security;
alter table berberler     enable row level security;
alter table hizmetler     enable row level security;
alter table berber_hesap  enable row level security;

revoke all on randevular   from anon;
revoke all on berber_hesap from anon;

-- Berber/hizmet listesi herkese açık (isim, fiyat — gizli bir şey yok)
drop policy if exists berber_oku on berberler;
create policy berber_oku on berberler for select to anon, authenticated using (true);

drop policy if exists hizmet_oku on hizmetler;
create policy hizmet_oku on hizmetler for select to anon, authenticated using (true);

-- Berber kendi randevularını görür ve günceller
drop policy if exists berber_kendi_randevulari on randevular;
create policy berber_kendi_randevulari on randevular
  for select to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists berber_kendi_gunceller on randevular;
create policy berber_kendi_gunceller on randevular
  for update to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists berber_kendi_ekler on randevular;
create policy berber_kendi_ekler on randevular
  for insert to authenticated
  with check (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists hesap_oku on berber_hesap;
create policy hesap_oku on berber_hesap
  for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------- fonksiyonlar

-- Bir günün saat ızgarası. Müşteri adı/telefonu DÖNMEZ — sadece dolu/boş.
create or replace function gun_uygunluk(p_berber text, p_tarih date)
returns table(saat text, musait boolean)
language sql
stable
security definer
set search_path = public
as $$
  with izgara as (
    select generate_series(
      (p_tarih + time '10:00') at time zone 'Europe/Istanbul',
      (p_tarih + time '20:00') at time zone 'Europe/Istanbul',
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
        -- 30 dakikada onaylanmayan "beklemede" kayıt slotu tutmaz
        and not (r.durum = 'beklemede'
                 and r.olusturuldu < now() - interval '30 minutes')
        and tstzrange(r.baslangic, r.bitis)
            && tstzrange(i.t, i.t + interval '1 hour')
    )
  from izgara i;
$$;

-- Randevu oluşturur. Süreyi ve bitişi sunucu hesaplar — tarayıcıya güvenilmez.
create or replace function randevu_olustur(
  p_berber  text,
  p_hizmet  text,
  p_tarih   date,
  p_saat    text,
  p_ad      text,
  p_telefon text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bas  timestamptz;
  v_sure int;
  v_id   uuid;
  v_tel  text;
begin
  -- '0532 111 22 33' -> '905321112233'
  v_tel := regexp_replace(p_telefon, '\D', '', 'g');
  v_tel := regexp_replace(v_tel, '^0+', '');
  if v_tel ~ '^5\d{9}$' then v_tel := '90' || v_tel; end if;
  if v_tel !~ '^90\d{10}$' then
    raise exception 'GECERSIZ_TELEFON';
  end if;

  if length(btrim(p_ad)) < 3 then
    raise exception 'GECERSIZ_AD';
  end if;

  select sure_dk into v_sure from hizmetler where id = p_hizmet;
  if v_sure is null then raise exception 'GECERSIZ_HIZMET'; end if;

  if not exists (select 1 from berberler where id = p_berber and aktif) then
    raise exception 'GECERSIZ_BERBER';
  end if;

  v_bas := (p_tarih + p_saat::time) at time zone 'Europe/Istanbul';
  if v_bas < now() then raise exception 'GECMIS_SAAT'; end if;

  -- Berber o gün/saatte çalışmıyorsa randevu alınamaz (02-calisma-saatleri.sql)
  if to_regprocedure('calisiyor_mu(text,date,time)') is not null
     and not calisiyor_mu(p_berber, p_tarih, p_saat::time) then
    raise exception 'CALISMA_DISI';
  end if;

  -- Süresi dolmuş "beklemede" kayıtları temizle, slotları serbest bırak
  update randevular
     set durum = 'iptal'
   where durum = 'beklemede'
     and olusturuldu < now() - interval '30 minutes';

  insert into randevular
    (berber_id, hizmet_id, musteri_ad, musteri_tel, baslangic, bitis)
  values
    (p_berber, p_hizmet, btrim(p_ad), v_tel,
     v_bas, v_bas + make_interval(mins => v_sure))
  returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'SAAT_DOLU';
end;
$$;

grant execute on function gun_uygunluk(text, date)                          to anon, authenticated;
grant execute on function randevu_olustur(text, text, date, text, text, text) to anon, authenticated;

-- =====================================================================
-- SON ADIM (panelde, elle):
--   1) Authentication → Users → Add user
--        gurkan@gurkanyilmaz.local / güçlü bir şifre (ASCII!)
--        berkay@gurkanyilmaz.local / güçlü bir şifre (ASCII!)
--   2) Oluşan user id'lerini alıp aşağıyı çalıştır:
--
--   insert into berber_hesap (user_id, berber_id) values
--     ('BURAYA-GURKAN-USER-ID', 'gurkan'),
--     ('BURAYA-BERKAY-USER-ID', 'berkay');
-- =====================================================================
