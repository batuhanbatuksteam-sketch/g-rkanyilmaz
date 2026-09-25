# GÜRKAN YILMAZ — THE BARBER

Siyah + parlatılmış çelik temalı berber sitesi. Hero'da döngüdeki video,
NovaCut'takiyle aynı akışta çalışan randevu sihirbazı ve berber paneli.

```
index.html      ana sayfa (hero videosu, berberler, portre, hizmetler)
randevu.html    5 adımlı randevu sihirbazı
berber.html     berber paneli (arama motorlarına kapalı)
js/db.js        ⚠️ DOLDURULACAK TEK DOSYA — Supabase, telefonlar, fiyatlar
sql/            veritabanı kurulumu (sırayla çalıştırılır)
supabase/       push bildirimi için Edge Function
marka.json      randevu skill'inin kurulum girdisi
```

---

## 1. Yerelde çalıştırma

```bash
cd site
python3 sunucu.py            # http://localhost:8010
```

Bu sunucu `no-store` gönderiyor: yenilemek yetiyor, hard refresh gerekmez.
(`python3 -m http.server` cache başlığı göndermediği için eski JS'i tutuyor.)

---

## 2. ⚠️ Senden lazım olanlar

Site şu an **tasarım olarak bitmiş**, ama aşağıdakiler örnek değerle duruyor.
Hepsi tek tek işaretli; dosyalarda `BURAYA` ve `<!-- ... değiştirilecek -->`
diye arayabilirsin.

| Ne | Nerede | Şu an |
|---|---|---|
| Supabase URL + anon anahtarı | `js/db.js` | `BURAYA_...` |
| Gürkan'ın telefonu | `js/db.js` · `sql/01-kurulum.sql` | `+905000000000` |
| Berkay'ın telefonu | `js/db.js` · `sql/01-kurulum.sql` | `+905000000001` |
| Fiyatlar | `js/db.js` · `index.html` · `randevu.html` · `sql/07-fiyatlar.sql` | ✅ 600 / 300 / 900 ₺ |
| Süreler | `js/db.js` · `sql/01-kurulum.sql` | 30 / 30 / 60 dk |
| Dükkân adresi | `index.html` (İletişim + JSON-LD) | ✅ 100. Yıl Cd. No:58, Aydıntepe, Tuzla |
| Dükkân telefonu | `index.html` (İletişim) | `+90 000 000 00 00` |
| Instagram | `index.html` (İletişim) | boş bağlantı |
| Çalışma saatleri | `index.html` · `sql/02-calisma-saatleri.sql` | 10:00–21:00, Pazar kapalı |
| Semt/ilçe | `index.html` (hero üstü) | ✅ Tuzla |
| Berber fotoğrafları | aşağıya bak | künye levhası |

**Telefon biçimi önemli:** `sql`'de `+905321112233`, `js/db.js`'de `905321112233`
(başında `+` yok — `wa.me` bağlantısı öyle istiyor).

Ayarlar girilmeden site çalışır ve gezilir; randevu ekranı saat listesi yerine
"veritabanı henüz bağlanmadı" yazar, panel de girişi kilitler. Sessizce
bozulmaz.

---

## 3. Supabase kurulumu

1. supabase.com'da yeni proje aç (bölge: **Frankfurt** — Türkiye'ye en yakını).
2. Project Settings → API'deki **URL** ve **anon** anahtarını `js/db.js`'e yapıştır.
3. SQL Editor'de dosyaları **sırayla** çalıştır:
   `01-kurulum.sql` → `02-calisma-saatleri.sql` → `03-yarim-saat.sql`
   → `04-bildirimler.sql` → `05-bildirim-tetikleyici.sql` → `06-esnek-slotlar.sql`

   `06` berbere özel blok düzenini getirir (NovaCut 1.4 ile aynı sistem):
   her berber panelde "Blok Düzenim"den saatlerini tek tek yazar, site
   randevu saatlerini birebir oradan gösterir. 05 henüz çalışmadıysa 06
   yine de çalışır; 05 sonradan çalışınca aynı filtreli tetikleyiciyi kurar.

   Sıra önemli: sonraki dosyalar önceki fonksiyonların üstüne yazıyor.
   `01`'i tekrar çalıştırırsan **hepsini** tekrar çalıştır.

