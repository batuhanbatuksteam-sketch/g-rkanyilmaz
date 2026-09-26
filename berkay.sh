#!/bin/sh
# Berkay Özer'i siteye geri getirir.
#
#   ./berkay.sh geri     Berkay'ı geri koyar ve yayına iter
#   ./berkay.sh durum    şu an sitede mi, değil mi
#
# Nasıl çalışıyor: Berkay'la ilgili her şey (ana sayfa kartı, randevu
# seçimi, panel girişi, js/db.js ve js/berber.js kayıtları, fotoğrafı) tek
# bir commit'le kaldırıldı ve o commit "berkay-kaldirildi" diye etiketlendi.
# "geri" o commit'i tersine çeviriyor; yani kaldırılmadan önceki hâl, bu
# arada yapılan diğer değişikliklere dokunmadan geri geliyor.
#
# Fotoğrafın büyük kaynağı ve üretim betiği depo dışında, silinmedi:
#   ../berber-foto/berkay-studyo-4.png   (siteye giden son hâl)
#   ../berber-foto/berkay-uret.py
set -e
cd "$(dirname "$0")"

ETIKET=berkay-kaldirildi

sitede_mi() { grep -q 'data-barber="berkay"' randevu.html; }

case "$1" in
  geri)
    if sitede_mi; then echo "Berkay zaten sitede."; exit 0; fi
    git fetch --tags -q origin 2>/dev/null || true
    if ! git revert --no-edit "$ETIKET"; then
      git revert --abort 2>/dev/null || true
      echo "Otomatik geri alınamadı: kaldırılan satırların çevresi bu arada değişmiş."
      echo "Claude'a 'Berkay'ı geri getir' demen yeterli; $ETIKET etiketindeki farkı elle uygular."
      exit 1
    fi
    git push -q
    echo "Berkay geri geldi ve yayına gitti (Vercel ~1 dk)."
    echo "Uygulamada da görünsün diye: cd app && npm run senkron (ardından iOS/Android derlemesi)."
    echo "Veritabanında berberler.aktif kapatıldıysa SQL Editor'de:"
    echo "  update berberler set aktif = true where id = 'berkay';"
    ;;
  durum)
    if sitede_mi; then echo "Berkay sitede."; else echo "Berkay sitede değil (geri getirmek için: ./berkay.sh geri)."; fi
    ;;
  *)
    echo "kullanım: ./berkay.sh geri | durum"; exit 1 ;;
esac
