/* GÜRKAN YILMAZ — THE BARBER · Galeri
   Kareler index.html'de düz <button> olarak duruyor (betik yüklenmese de
   görünür). Bu dosya yalnızca tam ekran görüntüleyiciyi ve "Tümünü Gör"ü
   ekliyor. Bağımlılık yok. */
(function () {
  "use strict";
  var bolum = document.getElementById("galeri");
  if (!bolum) return;

  var kareler = Array.prototype.slice.call(bolum.querySelectorAll(".gal-item"));
  var bak = document.getElementById("galBak");
  var resim = document.getElementById("galResim");
  var sayac = document.getElementById("galSayac");
  var sira = 0, sonOdak = null;
  var iki = function (n) { return (n < 10 ? "0" : "") + n; };

  /* ---- Tümünü Gör ---- */
  var tumu = document.getElementById("galTumu");
  if (tumu) tumu.addEventListener("click", function () {
    bolum.classList.add("acik");
    var ilk = bolum.querySelector(".gal-fazla");
    if (ilk) ilk.focus({ preventScroll: true });
  });

  /* ---- Görüntüleyici ---- */
  function goster(n, yon) {
    sira = (n + kareler.length) % kareler.length;
    var k = kareler[sira];
    resim.classList.add("gecis");
    var yeni = new Image();
    yeni.onload = yeni.onerror = function () {
      resim.src = yeni.src;
      resim.alt = k.querySelector("img").alt;
      requestAnimationFrame(function () { resim.classList.remove("gecis"); });
    };
    yeni.src = k.dataset.buyuk;
    sayac.innerHTML = "<b>" + iki(sira + 1) + "</b> / " + iki(kareler.length);
    // Komşular önceden insin: geçiş beklemeden olsun
    [sira + 1, sira - 1].forEach(function (i) {
      var kom = kareler[(i + kareler.length) % kareler.length];
      (new Image()).src = kom.dataset.buyuk;
    });
  }

  function ac(n) {
    sonOdak = document.activeElement;
    goster(n);
    bak.classList.add("acik");
    bak.setAttribute("aria-hidden", "false");
    document.body.classList.add("no-scroll");
    bak.querySelector(".gal-kapat").focus({ preventScroll: true });
  }

  function kapat() {
    bak.classList.remove("acik");
    bak.setAttribute("aria-hidden", "true");
    document.body.classList.remove("no-scroll");
    if (sonOdak) sonOdak.focus({ preventScroll: true });
  }

  kareler.forEach(function (k, i) { k.addEventListener("click", function () { ac(i); }); });
  bak.querySelector(".gal-kapat").addEventListener("click", kapat);
  bak.querySelector(".gal-ok.onceki").addEventListener("click", function () { goster(sira - 1); });
  bak.querySelector(".gal-ok.sonraki").addEventListener("click", function () { goster(sira + 1); });
  // Resmin dışındaki boşluğa dokununca kapansın
  bak.querySelector(".gal-sahne").addEventListener("click", function (e) { if (e.target === this) kapat(); });

  document.addEventListener("keydown", function (e) {
    if (!bak.classList.contains("acik")) return;
    if (e.key === "Escape") kapat();
    else if (e.key === "ArrowRight") goster(sira + 1);
    else if (e.key === "ArrowLeft") goster(sira - 1);
    else if (e.key === "Tab") { e.preventDefault(); bak.querySelector(".gal-kapat").focus(); }
  });

  /* ---- Parmakla kaydırma ---- */
  var x0 = null, y0 = null;
  var sahne = bak.querySelector(".gal-sahne");
  sahne.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  sahne.addEventListener("touchend", function (e) {
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) goster(sira + (dx < 0 ? 1 : -1));
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) kapat();   // aşağı çekince kapanır
  }, { passive: true });
})();
