/* Gürkan Yılmaz — The Barber — Berber paneli.
   Berber kendi randevularını görür, onaylar, iptal eder ve saat kapatır.
   Beklemede olan randevular sarı durur: müşteri WhatsApp mesajını göndermemiş olabilir,
   berber tek dokunuşla arar veya WhatsApp'tan yazar. */

import { dbAl, AYARLI, HIZMETLER, SLOT_DK, iki, tarihAnahtari, telYaz } from "./db.js?v=1";

/* Supabase istemcisi db.js'te tembel yükleniyor (CDN'e erişilemezse tüm modül
   düşmesin diye). Panelin tamamı ona bağlı olduğu için burada bir kez alıp
   yoksa girişi kilitliyoruz — boş bir ekranla baş başa bırakmıyoruz. */
const db = await dbAl();
if (!db) {
  const kutu = document.querySelector("#girisHata");
  if (kutu) {
    kutu.textContent = AYARLI
      ? "Sunucuya ulaşılamadı. Bağlantını kontrol edip sayfayı yenile."
      : "Randevu veritabanı henüz bağlanmadı: js/db.js içindeki Supabase adresi ve anon anahtarı doldurulmalı.";
    kutu.classList.add("show");
  }
  const btn = document.querySelector("#girisBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Bağlantı yok"; }
  throw new Error("Supabase bağlantısı yok");
}

/** "10:30" -> 630 dakika */
const dkCevir = (s) => {
  const [a, b] = s.split(":").map(Number);
  return a * 60 + b;
};
/** 630 -> "10:30" */
const dkYaz = (d) => iki(Math.floor(d / 60)) + ":" + iki(d % 60);

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

const GUN_KISA = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const AY_KISA  = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

let berberId = null;
let berberAdi = "";
let seciliGun = new Date();
let randevular = [];

seciliGun.setHours(0, 0, 0, 0);

/* ---------- yardımcılar ---------- */
const istSaat = (iso) =>
  new Date(iso).toLocaleTimeString("tr-TR", {
    timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit",
  });

/** Gün başlangıcı/bitişi — İstanbul saatine göre, UTC ISO olarak */
const gunAraligi = (d) => {
  const a = tarihAnahtari(d);
  const son = new Date(d); son.setDate(son.getDate() + 1);
  return [`${a}T00:00:00+03:00`, `${tarihAnahtari(son)}T00:00:00+03:00`];
};

/** Beklemede olup 30 dakikası dolmuş kayıt = müşteri mesajı göndermemiş */
const suresiGecti = (r) =>
  r.durum === "beklemede" &&
  Date.now() - new Date(r.olusturuldu).getTime() > 30 * 60 * 1000;

function hataYaz(el, mesaj) {
  el.textContent = mesaj || "";
  el.classList.toggle("show", !!mesaj);
}

/* ---------- giriş ---------- */
const girisForm = $("#girisForm");
const girisHata = $("#girisHata");

// Berberler e-posta yazmasın: kim olduğunu seçer, arkada e-postaya çevrilir.
const EPOSTALAR = {
  gurkan: "gurkan@gurkanyilmaz.local",
  berkay: "berkay@gurkanyilmaz.local",
};

// Şifre ASCII saklanıyor. Klavyeden "ö/ü/ı/ş/ç/ğ" çıkmayabildiği için
// yazılanı sadeleştiriyoruz: "gürkanyönetim" de "gurkanyonetim" de kabul edilsin.
const TR_ASCII = { "ö":"o","Ö":"o","ü":"u","Ü":"u","ı":"i","İ":"i",
                   "ş":"s","Ş":"s","ç":"c","Ç":"c","ğ":"g","Ğ":"g" };
const sifreSadelestir = (s) =>
  s.replace(/[öÖüÜıİşŞçÇğĞ]/g, (c) => TR_ASCII[c]).toLowerCase();

// Son giren kişi hatırlansın — her seferinde seçmesinler.
let seciliBerber = localStorage.getItem("gurkanyilmaz_berber");
if (!EPOSTALAR[seciliBerber]) seciliBerber = null;

