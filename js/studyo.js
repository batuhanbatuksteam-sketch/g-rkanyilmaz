/* Gürkan Yılmaz — The Barber — Foto Stüdyo.
 *
 * Berber günün tıraş fotoğraflarını seçer, sunucu (supabase/functions/foto-studyo)
 * Nano Banana Pro ile saça ve yüze dokunmadan ışığı ve arka planı düzeltir.
 * Para ve sınırlar tamamen sunucuda; burada sadece gösteriliyor.
 *
 * Sekme yalnızca foto_cuzdan'da satırı olan berbere görünür.
 */
import { dbAl } from "./db.js?v=4";

const KOVA = "foto-studyo";
const EN_FAZLA = 5;
const UZUN_KENAR = 2048;   // 2K çıktı için yeter, yükleme hızlı olur

const $ = (s, c = document) => c.querySelector(s);

const HATALAR = {
  BAKIYE_YETERSIZ:   "Bakiye yetmedi. Yükleme için yöneticine haber ver.",
  GUNLUK_SINIR:      "Bugünkü fotoğraf hakkın doldu, yarın yenilenir.",
  TEKRAR_KULLANILDI: "Bu fotoğrafın ücretsiz tekrarı zaten kullanıldı.",
  TEKRAR_YOK:        "Bu fotoğraf tekrar denenemiyor.",
  OTURUM_YOK:        "Oturum düştü. Çıkış yapıp tekrar gir.",
};
const hataMetni = (kod) => HATALAR[kod] || "Bir sorun oldu, tekrar dene.";

const istGun = (iso) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));

const gunBasligi = (anahtar) => {
  if (anahtar === istGun(new Date())) return "Bugün";
  const dun = new Date(); dun.setDate(dun.getDate() - 1);
  if (anahtar === istGun(dun)) return "Dün";
  return new Date(anahtar + "T12:00:00+03:00")
    .toLocaleDateString("tr-TR", { day: "numeric", month: "long", weekday: "long" });
};

const db = await dbAl();

let cuzdan = null;       // { berber_id, bakiye, birim_fiyat, gunluk_sinir }
let isler = [];
let secilenler = [];     // { blob, url }
let bakilan = null;      // görüntüleyicide açık iş
let yoklamaSaati = null;
let sonYoklama = 0;
const adresler = new Map();   // storage yolu -> { url, bitis }

if (db) {
  db.auth.onAuthStateChange((olay, oturum) => {
    // Supabase dinleyicinin içinde başka istek beklenmemesini istiyor.
    setTimeout(() => (oturum ? kontrol() : kapat()), 0);
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && cuzdan) yukle();
  });
}

/* ---------------------------------------------------------------- sekme */
async function kontrol() {
  const { data, error } = await db.from("foto_cuzdan").select("*").maybeSingle();
  // Tablo yoksa (08 çalışmadıysa) ya da berberin cüzdanı yoksa sekme hiç çıkmaz.
  if (error || !data) return kapat();
  cuzdan = data;
  $("#panelSekme").hidden = false;
  yukle();
}

function kapat() {
  cuzdan = null;
  $("#panelSekme").hidden = true;
  sekmeSec("randevu");
}

function sekmeSec(ad) {
  const studyo = ad === "studyo";
  $("#panelEkrani").classList.toggle("studyo-acik", studyo);
  $("#studyo").hidden = !studyo;
  document.querySelectorAll("#panelSekme button").forEach((b) =>
    b.classList.toggle("secili", b.dataset.sekme === ad));
  if (studyo) window.scrollTo({ top: 0 });
}

document.querySelectorAll("#panelSekme button").forEach((b) =>
  b.addEventListener("click", () => sekmeSec(b.dataset.sekme)));

/* ---------------------------------------------------------------- veri */
async function yukle() {
  const [c, i] = await Promise.all([
    db.from("foto_cuzdan").select("*").maybeSingle(),
    db.from("foto_is").select("*").order("olusturuldu", { ascending: false }).limit(60),
  ]);
  if (c.data) cuzdan = c.data;
  if (i.data) isler = i.data;
  await adresHazirla(isler.flatMap((x) => [x.girdi, x.cikti]).filter(Boolean));
  ciz();
  yoklamaKur();
}

