/* GÜRKAN YILMAZ — THE BARBER
   Arayüz hareketleri. Bağımlılık yok, tek geçişli bir rAF döngüsü var. */
(function () {
  "use strict";
  window.__gyReady = true;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---- Hero: jilet geçişi ---- */
  var hero = $("#hero");
  if (hero) requestAnimationFrame(function () { requestAnimationFrame(function () { hero.classList.add("play"); }); });

  /* ---- Hero videosu ----
     iOS düşük güç modunda ve bazı tarayıcılarda autoplay reddedilir.
     Reddedilirse poster görünür kalır (hero yine okunur); ilk dokunuşta
     bir kez daha deniyoruz. Sessiz kalmasın diye hata yutulmuyor, sadece
     tekrar denenmesi için işaretleniyor. */
  var video = $("#heroVideo");
  if (video) {
    var dene = function () {
      var s = video.play();
      if (s && s.catch) s.catch(function () { /* poster kalır */ });
    };
    dene();
    var birKez = function () {
      dene();
      document.removeEventListener("touchstart", birKez);
      document.removeEventListener("click", birKez);
    };
    document.addEventListener("touchstart", birKez, { passive: true, once: true });
    document.addEventListener("click", birKez, { once: true });

    // Arka plandayken kare çözmeye gerek yok — pil ve CPU boşa gitmesin.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) video.pause(); else dene();
    });
  }

  /* ---- Üst çubuk ---- */
  var nav = $("#nav");
  var navGuncelle = function () { if (nav) nav.classList.toggle("scrolled", window.scrollY > 40); };
  navGuncelle();

  /* ---- Mobil menü ---- */
  var toggle = $("#navToggle"), menu = $("#mobileMenu");
  if (toggle && menu) {
    var kapat = function () {
      toggle.classList.remove("open"); menu.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("no-scroll");
    };
    toggle.addEventListener("click", function () {
      var acik = menu.classList.toggle("open");
      toggle.classList.toggle("open", acik);
      toggle.setAttribute("aria-expanded", String(acik));
      document.body.classList.toggle("no-scroll", acik);
    });
    $$("a", menu).forEach(function (a) { a.addEventListener("click", kapat); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") kapat(); });
  }

  /* ---- Kaydırınca beliren öğeler ----
     IntersectionObserver yerine rAF: hızlı savurmalarda (fling) gözlemci
     kareyi atlayabiliyor ve öğe görünmez kalıyor. */
  var bekleyen = $$(".reveal, .reveal-clip");
  if (reduce) { bekleyen.forEach(function (el) { el.classList.add("is-visible"); }); bekleyen = []; }
  function revealKontrol() {
    if (!bekleyen.length) return;
    var esik = window.innerHeight * 0.9;
    bekleyen = bekleyen.filter(function (el) {
      if (el.getBoundingClientRect().top < esik) { el.classList.add("is-visible"); return false; }
      return true;
    });
  }

  /* ---- Paralaks ---- */
  var figurler = $$("[data-parallax]").map(function (img) {
    return { img: img, kutu: img.parentElement, oran: parseFloat(img.dataset.parallax) || 0.12 };
  });

  /* ---- Dokunmatikte odak ----
     Masaüstünde :hover yapıyor; dokunmatikte hover hiç tetiklenmediği için
     kart ekranın ortasına yaklaşınca aynı sınıfı elle veriyoruz. */
  var dokunmatik = window.matchMedia("(hover: none)").matches;
  var kartlar = (dokunmatik && !reduce) ? $$(".master") : [];
  function odakGuncelle(vh) {
    for (var i = 0; i < kartlar.length; i++) {
      var el = kartlar[i], r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) { el.classList.remove("odakta"); continue; }
      el.classList.toggle("odakta", Math.abs(r.top + r.height / 2 - vh / 2) < vh * 0.34);
    }
  }

  var bekliyor = false;
  function kare() {
    var vh = window.innerHeight;
    revealKontrol();
    odakGuncelle(vh);
    for (var i = 0; i < figurler.length; i++) {
      var f = figurler[i], r = f.kutu.getBoundingClientRect();
      if (r.bottom < -50 || r.top > vh + 50) continue;
      var ilerleme = (r.top + r.height / 2 - vh / 2) / vh;      // ~ -1..1
      var kayma = -ilerleme * f.kutu.offsetHeight * f.oran;
      f.img.style.transform = "translateY(-50%) translate3d(0," + kayma.toFixed(1) + "px,0)";
    }
    bekliyor = false;
  }
  function kareIste() { if (!bekliyor) { bekliyor = true; requestAnimationFrame(kare); } }

  window.addEventListener("scroll", function () { navGuncelle(); if (!reduce) kareIste(); }, { passive: true });
  window.addEventListener("resize", function () { if (!reduce) kareIste(); }, { passive: true });
  window.addEventListener("load", function () { if (!reduce) kare(); });
  if (!reduce) kare();

  /* ---- Çapa bağlantılarında üst çubuk payı ---- */
  $$('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href");
      if (id.length < 2) return;
      var hedef = document.querySelector(id);
      if (!hedef) return;
      e.preventDefault();
      window.scrollTo({
        top: hedef.getBoundingClientRect().top + window.scrollY - 72,
        behavior: reduce ? "auto" : "smooth",
      });
    });
  });
})();