function kimCiz() {
  $$(".kim").forEach((b) =>
    b.classList.toggle("secili", b.dataset.berber === seciliBerber));
}

$$(".kim").forEach((b) =>
  b.addEventListener("click", () => {
    seciliBerber = b.dataset.berber;
    kimCiz();
    hataYaz(girisHata, "");
    $("#gSifre").focus();
  }));

kimCiz();

// Ekrandaki sürüm damgası: bu yazı görünüyorsa güncel JS çalışıyor demektir.
const SURUM = "1";
$("#surum").textContent = SURUM;

$("#gozBtn").addEventListener("click", () => {
  const alan = $("#gSifre");
  const gizli = alan.type === "password";
  alan.type = gizli ? "text" : "password";
  $("#gozBtn").textContent = gizli ? "Gizle" : "Göster";
  alan.focus();
});

girisForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hataYaz(girisHata, "");

  if (!seciliBerber) {
    hataYaz(girisHata, "Önce kim olduğunu seç.");
    return;
  }

  const btn = $("#girisBtn");
  btn.disabled = true; btn.textContent = "Giriş yapılıyor…";

  const { error } = await db.auth.signInWithPassword({
    email: EPOSTALAR[seciliBerber],
    password: sifreSadelestir($("#gSifre").value),
  });

  btn.disabled = false; btn.textContent = "Giriş Yap";
  if (error) {
    hataYaz(girisHata, "Şifre hatalı.");
    $("#gSifre").select();
    return;
  }
  localStorage.setItem("gurkanyilmaz_berber", seciliBerber);

  // Panel açılırken bir şey patlarsa sessiz kalmasın — ekranda görünsün.
  try {
    await panelAc();
  } catch (e) {
    hataYaz(girisHata, "Panel açılamadı: " + (e && e.message ? e.message : e));
    console.error("panelAc hatası:", e);
  }
});

// Hiçbir hata sessizce kaybolmasın.
window.addEventListener("unhandledrejection", (e) => {
  const m = e.reason && (e.reason.message || e.reason);
  hataYaz(girisHata, "Beklenmeyen hata: " + m);
  console.error("yakalanmamış:", e.reason);
});
window.addEventListener("error", (e) => {
  hataYaz(girisHata, "Beklenmeyen hata: " + e.message);
});

$("#cikisBtn").addEventListener("click", async () => {
  await db.auth.signOut();
  location.reload();
});

/* ---------- panel açılışı ---------- */
async function panelAc() {
  const { data: hesap, error } = await db
    .from("berber_hesap").select("berber_id").single();

  if (error || !hesap) {
    hataYaz(girisHata, "Bu hesap bir berbere bağlı değil. Kurulumu tamamlayın.");
    await db.auth.signOut();
    return;
  }

  berberId = hesap.berber_id;

  const { data: b } = await db
    .from("berberler").select("ad").eq("id", berberId).single();
  berberAdi = b?.ad || "Berber";

  $("#berberAdi").textContent = berberAdi;
  $("#girisEkrani").hidden = true;
  $("#panelEkrani").hidden = false;

  gunSeridiCiz();
  await programYukle();
  await yenile();
}

/* ---------- gün şeridi ---------- */
function gunSeridiCiz() {
  const el = $("#gunSerit");
  el.innerHTML = "";
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);

  for (let i = 0; i < 10; i++) {
    const d = new Date(bugun); d.setDate(bugun.getDate() + i);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gun-cip" +
      (tarihAnahtari(d) === tarihAnahtari(seciliGun) ? " secili" : "");
    b.innerHTML =
      `<span class="g">${i === 0 ? "Bugün" : GUN_KISA[d.getDay()]}</span>` +
      `<span class="n">${d.getDate()}</span>` +
      `<span class="a">${AY_KISA[d.getMonth()]}</span>`;
    b.addEventListener("click", async () => {
      seciliGun = d;
      gunSeridiCiz();
      await yenile();
    });
    el.appendChild(b);
  }
}

