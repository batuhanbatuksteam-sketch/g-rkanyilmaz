-- =====================================================================
-- Gürkan Yılmaz — The Barber — Hizmetler ve fiyatlar (iki berberde de aynı)
--
--   Saç                   800   30 dk  (1 blok)
--   Sakal                 400   30 dk  (1 blok)
--   Saç & Sakal          1000   1 saat (2 blok)
--   Keratin Düzleştirici 2500   1 saat (2 blok)
--   Cilt Bakımı          1500   30 dk  (1 blok)
--   Perma                4500   2 saat (4 blok)
--   Boya                  800   30 dk  (1 blok)
--
-- Süre, randevunun kaç blok kapatacağını belirliyor (slot_bitisi). Sitedeki
-- yazılar js/db.js, index.html ve randevu.html'de — orayla aynı tutulmalı.
-- Tekrar çalıştırmak güvenli.
-- =====================================================================
insert into hizmetler (id, ad, sure_dk, fiyat) values
  ('sac',      'Saç',                   30,  800),
  ('sakal',    'Sakal',                 30,  400),
  ('sacsakal', 'Saç & Sakal',           60, 1000),
  ('keratin',  'Keratin Düzleştirici',  60, 2500),
  ('cilt',     'Cilt Bakımı',           30, 1500),
  ('perma',    'Perma',                120, 4500),
  ('boya',     'Boya',                  30,  800)
on conflict (id) do update
  set ad = excluded.ad, sure_dk = excluded.sure_dk, fiyat = excluded.fiyat;

-- Doğrulama: yedi satır, fiyatlar yukarıdaki gibi olmalı
select id, ad, sure_dk, fiyat from hizmetler
where id not in ('kapali', 'mola') order by sure_dk, fiyat;
