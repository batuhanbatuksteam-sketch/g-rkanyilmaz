/* Gürkan Yılmaz — The Barber — Foto Stüdyo sunucusu.
 *
 * Replicate anahtarı yalnızca burada durur; uygulamada hiçbir yerde yok.
 * Para veritabanında düşülür (foto_is_ac), Replicate ancak ondan sonra
 * çağrılır. Üretim başarısız olursa foto_is_bitir parayı geri yatırır.
 *
 * İstekler:
 *   { girdiler: ["gurkan/girdi/…jpg", …] }   yeni fotoğraflar (en fazla 5)
 *   { tekrar: "<is id>" }                    ücretsiz tekrar deneme
 *   { yokla: ["<is id>", …] }                webhook gecikirse durumu Replicate'ten sor
 *   ?kanca=<KANCA_ANAHTAR>&is=<id>           Replicate'in bitiş bildirimi
 *
 * Gereken secret'lar:
 *   REPLICATE_API_TOKEN   Replicate anahtarı (sadece bu işe açılan hesap)
 *   KANCA_ANAHTAR         webhook adresindeki rastgele parola
 *
 * Kurulum: supabase functions deploy foto-studyo --no-verify-jwt
 * (JWT'yi burada kendimiz doğruluyoruz; Replicate'in webhook'u JWT taşımaz.)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const REPLICATE = Deno.env.get("REPLICATE_API_TOKEN")!;
const KANCA = Deno.env.get("KANCA_ANAHTAR")!;
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const KOVA = "foto-studyo";
const MODEL = "google/nano-banana-pro";

/* Uygulama güncellemeden değiştirilebilsin diye prompt burada.
   Amaç: fotoğrafın aslı korunur — kafa açısı, poz, kadraj, yüz ve saç AYNEN
   kalır; arka plan değiştirilmez, sadece ölçülü koyulaşır. Sonuç elle
   çekilmiş ama stüdyo kalitesinde, insan işi gibi durmalı.
   Denemede öğrenilenler:
   - Prompt'ta "fade/taper" geçince model olmayan fade'i kendisi çiziyor;
     saç sadece "olduğu gibi" diye tarif ediliyor, fade yasaklanıyor.
   - "Dükkân arka planını koru" deyince dükkânda çekilmemiş fotoğrafa ayna,
     raf, lavabo uyduruyor; arka plan "aynı duvarlar, aynı nesneler" diye
     tarif ediliyor, nesne eklemek yasak.
   - İşi Lightroom rötuşu diye tarif etmek, modelin kareyi baştan çizmesini
     (kafa açısının kaymasını) azaltıyor. */