4. Authentication → Users → Add user ile iki hesap aç:
   `gurkan@gurkanyilmaz.local` ve `berkay@gurkanyilmaz.local`.
   **Şifreleri ASCII tut** (Türkçe karakter berberin klavyesinden çıkmayabiliyor).
5. Oluşan user id'lerini `01-kurulum.sql`'in sonundaki `berber_hesap` insert'ine yaz.

Ayrıntılı adımlar (Edge Function, push bildirimi):
`~/.claude/skills/berber-randevu/referans/kurulum-rehberi.md`

### Kurulumdan sonra iki testi geç

- İki sekmede aynı saati almayı dene → biri hata almalı (`SAAT_DOLU`).
- anon anahtarla `randevular` tablosunu okumayı dene → **401** dönmeli.
  (Müşteri ad/telefonu tarayıcıya hiç dönmüyor; her şey security-definer
  fonksiyonlardan geçiyor.)

---

## 4. Berber fotoğrafları geldiğinde

Şu an üç yerde fırçalanmış çelik künye levhası var (baş harfler + koltuk no).
Fotoğraflar **9:16 dikey** çekilsin. Sonra:

**`index.html`** — `.plate-brushed` bloğunun içindekileri sil, yerine:
```html
<div class="plate">
  <img src="assets/img/berber-gurkan.jpg" alt="Gürkan Yılmaz" />
</div>
```
(`plate-brushed` sınıfı kalkınca kart 4:5'ten 9:16'ya döner — kasıtlı.)

**`randevu.html`** — `.engrave` ve `.plate-note` satırlarını silip
`<span class="choice-plate"><img src="..." alt="..." /></span>` yap.

**`berber.html`** — `.kim-mono` yerine `<img src="..." alt="" />`.

CSS'te değişiklik gerekmiyor; `img` kuralları zaten tanımlı.

---

## 5. Medyayı yeniden üretmek

Ham dosyalar `medya-kaynak/` altında (git'e girmiyor).

```bash
bash medya-hazirla.sh
```

Video 4K/5,4 sn'lik ham klipten üretiliyor: %75 hıza yavaşlatılıyor, sonun
son saniyesi başın ilk saniyesine eritilerek **kusursuz döngü** yapılıyor
(başa dönerken kesme yok) ve doygunluk 0,18'e indiriliyor. Tarayıcıda CSS
`filter` ile yapmak yerine dosyaya işleniyor — mobil GPU'yu yormuyor.

---

## 6. Yayına alma

Vercel'e `site/` klasörünü bağla. `.vercelignore` SQL'i, ham medyayı ve
sunucu betiğini yayından çıkarıyor.

`vercel.json`'a **Cache-Control kuralı yazma** — Vercel statik dosyaları zaten
doğru başlıklarla sunuyor. Header girdilerinde yalnız `source`, `headers`,
`has`, `missing` geçerli; başka alan eklersen deploy reddediliyor.

---

## 7. Mobil uygulama (isteğe bağlı)

Berberlere push bildirimli iOS/Android uygulaması isteniyorsa randevu skill'i
Capacitor projesini de kuruyor:

```bash
node ~/.claude/skills/berber-randevu/scripts/kur.mjs marka.json .
```

Firebase + APNs anahtarı gerekiyor; adımlar skill'in `kurulum-rehberi.md`
dosyasında. Şu an kurulmadı — site ve panel tarayıcıdan çalışıyor.

---

## Notlar

- **Değiştirme:** `cakisma_yok` exclusion constraint çifte randevuyu
  veritabanı seviyesinde engelliyor. "Önce kontrol et sonra yaz" yaklaşımı
  aradaki milisaniyede kırılır.
- **Değiştirme:** `[hidden] { display: none !important; }` (`berber.css`
  ilk satırı). Tarayıcının kendi kuralı zayıf; bu satır olmadan panel giriş
  ekranının altında açılıyor.
- Supabase kitaplığı CDN'den **tembel** yükleniyor. Düz `import` olsaydı CDN'e
  erişilemediği anda randevu ekranının tamamı ölürdü.
- `service_role` anahtarı bu klasörde hiçbir yerde kullanılmıyor; buraya asla
  yapıştırma.
