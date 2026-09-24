-- =====================================================================
-- Gürkan Yılmaz — The Barber — Yarım saatlik slotlar
--
-- Saç ve sakal 30 dk = 1 slot. Saç & sakal 60 dk = 2 slot birden.
-- Böylece berber 18:00–19:00 arasına isterse iki müşteri alabilir.
--
-- kurulum.sql ve 02-calisma-saatleri.sql'den SONRA çalıştırılır.
-- =====================================================================

update hizmetler set sure_dk = 30 where id in ('sac', 'sakal');
update hizmetler set sure_dk = 60 where id = 'sacsakal';

-- Eski imzaları kaldır; yenileri parametre aldığı için çakışırdı.
drop function if exists gun_uygunluk(text, date);
drop function if exists calisiyor_mu(text, date, time);

-- ---------------------------------------------------------------- uygunluk
-- Izgara 30 dakikada bir başlar. Bir saat, ancak hizmetin TAMAMI oraya
-- sığıyorsa müsait sayılır: 60 dakikalık saç&sakal için iki slot da boş olmalı.
create or replace function gun_uygunluk(
  p_berber  text,
  p_tarih   date,
  p_sure_dk int default 30
)
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
    select generate_series(
      (p_tarih + (select acilis from sa)) at time zone 'Europe/Istanbul',
      (p_tarih + (select kapanis from sa)) at time zone 'Europe/Istanbul'
        - make_interval(mins => p_sure_dk),
      interval '30 minutes'
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
            && tstzrange(i.t, i.t + make_interval(mins => p_sure_dk))
    )
  from izgara i;
$$;

grant execute on function gun_uygunluk(text, date, int) to anon, authenticated;

-- ---------------------------------------------------------------- kontrol
-- Randevunun tamamı çalışma saatinin içine sığmalı; 20:30'a 60 dakikalık
-- iş yazılamaz çünkü 21:30'a taşar.
create or replace function calisiyor_mu(
  p_berber  text,
  p_tarih   date,
  p_saat    time,
  p_sure_dk int
)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from calisma_saatleri
    where berber_id = p_berber
      and gun = extract(dow from p_tarih)
      and not kapali
      and p_saat >= acilis
      and (p_tarih + p_saat) + make_interval(mins => p_sure_dk)
          <= (p_tarih + kapanis)
  );
$$;

-- ---------------------------------------------------------------- randevu
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
  v_tel := regexp_replace(p_telefon, '\D', '', 'g');
  v_tel := regexp_replace(v_tel, '^0+', '');
  if v_tel ~ '^5\d{9}$' then v_tel := '90' || v_tel; end if;
  if v_tel !~ '^90\d{10}$' then raise exception 'GECERSIZ_TELEFON'; end if;

  if length(btrim(p_ad)) < 3 then raise exception 'GECERSIZ_AD'; end if;

  select sure_dk into v_sure from hizmetler where id = p_hizmet;
  if v_sure is null then raise exception 'GECERSIZ_HIZMET'; end if;

  if not exists (select 1 from berberler where id = p_berber and aktif) then
    raise exception 'GECERSIZ_BERBER';
  end if;

  v_bas := (p_tarih + p_saat::time) at time zone 'Europe/Istanbul';
  if v_bas < now() then raise exception 'GECMIS_SAAT'; end if;

  if not calisiyor_mu(p_berber, p_tarih, p_saat::time, v_sure) then
    raise exception 'CALISMA_DISI';
  end if;

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

grant execute on function randevu_olustur(text, text, date, text, text, text)
  to anon, authenticated;

-- Berber panelden yarım saatlik blok kapatabilsin diye 30 dk'lık bir "hizmet"
insert into hizmetler (id, ad, sure_dk, fiyat)
values ('kapali', 'Kapalı', 30, 0)
on conflict (id) do update set sure_dk = 30, ad = 'Kapalı';