/* ---------- veri ---------- */
async function yenile() {
  const [bas, son] = gunAraligi(seciliGun);
  const { data, error } = await db
    .from("randevular")
    .select("*")
    .eq("berber_id", berberId)
    .neq("durum", "iptal")
    .gte("baslangic", bas)
    .lt("baslangic", son)
    .order("baslangic");

  randevular = error ? [] : data;
  listeCiz();
  ozetCiz();
  kapatIzgarasiCiz();
}

function ozetCiz() {
  const onayli = randevular.filter((r) => r.durum === "onayli").length;
  const bekleyen = randevular.filter((r) => r.durum === "beklemede" && !suresiGecti(r)).length;
  const cevapsiz = randevular.filter(suresiGecti).length;

  $("#ozet").innerHTML = `
    <div class="ozet-kutu"><b>${onayli}</b><span>Onaylı</span></div>
    <div class="ozet-kutu sari"><b>${bekleyen}</b><span>Bekliyor</span></div>
    <div class="ozet-kutu kirmizi"><b>${cevapsiz}</b><span>Mesaj gelmedi</span></div>`;
}

function listeCiz() {
  const el = $("#liste");

  if (!randevular.length) {
    el.innerHTML = '<p class="bos">Bu gün için randevun yok.</p>';
    return;
  }

  el.innerHTML = randevular.map((r) => {
    const gecti = suresiGecti(r);
    const durumSinif = r.durum === "onayli" ? "onayli" : (gecti ? "cevapsiz" : "bekliyor");
    const durumYazi  = r.durum === "onayli" ? "Onaylı"
                     : (gecti ? "Mesaj gelmedi" : "Bekliyor");

    const hizmet = HIZMETLER[r.hizmet_id]?.ad || r.hizmet_id;
    const waMetin = encodeURIComponent(
      `Merhaba ${r.musteri_ad}, Gürkan Yılmaz — The Barber adına yazıyorum. ` +
      `${istSaat(r.baslangic)} randevunuz için teyit alabilir miyim?`
    );

    return `
      <article class="randevu ${durumSinif}" data-id="${r.id}">
        <div class="r-ust">
          <div class="r-saat">${istSaat(r.baslangic)}</div>
          <span class="r-rozet">${durumYazi}</span>
        </div>
        <div class="r-ad">${r.musteri_ad}</div>
        <div class="r-detay">${hizmet} · ${telYaz(r.musteri_tel)}</div>

        ${gecti ? '<p class="r-uyari">Müşteri WhatsApp mesajını göndermemiş. Arayıp teyit al.</p>' : ""}

        <div class="r-islem">
          <a class="ikon-btn wa" href="https://wa.me/${r.musteri_tel}?text=${waMetin}"
             target="_blank" rel="noopener">WhatsApp</a>
          <a class="ikon-btn ara" href="tel:+${r.musteri_tel}">Ara</a>
          ${r.durum !== "onayli"
            ? `<button class="ikon-btn onay" type="button" data-onay="${r.id}">Onayla</button>`
            : ""}
          <button class="ikon-btn iptal" type="button" data-iptal="${r.id}">İptal</button>
        </div>
      </article>`;
  }).join("");

  $$("[data-onay]", el).forEach((b) =>
    b.addEventListener("click", () => durumDegistir(b.dataset.onay, "onayli")));

  $$("[data-iptal]", el).forEach((b) =>
    b.addEventListener("click", () => {
      if (confirm("Bu randevu iptal edilsin mi? Saat siteden tekrar alınabilir olacak.")) {
        durumDegistir(b.dataset.iptal, "iptal");
      }
    }));
}

async function durumDegistir(id, durum) {
  const { error } = await db.from("randevular").update({ durum }).eq("id", id);
  if (error) { alert("Güncellenemedi, tekrar deneyin."); return; }
  await yenile();
}

