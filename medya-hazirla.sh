#!/usr/bin/env bash
# Hero videosunu ve Gürkan'ın portresini web için hazırlar.
#
# Video: 4K/5,4 sn HEVC bir klip. Ham hâliyle 12 MB ve döngüde her turda
# görünür bir kesme yapıyor. Burada üç şey oluyor:
#   1. %75 hıza yavaşlatma  — arka planda daha sakin duruyor.
#   2. Kusursuz döngü       — sonun son 1 sn'si başın ilk 1 sn'sinin üstüne
#                             eritiliyor, böylece başa dönerken kesme yok.
#   3. Renk kaldırma        — siyah/gümüş temaya girsin diye doygunluk 0,18'e
#                             iniyor. Tarayıcıda CSS filter ile yapmak yerine
#                             dosyaya işleniyor: mobil GPU'yu yormuyor.
set -euo pipefail
cd "$(dirname "$0")"

KAYNAK="medya-kaynak/IMG_4649.mov"
CIKTI="assets/video"
mkdir -p "$CIKTI" assets/img

# Yavaşlatılmış toplam süre ve eritme uzunluğu
YAVAS=1.35        # 5,3667 sn * 1,35 = 7,245 sn
D=7.24            # güvenli tarafta kalmak için virgülden sonrası kırpıldı
F=1.0             # eritme uzunluğu
GOVDE_SON=$(echo "$D - $F" | bc)   # 6.24

GRADE="hue=s=0.18,eq=contrast=1.06:brightness=-0.06"

# --- Kusursuz döngü zinciri (bir kez, 1920 genişlikte ana kopya) ---
donguzinciri() {   # $1 = genişlik, $2 = yükseklik
  echo "[0:v]setpts=${YAVAS}*PTS,scale=$1:$2:flags=lanczos,fps=30,${GRADE},format=yuv420p,split=3[a][b][c];\
[a]trim=0:${F},setpts=PTS-STARTPTS[bas];\
[b]trim=${F}:${GOVDE_SON},setpts=PTS-STARTPTS[govde];\
[c]trim=${GOVDE_SON}:${D},setpts=PTS-STARTPTS[son];\
[son][bas]blend=all_expr='A*(1-T/${F})+B*(T/${F})'[erit];\
[govde][erit]concat=n=2:v=1:a=0[cikti]"
}

echo "→ hero-1920.mp4"
ffmpeg -v error -y -i "$KAYNAK" -filter_complex "$(donguzinciri 1920 1080)" \
  -map "[cikti]" -an -c:v libx264 -profile:v high -crf 25 -preset slow \
  -pix_fmt yuv420p -movflags +faststart "$CIKTI/hero-1920.mp4"

echo "→ hero-1280.mp4"
ffmpeg -v error -y -i "$KAYNAK" -filter_complex "$(donguzinciri 1280 720)" \
  -map "[cikti]" -an -c:v libx264 -profile:v high -crf 27 -preset slow \
  -pix_fmt yuv420p -movflags +faststart "$CIKTI/hero-1280.mp4"

# Not: VP9/webm bu klipte H.264'ten BÜYÜK çıkıyor ve tarayıcı ilk
# desteklediği kaynağı seçtiği için hiç kullanılmıyordu — üretilmiyor.

# Poster: video yüklenene kadar görünen ilk kare. Aynı grade uygulanıyor
# ki video başlarken renk sıçraması olmasın.
echo "→ hero-poster.jpg"
ffmpeg -v error -y -ss 2.4 -i "$KAYNAK" -frames:v 1 \
  -vf "scale=1920:1080:flags=lanczos,${GRADE}" -q:v 6 "assets/img/hero-poster.jpg"

# --- Gürkan portresi ---
# Sol üstteki "Ai" filigranı ilk %5'lik şeritte; oradan kesiliyor.
echo "→ gurkan-portre.jpg"
ffmpeg -v error -y -i medya-kaynak/gurkan-9x16.png \
  -vf "crop=1440:2430:0:130,scale=1080:-2:flags=lanczos" -q:v 4 \
  assets/img/gurkan-portre.jpg

# webp yalnız kodlayıcı varsa; Homebrew ffmpeg'inde çoğu zaman kapalı.
if sips -s format webp assets/img/gurkan-portre.jpg \
        --out assets/img/gurkan-portre.webp >/dev/null 2>&1; then
  echo "→ gurkan-portre.webp"
else
  echo "  (webp kodlayıcı yok — atlandı, jpg yeterli)"
fi

# Atmosfer şeridi için videodan geniş bir kare
echo "→ atmosfer.jpg"
ffmpeg -v error -y -ss 4.8 -i "$KAYNAK" -frames:v 1 \
  -vf "scale=1920:1080:flags=lanczos,hue=s=0.10,eq=contrast=1.1:brightness=-0.10" \
  -q:v 6 "assets/img/atmosfer.jpg"

echo
echo "Bitti:"
ls -la "$CIKTI" assets/img
