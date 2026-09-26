/* Gürkan Yılmaz — The Barber — Foto Stüdyo sunucusu.
 *
 * Replicate anahtarı yalnızca burada durur; uygulamada hiçbir yerde yok.
 * Para veritabanında düşülür (foto_is_ac), Replicate ancak ondan sonra
 * çağrılır. Üretim başarısız olursa foto_is_bitir parayı geri yatırır.
 *
 * İstekler:
 *   { girdiler: ["gurkan/girdi/…jpg", …], stil }   yeni fotoğraflar (en fazla 5)
 *   { tekrar: "<is id>", stil }              ücretsiz tekrar deneme
 *     stil: "studyo" (siyaha yakın fon) | "dogal" (mekân korunur) — PROMPTLAR'a bak
 *   { yokla: ["<is id>", …] }                webhook gecikirse durumu Replicate'ten sor
 *   ?kanca=<KANCA_ANAHTAR>&is=<id>           Replicate'in bitiş bildirimi
 *   x-yonetici: <YONETICI_ANAHTAR>           kredi paneli (sadece yöneticinin Mac'i)
 *     { islem: "durum" }                     bakiye, hareketler, maliyet özeti
 *     { islem: "yukle", berber, tutar, aciklama }   bakiye yükle (eksi = düzeltme)
 *
 * Gereken secret'lar:
 *   REPLICATE_API_TOKEN   Replicate anahtarı (sadece bu işe açılan hesap)
 *   KANCA_ANAHTAR         webhook adresindeki rastgele parola
 *   YONETICI_ANAHTAR      kredi panelinin parolası (kredi-paneli/ayar.js'te)
 *
 * Kurulum: supabase functions deploy foto-studyo --no-verify-jwt
 * (JWT'yi burada kendimiz doğruluyoruz; Replicate'in webhook'u JWT taşımaz.)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const REPLICATE = Deno.env.get("REPLICATE_API_TOKEN")!;
const KANCA = Deno.env.get("KANCA_ANAHTAR")!;
const YONETICI = Deno.env.get("YONETICI_ANAHTAR") ?? "";
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const KOVA = "foto-studyo";
const MODEL = "google/nano-banana-pro";
const FOTO_USD = 0.15;   // Replicate'in 2K fiyatı; panel maliyeti bununla tahmin eder

/* Uygulama güncellemeden değiştirilebilsin diye prompt burada.
   İstenen: stüdyo işi. Işık kalitesi bütün fotoğrafta (müşteri dahil) artar,
   arka plan siyaha yakın koyulaşır. Yüz, kafa açısı ve saç ASLA değişmez.
   Denemede öğrenilenler:
   - Prompt'ta saç için "fade/taper" diye tarif yapınca model olmayan fade'i
     çiziyor; saç "olduğu gibi" diye tarif ediliyor, fade eklemek yasak.
   - Arka planı "dükkân" diye tarif edince ayna, raf, lavabo uyduruyor;
     nesne eklemek yasak, arka plan sadece koyulaşıyor.
   - İşi rötuş diye tarif etmek, kareyi baştan çizmesini (kafa açısının
     kaymasını) azaltıyor. */
const PROMPT_STUDYO = `Retouch and relight this photo like a high-end studio photo editor working in Photoshop. The result must be the same photograph with studio-quality light — do not regenerate, repaint or redraw the person.

KEEP IDENTICAL TO THE ORIGINAL:
- The face: do not touch or change it — same features, face shape, skin tone, age and expression.
- Head angle, tilt and rotation, gaze, pose, body position, camera angle, perspective, framing and crop.
- The haircut exactly as it is: same length on top, same length and darkness on the sides and temples, same hairline, edges, part, texture, volume and color. Do not add or sharpen a fade, taper, skin fade or line-up that is not already there. Do not add shine or gloss to the hair.
- Beard and moustache: same shape, length, edges and density.
- Clothing and barber cape as they are.

LIGHT — STUDIO QUALITY ACROSS THE WHOLE PHOTO, THE PERSON INCLUDED:
Professional studio lighting as in a high-end barbershop portfolio shoot: a large soft key light that cleanly lights the face, hair and shoulders, gentle fill so there are no muddy shadows, and a subtle rim light that outlines the head and shoulders against the dark background. Crisp, clean, well exposed, rich colors, correct white balance, clear detail in the hair texture.

BACKGROUND:
Darken the background almost to black — deep charcoal-black studio tones with only a faint hint of the original surroundings. Do not add any object, furniture, mirror or decoration. Smooth natural falloff, no hard cut-out edges around the person or the hair.

FINISH:
High-end studio portrait, as if shot on a full-frame camera with an 85mm lens. Real skin texture — no airbrushing, no plastic skin, no over-sharpening, no HDR, no halos around the hair. You may remove loose hair clippings lying on the skin or cape. No text, no logo, no watermark.`;

/* "Daha Doğal": arka plan aynı mekân — nesnelere dokunulmaz, sadece ışığı
   değişir. Ortam loşlaşır, yüze stüdyo ışığı vurur, kişinin arkasını hafif
   bir arka ışık aydınlatır, portre objektifi gibi alan derinliği oluşur. */
