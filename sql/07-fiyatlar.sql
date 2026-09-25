-- =====================================================================
-- Gürkan Yılmaz — The Barber — Fiyatlar (iki berberde de aynı)
--   Saç 600 · Sakal 300 · Saç & Sakal 900
-- Süreler değişmiyor: saç ve sakal yarım saat (bir blok), saç & sakal bir
-- saat (iki blok). Sitedeki yazılar js/db.js, index.html ve randevu.html'de.
-- =====================================================================
update hizmetler set fiyat = 600 where id = 'sac';
update hizmetler set fiyat = 300 where id = 'sakal';
update hizmetler set fiyat = 900 where id = 'sacsakal';

-- Doğrulama: 600 / 300 / 900 görünmeli
select id, ad, sure_dk, fiyat from hizmetler
where id in ('sac', 'sakal', 'sacsakal') order by fiyat desc;
