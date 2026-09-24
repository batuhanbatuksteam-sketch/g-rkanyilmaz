/* ============================================================
   GÜRKAN YILMAZ — THE BARBER · Ayarlar ve Supabase bağlantısı

   ⚠️  SİTENİN DOLDURULMASI GEREKEN TEK DOSYASI BURASI.
   Aşağıdaki üç bloğu doldur, gerisi kendiliğinden çalışır.

   anon anahtarı gizli değildir — güvenlik veritabanındaki RLS kuralları ve
   security-definer fonksiyonlarla sağlanıyor. service_role anahtarı bu
   klasörde HİÇBİR yerde kullanılmaz, buraya da asla yapıştırma.
   ============================================================ */

/* ---------- 1) Supabase ----------
   Supabase → Project Settings → API sayfasındaki iki değer. */
export const SUPABASE_URL      = "https://ewnjlkoutgywkeyuwlmg.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_jLkX0Sa8tXLS2IzhrHUf9A_JdXJ0_6W";

/* Ayarlar girilmemişken sayfa sessizce boş kalmasın: randevu ekranı bunu
   okuyup "veritabanı bağlı değil" diye yazıyor, gizemli bir hata vermiyor. */
export const AYARLI =
  !SUPABASE_URL.startsWith("BURAYA") && !SUPABASE_ANON_KEY.startsWith("BURAYA");

/* Supabase kitaplığı CDN'den TEMBEL yükleniyor. Üstte düz bir `import`
   olsaydı CDN'e erişilemediği anda modül komple düşerdi ve randevu ekranı
   tamamen ölürdü — adımlar, hizmetler, geri düğmesi dahil hiçbiri
   çalışmazdı. Böyle olunca ağ koparsa yalnızca saatler gelmiyor,
   ekranın kalanı ayakta kalıyor. */
let _db = null;
export async function dbAl() {
  if (!AYARLI) return null;
  if (_db) return _db;
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    _db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch {
    return null;   // çağıran taraf "bağlanılamadı" diye gösteriyor
  }
  return _db;
}

/* ---------- 2) Berberler ----------
   tel: WhatsApp derin bağlantısı için, ülke kodlu ve yalnız rakam.
   '+90 532 111 22 33' → '905321112233'
   Anahtarlar (gurkan / berkay) veritabanındaki berberler.id ile,
   ayrıca index.html ve randevu.html'deki data-barber ile aynı olmalı. */
export const BERBERLER = {
  gurkan: { ad: "Gürkan Yılmaz", tel: "905358373452" },
  berkay: { ad: "Berkay Özer",   tel: "905358373452" },  // kendi numarası gelene dek Gürkan'a gidiyor
};

/* ---------- 3) Hizmetler ----------
   sure_dk veritabanındaki hizmetler.sure_dk ile AYNI olmalı; slotlar
   yarım saatlik, saç & sakal iki dilim birden kaplıyor.
   Fiyatı değiştirirsen randevu.html ve index.html'deki yazıyı da güncelle. */
export const HIZMETLER = {
  sac:      { ad: "Saç",         fiyat: 750,  sure_dk: 30, sure: "30 dk" },
  sakal:    { ad: "Sakal",       fiyat: 350,  sure_dk: 30, sure: "30 dk" },
  sacsakal: { ad: "Saç & Sakal", fiyat: 1000, sure_dk: 60, sure: "1 saat" },
};

/* Berber panelinde saat kapatma bu dilimle yapılıyor. */
export const SLOT_DK = 30;

/* Randevu mesajında görünen dükkân adı. */
export const MARKA_AD = "Gürkan Yılmaz — The Barber";

/* ============================================================
   Buradan aşağısı ortak yardımcılar — değiştirmen gerekmiyor.
   ============================================================ */

export const GUNLER = ["Pazar","Pazartesi","Salı","Çarşamba","Perşembe","Cuma","Cumartesi"];
export const AYLAR  = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
                       "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];

export const iki = (n) => String(n).padStart(2, "0");

/** Date → '2026-09-01' (yerel gün; toISOString UTC'ye kaydırıp günü bozar) */
export const tarihAnahtari = (d) =>
  d.getFullYear() + "-" + iki(d.getMonth() + 1) + "-" + iki(d.getDate());

/** '2026-09-01' → '1 Eylül Pazartesi' */
export function tarihYaz(anahtar) {
  const d = new Date(anahtar + "T12:00:00+03:00");
  return `${d.getDate()} ${AYLAR[d.getMonth()]} ${GUNLER[d.getDay()]}`;
}

/** '905321112233' → '0532 111 22 33' */
export function telYaz(tel) {
  const d = String(tel).replace(/\D/g, "").replace(/^90/, "");
  return d.length === 10
    ? `0${d.slice(0,3)} ${d.slice(3,6)} ${d.slice(6,8)} ${d.slice(8)}`
    : tel;
}
