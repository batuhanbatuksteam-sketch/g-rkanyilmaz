/* GÜRKAN YILMAZ — THE BARBER · Randevu akışı.

   Slotlar Supabase'den okunur. Randevu "beklemede" kaydedilir ve slot O AN
   dolar; müşteri WhatsApp'a yönlendirilir, berber panelden onaylar.
   Mesaj gönderilmezse 30 dakika sonra kayıt düşer ve slot kendiliğinden açılır.

   Çifte randevuyu veritabanındaki `cakisma_yok` kısıtı engelliyor, bu dosya
   değil. Buradaki kontroller yalnızca kullanıcıya iyi bir mesaj göstermek için. */

import { dbAl, AYARLI, BERBERLER, HIZMETLER, MARKA_AD,
         tarihAnahtari, tarihYaz } from "./db.js?v=4";

const $  = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

const tl = (n) => "₺" + n;
const GUN_KISA = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
const AY_KISA  = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const fmtDate  = (d) => d.getDate() + " " + AY_KISA[d.getMonth()] + " " + GUN_KISA[d.getDay()];

const state = { barber: null, service: null, date: null, time: null, first: "", last: "", phone: "" };
let current = 1;

/* "18:00" -> { musait, biter }. Dilim uzunluğu berbere göre değişebildiği
   için bitiş saatini de veritabanı söylüyor. */
let musaitlik = null;
let yukleniyor = false;
let baglantiKoptu = false;

/* ---------- doluluk ---------- */
async function musaitlikYukle() {
  musaitlik = null;
  if (!AYARLI || !state.barber || !state.date) return;
  yukleniyor = true;
  const db = await dbAl();
  if (!db) { yukleniyor = false; baglantiKoptu = true; musaitlik = new Map(); return; }
  baglantiKoptu = false;
  // Süre gönderiliyor: 60 dakikalık saç & sakal için iki dilim de boş olmalı,
  // yoksa kapanışı aşan bir randevu yazılabilir.
  const { data, error } = await db.rpc("gun_uygunluk", {
    p_berber: state.barber,
    p_tarih:  tarihAnahtari(state.date),
    p_sure_dk: HIZMETLER[state.service]?.sure_dk ?? 30,
  });
  yukleniyor = false;
  // Bağlantı koparsa saatleri BOŞ göstermek çifte randevu demek — kapalı göster.
  musaitlik = new Map((error ? [] : data).map((s) => [s.saat, { musait: s.musait, biter: s.biter }]));
}

/* ---------- çizim ---------- */
function renderDates() {
  const el = $("#dateScroll");
  el.innerHTML = "";
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  for (let i = 0; i < 12; i++) {
    const d = new Date(bugun); d.setDate(bugun.getDate() + i);
    const b = document.createElement("button");
    b.type = "button"; b.className = "date-chip"; b.dataset.key = tarihAnahtari(d);
    if (state.date && tarihAnahtari(state.date) === tarihAnahtari(d)) b.classList.add("selected");
    b.innerHTML = '<div class="d">' + (i === 0 ? "Bugün" : GUN_KISA[d.getDay()]) +
      '</div><div class="num">' + d.getDate() + '</div><div class="mo">' + AY_KISA[d.getMonth()] + '</div>';
    b.addEventListener("click", async () => {
      state.date = d; state.time = null;
      renderDates(); renderSlots(); refreshNext(); updateSummary();
      await musaitlikYukle();
      renderSlots();
    });
    el.appendChild(b);
  }
}

function slotMesaji(metin) {
  $("#slotGrid").innerHTML = '<p class="slot-msg">' + metin + "</p>";
}