/** İmzalı adresleri toplu alır; bir saat geçerli, dolmadan yenilenir. */
async function adresHazirla(yollar) {
  const simdi = Date.now();
  const eksik = [...new Set(yollar)].filter((y) => !(adresler.get(y)?.bitis > simdi));
  if (!eksik.length) return;
  const { data } = await db.storage.from(KOVA).createSignedUrls(eksik, 3600);
  (data || []).forEach((d) => {
    if (d.signedUrl) adresler.set(d.path, { url: d.signedUrl, bitis: simdi + 50 * 60_000 });
  });
}
const adres = (yol) => adresler.get(yol)?.url || "";

/** İşlenen iş varsa tabloya bakmaya devam et; webhook gecikirse sunucuya sordur. */
function yoklamaKur() {
  clearTimeout(yoklamaSaati);
  const bekleyen = isler.filter((x) => x.durum === "isleniyor");
  if (!bekleyen.length) return;

  yoklamaSaati = setTimeout(async () => {
    const eski = bekleyen.filter((x) => Date.now() - new Date(x.olusturuldu) > 75_000);
    if (eski.length && Date.now() - sonYoklama > 20_000) {
      sonYoklama = Date.now();
      await db.functions.invoke("foto-studyo", { body: { yokla: eski.map((x) => x.id) } })
        .catch(() => {});
    }
    yukle();
  }, 4000);
}

/* ---------------------------------------------------------------- çizim */
const bugunkuSayi = () => {
  const bugun = istGun(new Date());
  return isler.filter((x) => x.ucret > 0 && x.durum !== "hata" && istGun(x.olusturuldu) === bugun).length;
};

function ciz() {
  if (!cuzdan) return;
  const fiyat = cuzdan.birim_fiyat;
  $("#stBakiye").textContent = cuzdan.bakiye.toLocaleString("tr-TR") + " ₺";
  $("#stHak").textContent = Math.floor(cuzdan.bakiye / fiyat) + " fotoğraf hakkı";
  $("#stBugun").textContent = `${bugunkuSayi()}/${cuzdan.gunluk_sinir}`;
  $("#stFiyat").textContent = `En fazla ${EN_FAZLA} · her biri ${fiyat} ₺`;
  seciliCiz();
  izgaraCiz();
}

function seciliCiz() {
  const kutu = $("#stSecilen");
  kutu.hidden = !secilenler.length;
  if (!secilenler.length) return;

  $("#stOnizleme").innerHTML = secilenler.map((s, n) => `
    <figure class="st-kucuk">
      <img src="${s.url}" alt="" decoding="async" />
      <button type="button" data-cikar="${n}" aria-label="Çıkar">×</button>
    </figure>`).join("");

  const toplam = secilenler.length * cuzdan.birim_fiyat;
  const btn = $("#stGonder");
  btn.textContent = `${secilenler.length} fotoğraf · ${toplam} ₺ — Düzenle`;

  let hata = "";
  const kalanGun = cuzdan.gunluk_sinir - bugunkuSayi();
  if (secilenler.length > kalanGun) hata = `Bugün ${Math.max(kalanGun, 0)} fotoğraf hakkın kaldı.`;
  else if (toplam > cuzdan.bakiye) hata = hataMetni("BAKIYE_YETERSIZ");
  hataYaz(hata);
  btn.disabled = !!hata;
}

function izgaraCiz() {
  const kutu = $("#stIzgara");
  if (!isler.length) {
    kutu.innerHTML = `<p class="st-bos">Henüz fotoğraf yok. Günün ilk tıraşını seçerek başla.</p>`;
    return;
  }
  const gruplar = new Map();
  isler.forEach((x) => {
    const g = istGun(x.olusturuldu);
    if (!gruplar.has(g)) gruplar.set(g, []);
    gruplar.get(g).push(x);
  });

  kutu.innerHTML = [...gruplar].map(([gun, liste]) => `
    <h3 class="st-gun-baslik">${gunBasligi(gun)}</h3>
    <div class="st-izgara-ic">${liste.map(kartHtml).join("")}</div>`).join("");
}

