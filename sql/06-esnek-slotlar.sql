-- =====================================================================
-- Gürkan Yılmaz — The Barber — Berbere özel blok düzeni
--   (NovaCut 1.4'teki sistemin aynısı)
--
-- Artık saatleri sabit bir ızgara üretmiyor: her berber panelden "Blok
-- Düzenim" bölümünde hangi bloğu isterse kendi yazıyor (18:27–18:55 bile).
-- Site randevu saatlerini birebir bu bloklardan gösteriyor.
--
-- Başlangıç düzeni bugüne kadarki davranışın aynısı: çalışma saatleri
-- arasında yarımşar saatlik bloklar. Yani bu dosya çalışınca ne sitede ne
-- panelde saatler kaymaz; berberler sonra istedikleri gibi değiştirir.
--
-- 01–04'ten SONRA çalıştırılır. 05 (bildirim tetikleyicisi) henüz
-- çalışmadıysa sorun değil, sona bakın.
-- =====================================================================

-- ---------------------------------------------------------------- berber ayarı
alter table berberler add column if not exists slot_dk   int     not null default 30;
alter table berberler add column if not exists ozel_slot boolean not null default false;

-- İkisi de kendi bloklarını yazıyor; varsayılan blok yarım saat.
update berberler set slot_dk = 30, ozel_slot = true where id in ('gurkan', 'berkay');

-- ---------------------------------------------------------------- özel bloklar
create table if not exists slot_sablon (
  berber_id text not null references berberler(id) on delete cascade,
  gun       int  not null check (gun between 0 and 6),   -- 0 = Pazar
  baslangic time not null,
  bitis     time not null,
  primary key (berber_id, gun, baslangic),
  constraint blok_sirasi check (bitis > baslangic)
);

create index if not exists slot_sablon_ix on slot_sablon (berber_id, gun, baslangic);

-- İlk düzen: bugüne kadarki davranışın aynısı olsun diye çalışma
-- saatlerinden yarım saatlik bloklar üretiliyor. Panelden değiştirilecek.
insert into slot_sablon (berber_id, gun, baslangic, bitis)
select c.berber_id, c.gun, t::time, (t + interval '30 minutes')::time
from calisma_saatleri c
join berberler b on b.id = c.berber_id and b.ozel_slot
cross join lateral generate_series(
  ('2000-01-01'::date + c.acilis),
  ('2000-01-01'::date + c.kapanis) - interval '30 minutes',
  interval '30 minutes'
) t
where not c.kapali
on conflict do nothing;

alter table slot_sablon enable row level security;
revoke all on slot_sablon from anon;

-- Berber yalnızca kendi bloklarını görür ve düzenler.
drop policy if exists ss_oku on slot_sablon;
create policy ss_oku on slot_sablon
  for select to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists ss_ekle on slot_sablon;
create policy ss_ekle on slot_sablon
  for insert to authenticated
  with check (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists ss_guncelle on slot_sablon;
create policy ss_guncelle on slot_sablon
  for update to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()))
  with check (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists ss_sil on slot_sablon;
create policy ss_sil on slot_sablon
  for delete to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

-- ---------------------------------------------------------------- bloklar
-- Bir günün blokları — iki mod da buradan çıkar. Site de panel de aynı
-- listeyi kullanır ki ekranda görünen saatlerle veritabanı hiç ayrışmasın.
create or replace function slot_bloklari(p_berber text, p_tarih date)
returns table(bas timestamptz, son timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ozel    boolean;
  v_slot    int;
  v_acilis  time;
  v_kapanis time;
  v_kapali  boolean;
  v_gun     int := extract(dow from p_tarih);
begin
  select b.ozel_slot, b.slot_dk into v_ozel, v_slot
  from berberler b where b.id = p_berber and b.aktif;
  if v_ozel is null then return; end if;

  select c.acilis, c.kapanis, c.kapali into v_acilis, v_kapanis, v_kapali
  from calisma_saatleri c where c.berber_id = p_berber and c.gun = v_gun;

  -- Kayıt yoksa da izin günü sayılır; uydurma saat üretmeyelim.
  if coalesce(v_kapali, true) then return; end if;

  if v_ozel then
    return query
      select (p_tarih + s.baslangic) at time zone 'Europe/Istanbul',
             (p_tarih + s.bitis)     at time zone 'Europe/Istanbul'
      from slot_sablon s
      where s.berber_id = p_berber and s.gun = v_gun
      order by s.baslangic;
  else
    return query
      select t at time zone 'Europe/Istanbul',
             (t + make_interval(mins => v_slot)) at time zone 'Europe/Istanbul'
      from generate_series(
             p_tarih + v_acilis,
             (p_tarih + v_kapanis) - make_interval(mins => v_slot),
             make_interval(mins => v_slot)
           ) t
      order by t;
  end if;
end;
$$;

-- ---------------------------------------------------------------- bitiş saati
-- Bir bloktan başlayan randevu nerede biter?
--
-- Randevu blok sınırında biter, dakikası dakikasına değil. İki mod iki ayrı
-- soru soruyor:
--
--   Izgara modu — bloklar zaten eşit uzunlukta, ölçü DAKİKA.
--   30 dakikalık saç saatlik bloğun tamamını kaplar; 60 dakikalık saç & sakal
--   da tam bir saat eder, iki saat değil.
--
--   Özel mod — blok uzunluğunu berber belirliyor. 18:27–18:55 gibi
--   28 dakikalık bir blok yazdıysa "saçı 28 dakikada kesiyorum" demektir;
--   nominal 30 dakikaya bakıp o bloğu kapatmak, berberin kendi kararını
--   çöpe atmak olurdu. Bu yüzden ölçü BLOK SAYISI: saç ve sakal bir blok,
--   saç & sakal iki blok. Ama berber saatlik bloklar yazdıysa iki blok = iki
--   saat eder ki bu da fazla; o yüzden iki ölçüden hangisi ÖNCE karşılanırsa
--   randevu orada biter.
--
-- Bloklar bitişik değilse (araya boşluk konmuşsa) zincir kırılır ve o saat
-- verilmez.
create or replace function slot_bitisi(
  p_berber  text,
  p_tarih   date,
  p_bas     timestamptz,
  p_sure_dk int
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ozel    boolean;
  v_birim   int;
  v_gereken int;
  v_hedef   timestamptz;
  v_son     timestamptz;
  v_sayi    int := 0;
  v_basladi boolean := false;
  r         record;
begin
  select ozel_slot into v_ozel from berberler where id = p_berber;
  if v_ozel is null then return null; end if;

  -- Hizmetler arasındaki oran: en kısa gerçek hizmet bir blok eder.
  select min(sure_dk) into v_birim
  from hizmetler where id not in ('kapali', 'mola');
  v_birim   := greatest(coalesce(v_birim, 30), 1);
  v_gereken := greatest(1, ceil(p_sure_dk::numeric / v_birim)::int);
  v_hedef   := p_bas + make_interval(mins => p_sure_dk);

  for r in select * from slot_bloklari(p_berber, p_tarih) loop
    if not v_basladi then
      if r.bas <> p_bas then continue; end if;
      v_basladi := true;
    else
      if r.bas <> v_son then return null; end if;   -- boşluk var, zincir kırıldı
    end if;

    v_son  := r.son;
    v_sayi := v_sayi + 1;

    if v_son >= v_hedef then return v_son; end if;
    if v_ozel and v_sayi >= v_gereken then return v_son; end if;
  end loop;

  return null;
end;
$$;

-- ---------------------------------------------------------------- uygunluk
-- Dönüş tipi değişiyor: önce düşmesi gerek.
drop function if exists gun_uygunluk(text, date, int);
drop function if exists gun_uygunluk(text, date);

create or replace function gun_uygunluk(
  p_berber  text,
  p_tarih   date,
  p_sure_dk int default 30
)
returns table(saat text, musait boolean, biter text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r     record;
  v_bit timestamptz;
begin
  for r in select * from slot_bloklari(p_berber, p_tarih) loop
    v_bit := slot_bitisi(p_berber, p_tarih, r.bas, p_sure_dk);

    saat  := to_char(r.bas at time zone 'Europe/Istanbul', 'HH24:MI');
    biter := case when v_bit is null then null
                  else to_char(v_bit at time zone 'Europe/Istanbul', 'HH24:MI') end;

    musait := v_bit is not null
      and r.bas > now() + interval '30 minutes'
      and not exists (
        select 1 from randevular x
        where x.berber_id = p_berber
          and x.durum <> 'iptal'
          -- 30 dakikada onaylanmayan "beklemede" kayıt slotu tutmaz
          and not (x.durum = 'beklemede'
                   and x.olusturuldu < now() - interval '30 minutes')
          and tstzrange(x.baslangic, x.bitis) && tstzrange(r.bas, v_bit)
      );

    return next;
  end loop;
end;
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
  v_bit  timestamptz;
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
  -- Panelin iç kayıtları siteden alınamaz.
  if p_hizmet in ('kapali', 'mola') then raise exception 'GECERSIZ_HIZMET'; end if;

  if not exists (select 1 from berberler where id = p_berber and aktif) then
    raise exception 'GECERSIZ_BERBER';
  end if;

  v_bas := (p_tarih + p_saat::time) at time zone 'Europe/Istanbul';
  if v_bas < now() then raise exception 'GECMIS_SAAT'; end if;

  -- Saat berberin gerçek bir bloğu olmalı ve hizmet o bloğa sığmalı.
  v_bit := slot_bitisi(p_berber, p_tarih, v_bas, v_sure);
  if v_bit is null then raise exception 'CALISMA_DISI'; end if;

  update randevular
     set durum = 'iptal'
   where durum = 'beklemede'
     and olusturuldu < now() - interval '30 minutes';

  insert into randevular
    (berber_id, hizmet_id, musteri_ad, musteri_tel, baslangic, bitis)
  values
    (p_berber, p_hizmet, btrim(p_ad), v_tel, v_bas, v_bit)
  returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'SAAT_DOLU';
end;
$$;

-- ---------------------------------------------------------------- iç kayıtlar
-- Panelde bloğa dokununca iki seçenek çıkıyor:
--   mola   → yer kapanır, randevu listesinde görünmez, tekrar dokununca açılır
--   kapali → telefonla alınan randevu; berberin yazdığı isimle listede durur
insert into hizmetler (id, ad, sure_dk, fiyat) values
  ('kapali', 'Telefonla Randevu', 30, 0),
  ('mola',   'Mola',              30, 0)
on conflict (id) do update set ad = excluded.ad, fiyat = excluded.fiyat;

-- ---------------------------------------------------------------- yetkiler
grant execute on function gun_uygunluk(text, date, int)                       to anon, authenticated;
grant execute on function randevu_olustur(text, text, date, text, text, text) to anon, authenticated;
-- Panel ızgarayı bundan üretiyor; site zaten gun_uygunluk üzerinden geçiyor.
grant execute on function slot_bloklari(text, date)                           to authenticated;
grant execute on function slot_bitisi(text, date, timestamptz, int)           to authenticated;

-- Artık kullanılmıyor: yerini slot_bitisi aldı.
drop function if exists calisiyor_mu(text, date, time, int);
drop function if exists calisiyor_mu(text, date, time);

-- ---------------------------------------------------------------- bildirim
-- Berber kendi eliyle mola verdiğinde ya da telefonla aldığı randevuyu
-- yazdığında telefonuna "Yeni randevu" bildirimi düşmesin.
-- 05-bildirim-tetikleyici.sql henüz çalışmadıysa tetikleyici fonksiyonu yok;
-- o zaman burayı atla — 05 zaten aynı filtreyle kuruyor.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'randevu_bildirim_tetikle') then
    drop trigger if exists randevu_bildirim on randevular;
    create trigger randevu_bildirim
      after insert on randevular
      for each row
      when (new.hizmet_id not in ('kapali', 'mola') and new.musteri_tel <> '0')
      execute function randevu_bildirim_tetikle();
  end if;
end $$;

-- ---------------------------------------------------------------- doğrulama
-- İki satır dönmeli: ozel_slot = true, blok sayısı 0'dan büyük.
select b.id, b.ozel_slot, b.slot_dk, count(s.*) as blok
from berberler b left join slot_sablon s on s.berber_id = b.id
group by b.id, b.ozel_slot, b.slot_dk order by b.id;