const PROMPT_DOGAL = `Retouch and relight this photo like a high-end photo editor working in Photoshop. The result must be the same photograph — do not regenerate, repaint or redraw anything.

KEEP IDENTICAL TO THE ORIGINAL:
- The face: do not touch or change it — same features, face shape, skin tone, age and expression.
- Head angle, tilt and rotation, gaze, pose, body position, camera angle, perspective, framing and crop.
- The haircut exactly as it is: same length on top, same length and darkness on the sides and temples, same hairline, edges, part, texture, volume and color. Do not add or sharpen a fade, taper, skin fade or line-up that is not already there. Do not add shine or gloss to the hair.
- Beard and moustache: same shape, length, edges and density.
- Clothing and barber cape as they are.

BACKGROUND — THE SAME REAL PLACE:
Keep the original background exactly: the same place, the same walls and the same objects in the same positions. Do not add, remove, move or replace anything in it. Only change its light: darken it strongly, about two stops, as if the room lights were switched off and only the photographer's lights are on — dark and moody, but every object stays visible and recognizable. Add a soft background light behind the person that gently brightens the area right behind the head and shoulders and falls off into darkness toward the edges. Give it a shallow depth of field, like a fast portrait lens at f/1.8 — the background softly out of focus, the person tack sharp.

LIGHT ON THE PERSON:
A soft studio key light that clearly lights the face and hair, so the person stands out bright against the darker room, with gentle fill and a subtle rim light that separates the head and shoulders from the background. Clean exposure, correct white balance, clear hair texture.

FINISH:
Natural and real — like a photographer brought studio lights into the shop. Real skin texture, no airbrushing, no plastic skin, no over-sharpening, no HDR, no halos around the hair, no cut-out look. You may remove loose hair clippings lying on the skin or cape.

OVERLAYS: if any text, caption, sticker, emoji, logo, watermark, username or other graphic has been added on top of the photo (for example by a social media app), remove it completely and fill that area naturally with what would be behind it. Text that physically exists in the scene, such as a shop sign or print on clothing, stays. Do not add any new text, logo or watermark.`;

/* Uygulamadaki seçim: "studyo" (siyaha yakın fon) ya da "dogal" (mekân korunur). */
const PROMPTLAR: Record<string, string> = { studyo: PROMPT_STUDYO, dogal: PROMPT_DOGAL };
const stilAl = (s: unknown) =>
  (typeof s === "string" && Object.hasOwn(PROMPTLAR, s) ? s : "studyo");
