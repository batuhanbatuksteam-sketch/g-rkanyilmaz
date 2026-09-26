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
   Amaç: saçı ve yüzü AYNEN bırakıp sadece fotoğrafı profesyonelleştirmek. */
const PROMPT = `Professional barbershop portfolio photo of this exact haircut.

PRESERVE EXACTLY — do not change:
- The person's identity: same face, facial features, eyes, nose, lips, ears, skin tone, age, expression, head shape, head angle and pose.
- The haircut: same length, fade/taper gradient and its height, line-up and edges, part line, texture, curl pattern, hair density, hair color and volume.
- The beard and moustache: same shape, length, line and density.
Do not restyle, extend, fill in, straighten, tidy or "improve" the hair or beard in any way. Do not add or remove hair.

IMPROVE ONLY THE PHOTOGRAPHY:
- Soft, even studio lighting with a subtle rim light that reveals the fade and texture detail.
- Correct white balance and exposure, crisp focus on the hair, reduced noise.
- Natural skin with real texture — no smoothing, no makeup, no beautification.
- Replace the background with a clean dark charcoal studio backdrop with gentle light falloff.
- Remove loose hair clippings on the skin and neck, and background clutter.

Photorealistic, shot on a full-frame camera with an 85mm lens. Same framing and crop as the original. No text, no logo, no watermark.`;

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
