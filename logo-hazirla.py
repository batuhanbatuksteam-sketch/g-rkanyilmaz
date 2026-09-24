#!/usr/bin/env python3
"""Kanatlı arma logosundan sitenin ve uygulamanın bütün görsellerini üretir.

Kaynak: medya-kaynak/logo-09-kanatli-arma.png (2048², siyah zemin, depoya girmez)
Kullanım: python3 logo-hazirla.py
"""
import pathlib
import subprocess

import numpy as np
from PIL import Image

KOK = pathlib.Path(__file__).parent
KAYNAK = KOK / "medya-kaynak" / "logo-09-kanatli-arma.png"
IMG = KOK / "assets" / "img"
ZEMIN = (8, 9, 11)  # --bg

# Logo siyah üstüne gümüş: parlaklık doğrudan saydamlık olarak kullanılıyor,
# böylece hangi koyu zemine konursa konsun kenarında siyah kutu kalmıyor.
ESIK = 10
ARMA_KUTU = (190, 270, 1858, 1778)       # tüm arma, kenarlarda az boşluk
BAYKUS_KUTU = (765, 455, 1255, 945)      # yalnız baykuş başı — küçük boyutlar için


def saydamlastir(im):
    rgb = np.asarray(im.convert("RGB"), dtype=np.float32)
    alfa = np.clip((rgb.max(axis=2) - ESIK) / (255 - ESIK), 0, 1)
    # siyah üstünde aynı görünmesi için rengi saydamlığa böl (ön-çarpımı geri al)
    renk = np.clip(rgb / np.maximum(alfa, 1e-3)[..., None], 0, 255)
    dizi = np.dstack([renk, alfa * 255]).round().astype(np.uint8)
    return Image.fromarray(dizi, "RGBA")


def kenar_erit(im):
    """Kesimde yarım kalan kanat/gövde uçlarını dairesel olarak söndürür."""
    g, y = im.size
    yy, xx = np.mgrid[0:y, 0:g]
    r = np.hypot((xx - g / 2) / g, (yy - y * 0.46) / y)
    maske = np.clip((0.5 - r) / (0.5 - 0.36), 0, 1)
    dizi = np.asarray(im).copy()
    dizi[..., 3] = (dizi[..., 3] * maske).round().astype(np.uint8)
    return Image.fromarray(dizi, "RGBA")


def webp(im, yol, genislik, kalite=86):
    oran = genislik / im.width
    kucuk = im.resize((genislik, round(im.height * oran)), Image.LANCZOS)
    gecici = yol.with_suffix(".png")
    kucuk.save(gecici)
    subprocess.run(["cwebp", "-quiet", "-q", str(kalite), "-alpha_q", "100",
                    str(gecici), "-o", str(yol)], check=True)
    gecici.unlink()


def zeminli(im, boyut, dolgu=0.0):
    tuval = Image.new("RGB", (boyut, boyut), ZEMIN)
    ic = round(boyut * (1 - 2 * dolgu))
    kucuk = im.resize((ic, ic), Image.LANCZOS)
    tuval.paste(kucuk, ((boyut - ic) // 2, (boyut - ic) // 2), kucuk)
    return tuval


def main():
    ham = Image.open(KAYNAK)
    arma = saydamlastir(ham.crop(ARMA_KUTU))
    baykus = kenar_erit(saydamlastir(ham.crop(BAYKUS_KUTU)))

    webp(arma, IMG / "logo-arma.webp", 720)
    webp(baykus, IMG / "logo-baykus.webp", 160)

    zeminli(baykus, 32).save(IMG / "favicon-32.png", optimize=True)
    zeminli(baykus, 180, 0.04).save(IMG / "apple-touch-icon.png", optimize=True)
    zeminli(baykus, 512, 0.04).save(IMG / "icon-512.png", optimize=True)

    # Paylaşım önizlemesi (WhatsApp, Instagram DM, iMessage)
    og = Image.new("RGB", (1200, 630), ZEMIN)
    yuk = 590
    kucuk = arma.resize((round(arma.width * yuk / arma.height), yuk), Image.LANCZOS)
    og.paste(kucuk, ((1200 - kucuk.width) // 2, 20), kucuk)
    og.save(IMG / "og-gorsel.jpg", quality=86, optimize=True)

    for ad in ["logo-arma.webp", "logo-baykus.webp", "favicon-32.png",
               "apple-touch-icon.png", "icon-512.png", "og-gorsel.jpg"]:
        print(f"  {ad:22} {(IMG / ad).stat().st_size // 1024:>4} KB")

    # Uygulama: capacitor-assets bu ikisinden bütün boyutları üretiyor.
    # Arma kaynakta ~1670 px; açılışta 1000 px'e küçülüyor, büyütülmüyor.
    uyg = KOK / "app" / "assets"
    uyg.mkdir(parents=True, exist_ok=True)
    zeminli(baykus, 1024, 0.06).save(uyg / "icon.png", optimize=True)
    acilis = Image.new("RGB", (2732, 2732), ZEMIN)
    kucuk = arma.resize((1000, round(arma.height * 1000 / arma.width)), Image.LANCZOS)
    acilis.paste(kucuk, ((2732 - kucuk.width) // 2, (2732 - kucuk.height) // 2), kucuk)
    acilis.save(uyg / "splash.png", optimize=True)
    print("  app/assets/icon.png, splash.png")


if __name__ == "__main__":
    main()