/* ---------- saat kapatma ---------- */
/* Izgara sabit değil: berberin o güne yazdığı çalışma saatlerinden üretilir. */
function kapatIzgarasiCiz() {
  const el = $("#kapatIzgara");
  el.innerHTML = "";

  const gunAyari = program.find((g) => g.gun === seciliGun.getDay());

  if (!gunAyari || gunAyari.kapali) {
    el.innerHTML = '<p class="izgara-bos">Bu gün izin günün — randevu alınamıyor. ' +
                   'Aşağıdaki programdan değiştirebilirsin.</p>';
    return;
  }

  // Randevunun kapladığı HER yarım saat dolu sayılmalı: 1 saatlik
  // saç & sakal iki slot birden kaplar.
  const dolu = new Set();
  for (const r of randevular) {
    let t = new Date(r.baslangic);
    const son = new Date(r.bitis);
    while (t < son) {
      dolu.add(istSaat(t.toISOString()));
      t = new Date(+t + SLOT_DK * 60000);
    }
  }

  for (let d = dkCevir(gunAyari.acilis); d < dkCevir(gunAyari.kapanis); d += SLOT_DK) {
    const saat = dkYaz(d);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kapat-slot" + (dolu.has(saat) ? " dolu" : "");
    b.textContent = saat;
    b.disabled = dolu.has(saat);
    b.title = dolu.has(saat) ? "Bu saat zaten dolu" : "Dokun, kapat";
    b.addEventListener("click", () => saatKapat(saat, b));
    el.appendChild(b);
  }
}

async function saatKapat(saat, btn) {
  btn.disabled = true;
  const bas = `${tarihAnahtari(seciliGun)}T${saat}:00+03:00`;
  const bit = new Date(+new Date(bas) + SLOT_DK * 60000).toISOString();

  const { error } = await db.from("randevular").insert({
    berber_id: berberId,
    hizmet_id: "kapali",
    musteri_ad: "Telefonla randevu",
    musteri_tel: "0",
    baslangic: new Date(bas).toISOString(),
    bitis: bit,
    durum: "onayli",
  });

  if (error) {
    alert(error.code === "23P01" ? "Bu saat zaten dolu." : "Kapatılamadı, tekrar deneyin.");
    btn.disabled = false;
    return;
  }
  await yenile();
}

/* ---------- haftalık çalışma programı ---------- */
const GUN_ADI = ["Pazar", "Pazartesi", "Salı", "Çarşamba",
                 "Perşembe", "Cuma", "Cumartesi"];
// Hafta Pazartesi'den başlasın, Pazar sona
const GUN_SIRA = [1, 2, 3, 4, 5, 6, 0];

let program = [];        // ekrandaki hâli
let programKayitli = ""; // en son kaydedilen hâli (karşılaştırma için)

// 06:00–23:30 arası yarım saatlik adımlar — berber aralığı ince ayarlayabilsin.
const SAAT_SECENEK = Array.from({ length: 36 }, (_, i) => dkYaz(360 + i * SLOT_DK));

const programImza = (p) =>
  JSON.stringify(p.map((g) => [g.gun, g.acilis, g.kapanis, g.kapali]));

async function programYukle() {
  const { data, error } = await db
    .from("calisma_saatleri")
    .select("gun, acilis, kapanis, kapali")
    .eq("berber_id", berberId);

  if (error || !data) { program = []; return; }

  program = GUN_SIRA.map((g) => {
    const s = data.find((x) => x.gun === g);
    return {
      gun: g,
      acilis:  (s?.acilis  || "10:00:00").slice(0, 5),
      kapanis: (s?.kapanis || "21:00:00").slice(0, 5),
      kapali:  s?.kapali ?? (g === 0),
    };
  });
  programKayitli = programImza(program);
  programCiz();
}

function saatSecimi(deger, sinif, gun, alan) {
  const secenekler = SAAT_SECENEK
    .map((s) => `<option value="${s}"${s === deger ? " selected" : ""}>${s}</option>`)
    .join("");
  return `<select class="${sinif}" data-gun="${gun}" data-alan="${alan}">${secenekler}</select>`;
}