function kartHtml(x) {
  const resim = x.durum === "hazir" ? adres(x.cikti) : adres(x.girdi);
  const etiket = {
    isleniyor: `<span class="st-durum isleniyor"><i></i>İşleniyor</span>`,
    hata:      `<span class="st-durum hata">${x.ucret ? "Olmadı · iade edildi" : "Olmadı"}</span>`,
    hazir:     x.kaynak_is ? `<span class="st-durum tekrar">Tekrar</span>` : "",
  }[x.durum];
  return `
    <button type="button" class="st-kart ${x.durum}" data-is="${x.id}" ${x.durum === "hazir" ? "" : "disabled"}>
      <img src="${resim}" alt="" loading="lazy" decoding="async" />
      ${etiket}
    </button>`;
}

function hataYaz(m) {
  const el = $("#stHata");
  el.textContent = m || "";
  el.classList.toggle("show", !!m);
}

/* ---------------------------------------------------------------- seçim */
$("#stDosya").addEventListener("change", async (e) => {
  const dosyalar = [...e.target.files];
  e.target.value = "";   // aynı fotoğraf tekrar seçilebilsin
  if (!dosyalar.length) return;

  const yer = EN_FAZLA - secilenler.length;
  if (dosyalar.length > yer) hataYaz(`Tek seferde en fazla ${EN_FAZLA} fotoğraf.`);

  for (const d of dosyalar.slice(0, Math.max(yer, 0))) {
    try {
      const blob = await kucult(d);
      secilenler.push({ blob, url: URL.createObjectURL(blob) });
      seciliCiz();
    } catch {
      hataYaz("Bir fotoğraf açılamadı. Galeriden JPEG olarak tekrar dene.");
    }
  }
});

$("#stOnizleme").addEventListener("click", (e) => {
  const n = e.target.closest("[data-cikar]")?.dataset.cikar;
  if (n == null) return;
  URL.revokeObjectURL(secilenler[n].url);
  secilenler.splice(Number(n), 1);
  hataYaz("");
  seciliCiz();
});

/** Fotoğrafı uzun kenarı 2048 px olan JPEG'e indirir. iOS HEIC'i seçerken
 *  zaten JPEG'e çeviriyor; <img> EXIF yönünü de kendisi uyguluyor. */