function renderSlots() {
  const el = $("#slotGrid");
  if (!AYARLI) {
    // Sessizce boş kalmasın: eksik olanı açıkça söyle.
    slotMesaji("Randevu veritabanı henüz bağlanmadı. <code>js/db.js</code> içindeki " +
               "Supabase adresi ve anon anahtarı doldurulduğunda saatler burada listelenir.");
    return;
  }
  if (!state.date) { slotMesaji("Önce bir gün seç."); return; }
  if (yukleniyor || musaitlik === null) { slotMesaji("Uygun saatler yükleniyor…"); return; }
  if (musaitlik.size === 0) {
    slotMesaji(baglantiKoptu
      ? "Randevu sunucusuna ulaşılamadı. Bağlantını kontrol edip sayfayı yenile."
      : "Bu gün için açık saat yok. Başka bir gün seç ya da sayfayı yenile.");
    return;
  }
  el.innerHTML = "";
  for (const [saat, bilgi] of musaitlik) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "slot";
    // Bitiş saati de yazıyor: koltuğun ne kadar ayrıldığı görünsün.
    b.innerHTML = '<span class="s-bas">' + saat + "</span>" +
      (bilgi.biter ? '<span class="s-bit">' + bilgi.biter + "</span>" : "");
    if (!bilgi.musait) { b.classList.add("disabled"); b.disabled = true; b.title = "Dolu"; }
    if (state.time === saat) b.classList.add("selected");
    b.addEventListener("click", () => {
      if (b.disabled) return;
      state.time = saat; renderSlots(); refreshNext(); updateSummary();
    });
    el.appendChild(b);
  }
}

const summaryChip = (k, v) =>
  '<span class="summary-chip"><span class="k">' + k + "</span><b>" + v + "</b></span>";

function updateSummary() {
  const bar = $("#summaryBar");
  if (current < 2 || current > 4) { bar.classList.remove("show"); bar.innerHTML = ""; return; }
  let html = "";
  if (state.barber)  html += summaryChip("Berber", BERBERLER[state.barber].ad);
  if (state.service) html += summaryChip("Hizmet", HIZMETLER[state.service].ad + " · " + tl(HIZMETLER[state.service].fiyat));
  if (state.date)    html += summaryChip("Tarih", fmtDate(state.date));
  if (state.time)    html += summaryChip("Saat", state.time);
  bar.innerHTML = html;
  bar.classList.toggle("show", html !== "");
}

function recapHTML(iletisimDe) {
  const satirlar = [
    ["Berber", state.barber ? BERBERLER[state.barber].ad : "—", false],
    ["Hizmet", state.service ? HIZMETLER[state.service].ad : "—", false],
    ["Tarih",  state.date ? fmtDate(state.date) : "—", true],
    ["Saat",   state.time || "—", true],
    ["Ücret",  state.service ? tl(HIZMETLER[state.service].fiyat) : "—", true],
  ];
  if (iletisimDe) {
    satirlar.push(["Ad Soyad", (state.first + " " + state.last).trim() || "—", false]);
    satirlar.push(["Telefon", state.phone || "—", true]);
  }
  return "<h4>Randevu Özeti</h4>" + satirlar.map(
    (r) => '<div class="line' + (r[2] ? " sayisal" : "") + '"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>"
  ).join("");
}

/* ---------- adımlar ---------- */
const canGoTo = (s) => {
  if (s === 1) return true;
  if (s === 2) return !!state.barber;
  if (s === 3) return !!(state.barber && state.service);
  if (s === 4) return !!(state.barber && state.service && state.date && state.time);
  return false;
};

function updateStepper() {
  $$(".step-node", $("#stepper")).forEach((node) => {
    const s = +node.dataset.step;
    node.classList.toggle("done", current > s);
    node.classList.toggle("active", current === s);
    node.classList.toggle("clickable", s < current && canGoTo(s));
  });
}

function goTo(step) {
  current = step;
  $$(".step").forEach((p) => p.classList.toggle("active", +p.dataset.step === step));
  updateStepper(); updateSummary();
  if (step === 3) { renderDates(); renderSlots(); refreshNext(); }
  if (step === 4) $("#recap").innerHTML = recapHTML(false);
  if (step === 5) $("#confirmRecap").innerHTML = recapHTML(true);
  const anchor = $(".booking-head");
  window.scrollTo({ top: Math.max(0, anchor.getBoundingClientRect().top + window.scrollY - 88), behavior: "smooth" });
}

function refreshNext() {
  const btn = $("#toStep4");
  if (btn) btn.disabled = !(state.date && state.time);
}