const PROMPT = `Retouch this photo the way a professional photo editor would in Lightroom and Photoshop: only exposure, white balance, color grading, soft dodge and burn, and a darkening mask on the background. Do not regenerate, repaint or redraw anything. The result must be the same photograph.

KEEP IDENTICAL TO THE ORIGINAL:
- Head angle, tilt and rotation, gaze, pose, body position, camera angle, perspective, framing and crop.
- Face and identity: same features, skin tone, age and expression.
- The haircut exactly as it is: same length on top, same length and darkness on the sides and temples, same hairline, edges, part, texture, volume and color. Do not add or sharpen a fade, taper, skin fade or line-up that is not already there. Do not add shine, gloss or highlights to the hair. Do not restyle or tidy it.
- Beard and moustache: same shape, length, edges and density.
- Clothing as it is.

BACKGROUND:
Keep the original background — the same walls and the same objects in the same places. Do not add any object, furniture, mirror or decoration, and do not replace it. Darken it by about one and a half stops into deep charcoal tones with a slight natural blur, so it is clearly darker than the person and the person stands out. Not black — the same walls and objects must still be visible, like the same real place in low light.

LIGHT:
Soft, natural light on the person, as a skilled photographer would get with a large softbox from the front — the person a little brighter than the background, flattering but not dramatic. No hard side light, no heavy contrast. Correct white balance.

LOOK:
A real photo shot by hand by a skilled photographer on a full-frame camera — studio quality, but natural and human. Real skin texture and pores, no airbrushing, no over-sharpening, no HDR, no halos or glow, nothing that looks AI-generated. Restrained edit. You may remove loose hair clippings lying on the skin or cape. No text, no logo, no watermark.`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const yanit = (govde: unknown, durum = 200) =>
  new Response(JSON.stringify(govde), {
    status: durum,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Servis rolü: foto_is_ac / foto_is_bitir yalnız ona açık.
const yonetici = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/* ---------------------------------------------------------------- Replicate */
async function replicate(yol: string, govde?: unknown) {
  const cevap = await fetch("https://api.replicate.com/v1/" + yol, {
    method: govde ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${REPLICATE}`,
      "Content-Type": "application/json",
    },
    body: govde ? JSON.stringify(govde) : undefined,
  });
  const veri = await cevap.json().catch(() => ({}));
  if (!cevap.ok) throw new Error(`replicate ${cevap.status}: ${veri.detail ?? JSON.stringify(veri)}`);
  return veri;
}

/** Açılmış bir işi Replicate'e gönderir. Gönderemezse parayı iade eder. */
async function uretimBaslat(isId: string, girdi: string) {
  try {
    const { data: imzali, error } = await yonetici.storage
      .from(KOVA).createSignedUrl(girdi, 60 * 60);
    if (error) throw error;

    const tahmin = await replicate(`models/${MODEL}/predictions`, {
      input: {
        prompt: PROMPT,
        image_input: [imzali.signedUrl],
        resolution: "2K",
        aspect_ratio: "match_input_image",
        output_format: "jpg",
        // Yedek model yüzü değiştirebiliyor; kapasite doluysa hata alıp iade daha iyi.
        allow_fallback_model: false,
      },
      webhook: `${SUPA_URL}/functions/v1/foto-studyo?kanca=${KANCA}&is=${isId}`,
      webhook_events_filter: ["completed"],
    });

    await yonetici.from("foto_is").update({ tahmin_id: tahmin.id }).eq("id", isId);
  } catch (e) {
    console.error("başlatılamadı", isId, e);
    await yonetici.rpc("foto_is_bitir", {
      p_id: isId, p_cikti: null, p_hata: "BASLATILAMADI: " + String(e).slice(0, 300),
    });
  }
}

/** Replicate'in bitmiş tahminini işler: çıktıyı kendi depomuza alır. */
async function sonucuIsle(is: { id: string; berber_id: string }, tahmin: any) {
  if (tahmin.status === "succeeded") {
    const adres = Array.isArray(tahmin.output) ? tahmin.output[0] : tahmin.output;
    try {
      // Replicate çıktıları bir saat sonra siliniyor; hemen kopyalıyoruz.
      const resim = await fetch(adres);
      if (!resim.ok) throw new Error("çıktı indirilemedi: " + resim.status);
      const yol = `${is.berber_id}/cikti/${is.id}.jpg`;
      const { error } = await yonetici.storage.from(KOVA).upload(
        yol, await resim.arrayBuffer(), { contentType: "image/jpeg", upsert: true },
      );
      if (error) throw error;
      await yonetici.rpc("foto_is_bitir", { p_id: is.id, p_cikti: yol, p_hata: null });
    } catch (e) {
      await yonetici.rpc("foto_is_bitir", {
        p_id: is.id, p_cikti: null, p_hata: "KAYDEDILEMEDI: " + String(e).slice(0, 300),
      });
    }
  } else if (tahmin.status === "failed" || tahmin.status === "canceled") {
    await yonetici.rpc("foto_is_bitir", {
      p_id: is.id, p_cikti: null, p_hata: String(tahmin.error ?? tahmin.status).slice(0, 300),
    });
  }
  // starting / processing: henüz bitmedi, dokunma.
}

/* ---------------------------------------------------------------- istekler */
Deno.serve(async (istek) => {
  if (istek.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(istek.url);

  /* ---- Replicate webhook ---- */
  if (url.searchParams.has("kanca")) {
    if (url.searchParams.get("kanca") !== KANCA) return yanit({ hata: "yetkisiz" }, 401);
    const tahmin = await istek.json();
    const { data: is } = await yonetici.from("foto_is")
      .select("id, berber_id, tahmin_id, durum")
      .eq("id", url.searchParams.get("is")).maybeSingle();
    if (is && is.durum === "isleniyor" && (!is.tahmin_id || is.tahmin_id === tahmin.id)) {
      await sonucuIsle(is, tahmin);
    }
    return yanit({ ok: true });
  }

  /* ---- Uygulamadan gelen istek: berberi doğrula ---- */
  const jwt = (istek.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: kullanici } = await yonetici.auth.getUser(jwt);
  if (!kullanici?.user) return yanit({ hata: "OTURUM_YOK" }, 401);

  const { data: hesap } = await yonetici.from("berber_hesap")
    .select("berber_id").eq("user_id", kullanici.user.id).maybeSingle();
  if (!hesap) return yanit({ hata: "BERBER_YOK" }, 403);
  const berber = hesap.berber_id as string;

  const govde = await istek.json().catch(() => ({}));

  /* ---- Yeni fotoğraflar ---- */
  if (Array.isArray(govde.girdiler)) {
    const desen = new RegExp(`^${berber}/girdi/[\\w-]+\\.(jpe?g|png)$`);
    const girdiler: string[] = govde.girdiler.filter((g: unknown) =>
      typeof g === "string" && desen.test(g)).slice(0, 5);
    if (!girdiler.length) return yanit({ hata: "GIRDI_YOK" }, 400);

    // Sırayla açılıyor: bakiye 2 fotoğrafa yetiyorsa ilk ikisi açılır, üçüncüsü
    // BAKIYE_YETERSIZ ile durur. Açılanlar paralel olarak Replicate'e gider.
    const acilan: { id: string; girdi: string }[] = [];
    let hata: string | null = null;
    for (const girdi of girdiler) {
      const { data: id, error } = await yonetici.rpc("foto_is_ac", { p_berber: berber, p_girdi: girdi });
      if (error) { hata = kodAl(error.message); break; }
      acilan.push({ id, girdi });
    }
    await Promise.all(acilan.map((a) => uretimBaslat(a.id, a.girdi)));
    return yanit({ isler: acilan.map((a) => a.id), hata });
  }

  /* ---- Ücretsiz tekrar ---- */
  if (typeof govde.tekrar === "string") {
    const { data: asil } = await yonetici.from("foto_is")
      .select("girdi").eq("id", govde.tekrar).eq("berber_id", berber).maybeSingle();
    if (!asil) return yanit({ hata: "TEKRAR_YOK" }, 404);
    const { data: id, error } = await yonetici.rpc("foto_is_ac", {
      p_berber: berber, p_girdi: asil.girdi, p_kaynak: govde.tekrar,
    });
    if (error) return yanit({ hata: kodAl(error.message) }, 409);
    await uretimBaslat(id, asil.girdi);
    return yanit({ isler: [id] });
  }

  /* ---- Yoklama: webhook gelmediyse ---- */
  if (Array.isArray(govde.yokla)) {
    const { data: isler } = await yonetici.from("foto_is")
      .select("id, berber_id, tahmin_id, olusturuldu")
      .eq("berber_id", berber).eq("durum", "isleniyor")
      .in("id", govde.yokla.slice(0, 10));
    await Promise.all((isler ?? []).map(async (is) => {
      if (is.tahmin_id) {
        try { await sonucuIsle(is, await replicate("predictions/" + is.tahmin_id)); }
        catch (e) { console.error("yoklanamadı", is.id, e); }
      } else if (Date.now() - new Date(is.olusturuldu).getTime() > 5 * 60_000) {
        // Başlatma yarıda kalmış: parayı iade et.
        await yonetici.rpc("foto_is_bitir", { p_id: is.id, p_cikti: null, p_hata: "ZAMAN_ASIMI" });
      }
    }));
    return yanit({ ok: true });
  }

  return yanit({ hata: "BILINMEYEN_ISTEK" }, 400);
});

/** Postgres hata mesajından bizim kodu çıkarır: "BAKIYE_YETERSIZ" gibi. */
function kodAl(mesaj: string) {
  return mesaj.match(/[A-Z_]{5,}/)?.[0] ?? "BILINMEYEN";
}