async function kucult(dosya) {
  const kaynak = URL.createObjectURL(dosya);
  try {
    const img = new Image();
    img.src = kaynak;
    await img.decode();
    const olcek = Math.min(1, UZUN_KENAR / Math.max(img.naturalWidth, img.naturalHeight));
    const tuval = document.createElement("canvas");
    tuval.width = Math.round(img.naturalWidth * olcek);
    tuval.height = Math.round(img.naturalHeight * olcek);
    tuval.getContext("2d").drawImage(img, 0, 0, tuval.width, tuval.height);
    return await new Promise((ok, red) =>
      tuval.toBlob((b) => (b ? ok(b) : red(new Error("jpeg"))), "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(kaynak);
  }
}

/* ---------------------------------------------------------------- gönder */
$("#stGonder").addEventListener("click", async () => {
  const btn = $("#stGonder");
  btn.disabled = true;
  btn.textContent = "Yükleniyor…";
  hataYaz("");

  try {
    const yollar = await Promise.all(secilenler.map(async (s) => {
      const yol = `${cuzdan.berber_id}/girdi/${crypto.randomUUID()}.jpg`;
      const { error } = await db.storage.from(KOVA).upload(yol, s.blob, { contentType: "image/jpeg" });
      if (error) throw error;
      return yol;
    }));

    const { data, error } = await db.functions.invoke("foto-studyo", { body: { girdiler: yollar } });
    if (error) throw error;

    const acilan = data.isler?.length || 0;
    secilenler.forEach((s) => URL.revokeObjectURL(s.url));
    secilenler = [];
    await yukle();
    if (data.hata) {
      hataYaz((acilan ? `${acilan} fotoğraf işleniyor. Kalanı için: ` : "") + hataMetni(data.hata));
    }
  } catch (e) {
    console.error(e);
    seciliCiz();
    hataYaz("Gönderilemedi. İnternetini kontrol edip tekrar dene.");
    btn.disabled = false;
  }
});

/* ---------------------------------------------------------------- görüntüleyici */
const bak = $("#stBak");

$("#stIzgara").addEventListener("click", (e) => {
  const id = e.target.closest("[data-is]")?.dataset.is;
  const x = isler.find((i) => i.id === id);
  if (x?.durum === "hazir") bakAc(x);
});

function bakAc(x) {
  bakilan = x;
  $("#stOnce").src = adres(x.girdi);
  $("#stSonra").src = adres(x.cikti);
  karsilastir(50);
  // Ücretli fotoğrafın bir ücretsiz tekrarı var; tekrarın tekrarı yok.
  const tekrarVar = isler.some((i) => i.kaynak_is === x.id);
  $("#stTekrar").hidden = x.ucret === 0 || tekrarVar;
  $("#stBakHata").classList.remove("show");
  bak.hidden = false;
  document.body.style.overflow = "hidden";
}

function bakKapat() {
  bak.hidden = true;
  bakilan = null;
  document.body.style.overflow = "";
}

function karsilastir(yuzde) {
  bak.style.setProperty("--kes", yuzde + "%");
}

// Parmağın olduğu yer çizgi olur; tutamacı aramak gerekmesin.
const karsi = $(".st-karsi");
const surukle = (e) => {
  const k = karsi.getBoundingClientRect();
  karsilastir(Math.min(100, Math.max(0, ((e.clientX - k.left) / k.width) * 100)));
};
karsi.addEventListener("pointerdown", (e) => {
  karsi.setPointerCapture(e.pointerId);
  surukle(e);
});
karsi.addEventListener("pointermove", (e) => {
  if (karsi.hasPointerCapture(e.pointerId)) surukle(e);
});
bak.querySelectorAll("[data-bak-kapat]").forEach((b) => b.addEventListener("click", bakKapat));

$("#stKaydet").addEventListener("click", async () => {
  const btn = $("#stKaydet");
  btn.disabled = true;
  try {
    await paylas(adres(bakilan.cikti), `gurkan-${bakilan.id.slice(0, 8)}.jpg`);
  } catch (e) {
    if (!/cancel|abort|iptal/i.test(String(e?.message || e))) {
      const el = $("#stBakHata");
      el.textContent = "Kaydedilemedi, tekrar dene.";
      el.classList.add("show");
    }
  } finally {
    btn.disabled = false;
  }
});

/** Uygulamada paylaşım sayfası açılır ("Resmi Kaydet" ile galeriye gider).
 *  Webde paylaşım yoksa fotoğraf yeni sekmede açılır. */
async function paylas(url, ad) {
  if (typeof window.UYGULAMA_PAYLAS === "function") return window.UYGULAMA_PAYLAS(url, ad);
  const blob = await (await fetch(url)).blob();
  const dosya = new File([blob], ad, { type: "image/jpeg" });
  if (navigator.canShare?.({ files: [dosya] })) return navigator.share({ files: [dosya] });
  window.open(url, "_blank", "noopener");
}

$("#stTekrar").addEventListener("click", async () => {
  const btn = $("#stTekrar");
  btn.disabled = true;
  const { data, error } = await db.functions.invoke("foto-studyo", { body: { tekrar: bakilan.id } });
  btn.disabled = false;
  if (error || data?.hata) {
    let kod = data?.hata;
    try { kod = kod || (await error.context.json()).hata; } catch { /* gövde yok */ }
    const el = $("#stBakHata");
    el.textContent = hataMetni(kod);
    el.classList.add("show");
    return;
  }
  bakKapat();
  yukle();
});