/* ---------- seçimler ---------- */
function selectBarber(key, ilerle) {
  state.barber = key;
  musaitlik = null;
  $$(".choice-card").forEach((c) => c.classList.toggle("selected", c.dataset.barber === key));
  if (ilerle) goTo(2); else updateStepper();
}

$$(".choice-card").forEach((card) =>
  card.addEventListener("click", () => selectBarber(card.dataset.barber, true)));

$$(".service-card").forEach((card) =>
  card.addEventListener("click", async () => {
    state.service = card.dataset.service;
    $$(".service-card").forEach((c) => c.classList.toggle("selected", c === card));
    goTo(3);
    // Gün zaten seçiliyse süre değiştiği için uygunluk yeniden sorulmalı.
    // Seçili saat yeni süreye sığmıyorsa (saç → saç & sakal) seçim düşsün;
    // yoksa müşteri dolu bir saati seçili sanıp formu doldurur.
    if (state.date) {
      renderSlots(); await musaitlikYukle();
      if (state.time && !musaitlik?.get(state.time)?.musait) state.time = null;
      renderSlots(); refreshNext(); updateSummary();
    }
  }));

$$("[data-back]").forEach((b) => b.addEventListener("click", () => goTo(Math.max(1, current - 1))));
$("#toStep4").addEventListener("click", () => { if (canGoTo(4)) goTo(4); });
$$(".step-node", $("#stepper")).forEach((node) =>
  node.addEventListener("click", () => {
    const s = +node.dataset.step;
    if (s < current && canGoTo(s)) goTo(s);
  }));

/* ---------- form ---------- */
const form = $("#bookForm");
form.addEventListener("submit", (e) => e.preventDefault());

const alanlar = {
  first: { el: $("#fName"),  test: (v) => v.trim().length >= 2 },
  last:  { el: $("#fLast"),  test: (v) => v.trim().length >= 2 },
  phone: { el: $("#fPhone"), test: (v) => /^(?:90)?0?5\d{9}$/.test(v.replace(/\D/g, "")) },
};

function alanDogrula(ad, hatayiGoster) {
  const f = alanlar[ad];
  const ok = f.test(f.el.value);
  const kutu = f.el.closest(".field");
  if (hatayiGoster) kutu.classList.toggle("invalid", !ok);
  else if (ok) kutu.classList.remove("invalid");
  return ok;
}

Object.keys(alanlar).forEach((ad) => {
  alanlar[ad].el.addEventListener("blur",  () => alanDogrula(ad, true));
  alanlar[ad].el.addEventListener("input", () => alanDogrula(ad, false));
});

function hataYaz(mesaj) {
  const kutu = $("#formHata");
  kutu.textContent = mesaj || "";
  kutu.classList.toggle("show", !!mesaj);
}

/* Veritabanının fırlattığı adlar. Kullanıcı "exception" görmesin. */
const HATALAR = {
  SAAT_DOLU:        "Bu saat az önce doldu. Lütfen başka bir saat seç.",
  GECMIS_SAAT:      "Bu saat geçti. Lütfen ileri bir saat seç.",
  CALISMA_DISI:     "Berber o saatte çalışmıyor. Lütfen başka bir saat seç.",
  GECERSIZ_TELEFON: "Telefon numarası geçersiz. 05XX XXX XX XX şeklinde gir.",
  GECERSIZ_AD:      "Lütfen ad ve soyadını gir.",
  GECERSIZ_BERBER:  "Bu berber şu an randevu almıyor.",
  GECERSIZ_HIZMET:  "Hizmet seçimi geçersiz. Lütfen baştan seç.",
};

function waLinkiKur() {
  const b = BERBERLER[state.barber];
  const metin =
`Merhaba, ${MARKA_AD} için randevu talebim var.

Ad Soyad: ${state.first} ${state.last}
Berber: ${b.ad}
Hizmet: ${HIZMETLER[state.service].ad}
Tarih: ${tarihYaz(tarihAnahtari(state.date))}
Saat: ${state.time}`;
  return `https://wa.me/${b.tel}?text=${encodeURIComponent(metin)}`;
}

