-- =====================================================================
-- Gürkan Yılmaz — The Barber — Foto Stüdyo
--
-- Berber günün tıraş fotoğraflarını yükler, Nano Banana Pro (Replicate)
-- saça ve yüze dokunmadan ışığı ve arka planı düzeltir.
--
-- Para akışı: berberin TL bakiyesi var. Her fotoğraf birim_fiyat (25 TL)
-- düşer; üretim başarısız olursa aynı tutar geri yatar. Bakiye yetmezse
-- sunucu Replicate'i hiç çağırmaz — kilit burada.
--
-- Bakiye yüklemek (SQL Editor'den, ödeme gelince):
--   select foto_bakiye_yukle('gurkan', 500, 'IBAN 26 Eylül');
--
-- Tekrar çalıştırmak güvenli.
-- =====================================================================

-- ---------------------------------------------------------------- cüzdan
-- Satırı olmayan berber Stüdyo sekmesini hiç görmez.
create table if not exists foto_cuzdan (
  berber_id    text primary key references berberler(id) on delete cascade,
  bakiye       int  not null default 0 check (bakiye >= 0),   -- TL
  birim_fiyat  int  not null default 25,                      -- fotoğraf başı TL
  gunluk_sinir int  not null default 5                        -- ücretli fotoğraf / gün
);

insert into foto_cuzdan (berber_id) values ('gurkan') on conflict do nothing;

-- ---------------------------------------------------------------- işler
create table if not exists foto_is (
  id          uuid primary key default gen_random_uuid(),
  berber_id   text not null references berberler(id) on delete cascade,
  durum       text not null default 'isleniyor'
              check (durum in ('isleniyor', 'hazir', 'hata')),
  girdi       text not null,          -- storage yolu: gurkan/girdi/…jpg
  cikti       text,                   -- storage yolu: gurkan/cikti/…jpg
  ucret       int  not null,          -- düşülen TL (ücretsiz tekrar: 0)
  kaynak_is   uuid references foto_is(id) on delete set null,  -- tekrarın aslı
  tahmin_id   text,                   -- Replicate prediction id
  hata        text,
  olusturuldu timestamptz not null default now(),
  bitti       timestamptz
);

create index if not exists foto_is_berber_ix on foto_is (berber_id, olusturuldu desc);
-- Her fotoğrafın en fazla bir ücretsiz tekrarı olur.
create unique index if not exists foto_is_tek_tekrar on foto_is (kaynak_is)
  where kaynak_is is not null;

-- ---------------------------------------------------------------- defter
-- Bakiyedeki her kuruşun nereden geldiği: yükleme +, üretim −, iade +.
create table if not exists foto_hareket (
  id        bigserial primary key,
  berber_id text not null references berberler(id) on delete cascade,
  tutar     int  not null,
  tur       text not null check (tur in ('yukleme', 'uretim', 'iade')),
  is_id     uuid references foto_is(id) on delete set null,
  aciklama  text,
  zaman     timestamptz not null default now()
);

create index if not exists foto_hareket_ix on foto_hareket (berber_id, zaman desc);

-- ---------------------------------------------------------------- RLS
-- Berber yalnızca kendi kayıtlarını OKUR. Yazma yok: bakiye ve işler
-- sadece aşağıdaki fonksiyonlarla (sunucu fonksiyonu üzerinden) değişir.
alter table foto_cuzdan  enable row level security;
alter table foto_is      enable row level security;
alter table foto_hareket enable row level security;
revoke all on foto_cuzdan, foto_is, foto_hareket from anon;
revoke insert, update, delete on foto_cuzdan, foto_is, foto_hareket from authenticated;

drop policy if exists fc_oku on foto_cuzdan;
create policy fc_oku on foto_cuzdan for select to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists fi_oku on foto_is;
create policy fi_oku on foto_is for select to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

drop policy if exists fh_oku on foto_hareket;
create policy fh_oku on foto_hareket for select to authenticated
  using (berber_id in (select berber_id from berber_hesap where user_id = auth.uid()));

-- ---------------------------------------------------------------- iş aç
-- Parayı düşüp işi açar. Cüzdan satırı kilitlendiği için aynı anda gelen
-- iki istek bakiyeyi eksiye düşüremez, günlük sınırı da aşamaz.
-- p_kaynak doluysa bu, o fotoğrafın ücretsiz tekrarıdır.
create or replace function foto_is_ac(p_berber text, p_girdi text, p_kaynak uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c     foto_cuzdan%rowtype;
  v_ucret int;
  v_bugun int;
  v_id    uuid;
begin
  select * into v_c from foto_cuzdan where berber_id = p_berber for update;
  if not found then raise exception 'CUZDAN_YOK'; end if;

  if p_kaynak is not null then
    -- Tekrar: aslı bu berberin, ücretli ve daha önce tekrarlanmamış olmalı.
    if not exists (select 1 from foto_is
                   where id = p_kaynak and berber_id = p_berber
                     and ucret > 0 and durum = 'hazir') then
      raise exception 'TEKRAR_YOK';
    end if;
    if exists (select 1 from foto_is where kaynak_is = p_kaynak) then
      raise exception 'TEKRAR_KULLANILDI';
    end if;
    v_ucret := 0;
  else
    select count(*) into v_bugun from foto_is
    where berber_id = p_berber and ucret > 0 and durum <> 'hata'
      and (olusturuldu at time zone 'Europe/Istanbul')::date
          = (now() at time zone 'Europe/Istanbul')::date;
    if v_bugun >= v_c.gunluk_sinir then raise exception 'GUNLUK_SINIR'; end if;

    v_ucret := v_c.birim_fiyat;
    if v_c.bakiye < v_ucret then raise exception 'BAKIYE_YETERSIZ'; end if;
  end if;

  insert into foto_is (berber_id, girdi, ucret, kaynak_is)
  values (p_berber, p_girdi, v_ucret, p_kaynak)
  returning id into v_id;

  if v_ucret > 0 then
    update foto_cuzdan set bakiye = bakiye - v_ucret where berber_id = p_berber;
    insert into foto_hareket (berber_id, tutar, tur, is_id)
    values (p_berber, -v_ucret, 'uretim', v_id);
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------- iş bitir
-- Webhook ve yoklama aynı işi iki kez bitirmeye çalışabilir: yalnızca
-- 'isleniyor' durumundaki iş değişir, iade de bir kez yapılır.
create or replace function foto_is_bitir(p_id uuid, p_cikti text, p_hata text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is foto_is%rowtype;
begin
  update foto_is
     set durum = case when p_cikti is not null then 'hazir' else 'hata' end,
         cikti = p_cikti,
         hata  = p_hata,
         bitti = now()
   where id = p_id and durum = 'isleniyor'
  returning * into v_is;

  if not found then return; end if;

  if v_is.durum = 'hata' and v_is.ucret > 0 then
    update foto_cuzdan set bakiye = bakiye + v_is.ucret where berber_id = v_is.berber_id;
    insert into foto_hareket (berber_id, tutar, tur, is_id, aciklama)
    values (v_is.berber_id, v_is.ucret, 'iade', v_is.id, p_hata);
  end if;
end;
$$;

-- ---------------------------------------------------------------- yükleme
-- Sadece sen (SQL Editor / postgres) çalıştırırsın; uygulamadan çağrılamaz.
create or replace function foto_bakiye_yukle(p_berber text, p_tutar int, p_aciklama text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bakiye int;
begin
  if p_tutar = 0 then raise exception 'TUTAR_SIFIR'; end if;

  insert into foto_cuzdan (berber_id) values (p_berber) on conflict do nothing;
  update foto_cuzdan set bakiye = bakiye + p_tutar
   where berber_id = p_berber returning bakiye into v_bakiye;
  insert into foto_hareket (berber_id, tutar, tur, aciklama)
  values (p_berber, p_tutar, 'yukleme', p_aciklama);
  return v_bakiye;
end;
$$;

revoke all on function foto_is_ac(text, text, uuid)          from public, anon, authenticated;
revoke all on function foto_is_bitir(uuid, text, text)       from public, anon, authenticated;
revoke all on function foto_bakiye_yukle(text, int, text)    from public, anon, authenticated;
grant execute on function foto_is_ac(text, text, uuid)        to service_role;
grant execute on function foto_is_bitir(uuid, text, text)     to service_role;

-- ---------------------------------------------------------------- depolama
-- Özel kova. Yol: <berber_id>/girdi/… ve <berber_id>/cikti/…
-- Berber kendi klasörüne girdi yükler ve kendi klasörünü okur; çıktıyı
-- sunucu yazar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('foto-studyo', 'foto-studyo', false, 15728640, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists fs_yukle on storage.objects;
create policy fs_yukle on storage.objects for insert to authenticated
  with check (
    bucket_id = 'foto-studyo'
    and (storage.foldername(name))[1] in (select berber_id from berber_hesap where user_id = auth.uid())
    and (storage.foldername(name))[2] = 'girdi'
  );

drop policy if exists fs_oku on storage.objects;
create policy fs_oku on storage.objects for select to authenticated
  using (
    bucket_id = 'foto-studyo'
    and (storage.foldername(name))[1] in (select berber_id from berber_hesap where user_id = auth.uid())
  );

-- ---------------------------------------------------------------- doğrulama
select berber_id, bakiye, birim_fiyat, gunluk_sinir from foto_cuzdan;