function programCiz() {
  const el = $("#program");

  el.innerHTML = program.map((g) => {
    const slot = g.kapali ? 0 : Math.max(
      0, (dkCevir(g.kapanis) - dkCevir(g.acilis)) / SLOT_DK);

    return `
      <div class="p-gun ${g.kapali ? "kapali" : ""}" data-gun="${g.gun}">
        <div class="p-ad">
          <span>${GUN_ADI[g.gun]}</span>
          <small>${g.kapali ? "İzin günü" : slot + " slot · yarım saatlik"}</small>
        </div>

        <div class="p-saatler">
          ${saatSecimi(g.acilis,  "p-sec", g.gun, "acilis")}
          <span class="p-tire">—</span>
          ${saatSecimi(g.kapanis, "p-sec", g.gun, "kapanis")}
        </div>

        <button class="p-anahtar ${g.kapali ? "" : "acik"}" type="button"
                data-toggle="${g.gun}"
                aria-label="${GUN_ADI[g.gun]} ${g.kapali ? "aç" : "kapat"}">
          <span class="p-topuz"></span>
        </button>
      </div>`;
  }).join("");

  $$("[data-toggle]", el).forEach((b) =>
    b.addEventListener("click", () => {
      const g = program.find((x) => x.gun === +b.dataset.toggle);
      g.kapali = !g.kapali;
      programCiz();
    }));

  $$(".p-sec", el).forEach((s) =>
    s.addEventListener("change", () => {
      const g = program.find((x) => x.gun === +s.dataset.gun);
      g[s.dataset.alan] = s.value;
      // Kapanış açılıştan sonra olmak zorunda — kullanıcıyı uğraştırma, düzelt.
      if (dkCevir(g.kapanis) <= dkCevir(g.acilis)) {
        if (s.dataset.alan === "acilis") {
          g.kapanis = dkYaz(Math.min(dkCevir(g.acilis) + SLOT_DK, 23 * 60 + 30));
        } else {
          g.acilis = dkYaz(Math.max(dkCevir(g.kapanis) - SLOT_DK, 0));
        }
      }
      programCiz();
    }));

  programDurumCiz();
}

function programDurumCiz() {
  const degisti = programImza(program) !== programKayitli;
  $("#programKaydet").disabled = !degisti;
  $("#programGeri").disabled = !degisti;
  const d = $("#programDurum");
  d.textContent = degisti ? "Kaydedilmedi" : "Güncel";
  d.className = "program-durum" + (degisti ? " bekliyor" : "");
}

$("#programKaydet").addEventListener("click", async () => {
  const btn = $("#programKaydet");
  btn.disabled = true; btn.textContent = "Kaydediliyor…";

  let hata = null;
  for (const g of program) {
    const { error } = await db.from("calisma_saatleri")
      .update({ acilis: g.acilis, kapanis: g.kapanis, kapali: g.kapali })
      .eq("berber_id", berberId).eq("gun", g.gun);
    if (error) { hata = error; break; }
  }

  btn.textContent = "Kaydet";

  if (hata) {
    alert("Kaydedilemedi: " + hata.message);
    btn.disabled = false;
    return;
  }

  programKayitli = programImza(program);
  programDurumCiz();
  await yenile();          // saat kapatma ızgarası da yeni programa uysun
});

$("#programGeri").addEventListener("click", programYukle);

/* ---------- açılış ----------
   Webde panelde müşteri ad ve telefonları var; linki eline geçen herkes
   girebilmesin diye her açılışta şifre sorulur.

   Uygulamada (UYGULAMA_NATIVE) oturum korunur: telefonun kendi kilidi zaten var
   ve berberin gün içinde onlarca kez şifre yazması işkence olurdu. */
const { data: { session } } = await db.auth.getSession();
if (session) {
  if (window.UYGULAMA_NATIVE) await panelAc();
  else await db.auth.signOut();
}

/* Panel açıkken 60 saniyede bir tazele — yeni randevu kendiliğinden düşsün */
setInterval(() => { if (berberId) yenile(); }, 60000);