const gonderBtn = $("#submitBooking");

gonderBtn.addEventListener("click", async () => {
  hataYaz("");

  if (!AYARLI) {
    hataYaz("Randevu sistemi henüz bağlanmadı. js/db.js içindeki Supabase ayarları doldurulmalı.");
    return;
  }

  let ok = true, ilkHatali = null;
  Object.keys(alanlar).forEach((ad) => {
    const iyi = alanDogrula(ad, true);
    if (!iyi && !ilkHatali) ilkHatali = alanlar[ad].el;
    ok = ok && iyi;
  });
  if (!ok) { if (ilkHatali) ilkHatali.focus(); return; }

  const onay = $("#waOnay");
  if (onay && !onay.checked) {
    hataYaz("Devam etmek için WhatsApp ile iletişim onayını işaretle.");
    return;
  }

  state.first = alanlar.first.el.value.trim();
  state.last  = alanlar.last.el.value.trim();
  state.phone = alanlar.phone.el.value.trim();

  gonderBtn.disabled = true;
  const eskiMetin = gonderBtn.textContent;
  gonderBtn.textContent = "Kaydediliyor…";

  const db = await dbAl();
  if (!db) {
    gonderBtn.disabled = false; gonderBtn.textContent = eskiMetin;
    hataYaz("Randevu sunucusuna ulaşılamadı. Bağlantını kontrol edip tekrar dene.");
    return;
  }

  const { error } = await db.rpc("randevu_olustur", {
    p_berber:  state.barber,
    p_hizmet:  state.service,
    p_tarih:   tarihAnahtari(state.date),
    p_saat:    state.time,
    p_ad:      state.first + " " + state.last,
    p_telefon: state.phone,
  });

  gonderBtn.disabled = false;
  gonderBtn.textContent = eskiMetin;

  if (error) {
    const kod = Object.keys(HATALAR).find((k) => error.message.includes(k));
    hataYaz(kod ? HATALAR[kod] : "Randevu kaydedilemedi. Lütfen tekrar dene.");
    if (kod === "SAAT_DOLU" || kod === "GECMIS_SAAT" || kod === "CALISMA_DISI") {
      state.time = null;
      goTo(3); renderSlots(); refreshNext();
      await musaitlikYukle();
      renderSlots();
    }
    return;
  }

  const link = waLinkiKur();
  $("#waGonder").href = link;
  goTo(5);
  // Yeni sekme yerine aynı sekmede yönlendiriyoruz: mobilde WhatsApp
  // uygulaması açılıyor, sayfa arkada kalıyor.
  setTimeout(() => { window.location.href = link; }, 600);
});

$("#restart").addEventListener("click", () => {
  state.barber = state.service = state.date = state.time = null;
  state.first = state.last = state.phone = "";
  musaitlik = null;
  form.reset();
  hataYaz("");
  $$(".choice-card, .service-card").forEach((c) => c.classList.remove("selected"));
  $$(".field").forEach((f) => f.classList.remove("invalid"));
  goTo(1);
});

/* ---------- açılış: ?berber= ile ön seçim ---------- */
const on = new URLSearchParams(location.search).get("berber");
if (on && BERBERLER[on]) {
  selectBarber(on, false);
  goTo(2);
} else {
  updateStepper();
  updateSummary();
}

/* ---------- veritabanında olmayan hizmeti gösterme ----------
   Yeni bir hizmet önce sitede (db.js / randevu.html) sonra veritabanında
   açılabiliyor. Arada müşteri onu seçerse randevu GECERSIZ_HIZMET ile
   reddedilir — o yüzden veritabanının tanımadığı kart gizlenir. Sorgu
   başarısız olursa hepsi görünür kalır; sessizce boş bir liste bırakmıyoruz. */
(async () => {
  if (!AYARLI) return;
  const db = await dbAl();
  if (!db) return;
  const { data, error } = await db.from("hizmetler").select("id");
  if (error || !data?.length) return;
  const var_ = new Set(data.map((h) => h.id));
  $$(".service-card").forEach((c) => { c.hidden = !var_.has(c.dataset.service); });
})();