/** Yoklamada stil bilinmiyor; Replicate'e giden prompt'tan bulunur. */
const stilBul = (prompt: unknown) =>
  Object.keys(PROMPTLAR).find((k) => PROMPTLAR[k] === prompt) ?? "studyo";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-yonetici",
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
async function uretimBaslat(isId: string, girdi: string, stil: string) {
  try {
    const { data: imzali, error } = await yonetici.storage
      .from(KOVA).createSignedUrl(girdi, 60 * 60);
    if (error) throw error;

    const tahmin = await replicate(`models/${MODEL}/predictions`, {
      input: {
        prompt: PROMPTLAR[stil],
        image_input: [imzali.signedUrl],
        resolution: "2K",
        aspect_ratio: "match_input_image",
        output_format: "jpg",
        // Yedek model yüzü değiştirebiliyor; kapasite doluysa hata alıp iade daha iyi.
        allow_fallback_model: false,
      },
      webhook: `${SUPA_URL}/functions/v1/foto-studyo?kanca=${KANCA}&is=${isId}&stil=${stil}`,
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

/** Replicate'in bitmiş tahminini işler: çıktıyı kendi depomuza alır.
 *  Stil dosya adına yazılır (…-dogal.jpg); uygulama etiketi oradan okur. */
async function sonucuIsle(is: { id: string; berber_id: string }, tahmin: any, stil: string) {
  if (tahmin.status === "succeeded") {
    const adres = Array.isArray(tahmin.output) ? tahmin.output[0] : tahmin.output;
    try {
      // Replicate çıktıları bir saat sonra siliniyor; hemen kopyalıyoruz.
      const resim = await fetch(adres);
      if (!resim.ok) throw new Error("çıktı indirilemedi: " + resim.status);
      const yol = `${is.berber_id}/cikti/${is.id}-${stil}.jpg`;
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
      await sonucuIsle(is, tahmin, stilAl(url.searchParams.get("stil")));
    }
    return yanit({ ok: true });
  }

  /* ---- Kredi paneli (yöneticinin Mac'i) ---- */
  const yoneticiAnahtari = istek.headers.get("x-yonetici");
  if (yoneticiAnahtari !== null) {
    if (YONETICI.length < 32 || yoneticiAnahtari !== YONETICI) return yanit({ hata: "YETKISIZ" }, 401);
    try {
      return yanit(await yoneticiIslem(await istek.json().catch(() => ({}))));
    } catch (e) {
      return yanit({ hata: String((e as Error).message ?? e) }, 400);
    }
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
    const stil = stilAl(govde.stil);
    await Promise.all(acilan.map((a) => uretimBaslat(a.id, a.girdi, stil)));
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
    await uretimBaslat(id, asil.girdi, stilAl(govde.stil));
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
        try {
          const tahmin = await replicate("predictions/" + is.tahmin_id);
          await sonucuIsle(is, tahmin, stilBul(tahmin.input?.prompt));
        }
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

/* ---------------------------------------------------------------- yönetici */
async function yoneticiIslem(govde: any) {
  if (govde.islem === "yukle") {
    const berber = String(govde.berber ?? "");
    const tutar = Number(govde.tutar);
    if (!/^[a-z0-9_-]+$/.test(berber)) throw new Error("GECERSIZ_BERBER");
    if (!Number.isInteger(tutar) || tutar === 0 || Math.abs(tutar) > 100_000) {
      throw new Error("GECERSIZ_TUTAR");
    }
    const aciklama = String(govde.aciklama ?? "").slice(0, 120) || null;

    // İyimser kilit: bakiye okunduğundan beri değişmediyse yaz. Aynı anda
    // Gürkan fotoğraf gönderirse (foto_is_ac bakiyeyi düşürür) tekrar dener.
    for (let deneme = 0; deneme < 5; deneme++) {
      const { data: c, error } = await yonetici.from("foto_cuzdan")
        .select("bakiye").eq("berber_id", berber).maybeSingle();
      if (error) throw error;
      if (!c) throw new Error("CUZDAN_YOK");
      const yeni = c.bakiye + tutar;
      if (yeni < 0) throw new Error("BAKIYE_EKSIYE_DUSER");

      const { data: guncel, error: gHata } = await yonetici.from("foto_cuzdan")
        .update({ bakiye: yeni }).eq("berber_id", berber).eq("bakiye", c.bakiye)
        .select("bakiye");
      if (gHata) throw gHata;
      if (!guncel?.length) continue;

      const { error: hHata } = await yonetici.from("foto_hareket")
        .insert({ berber_id: berber, tutar, tur: "yukleme", aciklama });
      if (hHata) {
        // Defter yazılamadıysa bakiyeyi de geri al; kayıtsız para olmasın.
        await yonetici.from("foto_cuzdan").update({ bakiye: c.bakiye })
          .eq("berber_id", berber).eq("bakiye", yeni);
        throw hHata;
      }
      return { ok: true, bakiye: yeni, ...(await yoneticiDurum()) };
    }
    throw new Error("TEKRAR_DENE");
  }

  if (govde.islem === "durum") return yoneticiDurum();
  throw new Error("BILINMEYEN_ISLEM");
}

async function yoneticiDurum() {
  const [cuzdanlar, hareketler, isler, hesap] = await Promise.all([
    yonetici.from("foto_cuzdan").select("*").order("berber_id"),
    yonetici.from("foto_hareket").select("berber_id, tutar, tur, aciklama, zaman")
      .order("zaman", { ascending: false }).limit(5000),
    yonetici.from("foto_is").select("berber_id, durum, ucret, olusturuldu").limit(10000),
    replicate("account").catch(() => null),
  ]);
  if (cuzdanlar.error) throw cuzdanlar.error;

  const bugun = istGun(new Date());
  const berberler = (cuzdanlar.data ?? []).map((c) => {
    const h = (hareketler.data ?? []).filter((x) => x.berber_id === c.berber_id);
    const i = (isler.data ?? []).filter((x) => x.berber_id === c.berber_id);
    const topla = (tur: string) => h.filter((x) => x.tur === tur).reduce((a, x) => a + x.tutar, 0);
    const hazir = i.filter((x) => x.durum === "hazir");
    return {
      ...c,
      ozet: {
        yuklenen: topla("yukleme"),
        harcanan: -topla("uretim") - topla("iade"),        // iadeler düşülmüş gerçek gelir
        foto: hazir.length,                                // Replicate'in ücret aldığı üretimler
        tekrar: hazir.filter((x) => x.ucret === 0).length, // bunlardan ücretsiz tekrar olanlar
        hata: i.filter((x) => x.durum === "hata").length,
        isleniyor: i.filter((x) => x.durum === "isleniyor").length,
        bugun: i.filter((x) => x.ucret > 0 && x.durum !== "hata" && istGun(x.olusturuldu) === bugun).length,
      },
      hareketler: h.slice(0, 40),
    };
  });

  return {
    berberler,
    foto_usd: FOTO_USD,
    replicate: hesap ? { bagli: true, hesap: hesap.username } : { bagli: false },
  };
}

/** Bir zamanın İstanbul'daki günü: "2026-09-26" */
function istGun(zaman: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(zaman));
}

/** Postgres hata mesajından bizim kodu çıkarır: "BAKIYE_YETERSIZ" gibi. */
function kodAl(mesaj: string) {
  return mesaj.match(/[A-Z_]{5,}/)?.[0] ?? "BILINMEYEN";
}
