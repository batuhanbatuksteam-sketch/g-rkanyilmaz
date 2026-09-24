/* Gürkan Yılmaz — The Barber — yeni randevu düşünce ilgili berbere push bildirimi gönderir.
 *
 * Tetikleyici: randevular tablosuna INSERT (Supabase Database Webhook).
 * Hedef: o berberin kayıtlı cihazları (cihazlar tablosu).
 *
 * Hem iOS hem Android için Firebase Cloud Messaging kullanılıyor. FCM,
 * iOS tarafında APNs'e kendisi devrediyor; böylece iki ayrı gönderim
 * altyapısı kurmak gerekmiyor.
 *
 * Gereken Supabase secret'ları:
 *   FCM_PROJE_ID          Firebase proje kimliği
 *   FCM_ISTEMCI_EPOSTA    servis hesabının client_email alanı
 *   FCM_OZEL_ANAHTAR      servis hesabının private_key alanı (satır sonlarıyla)
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const PROJE = Deno.env.get("FCM_PROJE_ID")!;
const EPOSTA = Deno.env.get("FCM_ISTEMCI_EPOSTA")!;
const ANAHTAR = Deno.env.get("FCM_OZEL_ANAHTAR")!;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/* ---- Google servis hesabıyla erişim jetonu al ---- */
let jeton: { deger: string; bitis: number } | null = null;

async function erisimJetonu(): Promise<string> {
  if (jeton && Date.now() < jeton.bitis - 60_000) return jeton.deger;

  const simdi = Math.floor(Date.now() / 1000);
  const baslik = { alg: "RS256", typ: "JWT" };
  const govde = {
    iss: EPOSTA,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: simdi,
    exp: simdi + 3600,
  };

  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const imzalanacak = `${b64(baslik)}.${b64(govde)}`;

  // PEM -> CryptoKey
  const pem = ANAHTAR.replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const ham = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", ham,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"],
  );

  const imza = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(imzalanacak)),
  );
  const imzaB64 = btoa(String.fromCharCode(...imza))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const cevap = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${imzalanacak}.${imzaB64}`,
    }),
  });

  if (!cevap.ok) throw new Error(`jeton alınamadı: ${await cevap.text()}`);
  const veri = await cevap.json();
  jeton = { deger: veri.access_token, bitis: Date.now() + veri.expires_in * 1000 };
  return jeton.deger;
}

/* ---- Tek bir cihaza gönder ---- */
async function gonder(token: string, baslik: string, govde: string, randevuId: string) {
  const cevap = await fetch(
    `https://fcm.googleapis.com/v1/projects/${PROJE}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await erisimJetonu()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: baslik, body: govde },
          data: { randevu_id: randevuId },
          android: { priority: "HIGH", notification: { sound: "default" } },
          apns: {
            headers: { "apns-priority": "10" },
            payload: { aps: { sound: "default", badge: 1 } },
          },
        },
      }),
    },
  );

  if (cevap.ok) return { token, tamam: true };

  const metin = await cevap.text();
  // Uygulama silinmiş veya token yenilenmişse kaydı temizle, boşuna deneme.
  if (cevap.status === 404 || metin.includes("UNREGISTERED") || metin.includes("INVALID_ARGUMENT")) {
    await db.from("cihazlar").delete().eq("token", token);
    return { token, tamam: false, silindi: true };
  }
  console.error("gönderilemedi:", cevap.status, metin);
  return { token, tamam: false };
}

Deno.serve(async (istek) => {
  try {
    const govde = await istek.json();
    const randevu = govde?.record;

    // Yalnızca yeni randevu ekleneceğinde çalış.
    if (govde?.type !== "INSERT" || !randevu?.id) {
      return new Response(JSON.stringify({ atlandi: true }), { status: 200 });
    }

    const { data, error } = await db.rpc("randevu_bildirimi", { p_randevu_id: randevu.id });
    if (error) throw error;

    const satir = Array.isArray(data) ? data[0] : data;
    const tokenlar: string[] = satir?.tokenlar ?? [];

    if (!tokenlar.length) {
      return new Response(JSON.stringify({ cihaz: 0 }), { status: 200 });
    }

    const sonuc = await Promise.all(
      tokenlar.map((t) => gonder(t, satir.baslik, satir.govde, randevu.id)),
    );

    return new Response(
      JSON.stringify({ gonderilen: sonuc.filter((s) => s.tamam).length, toplam: tokenlar.length }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("bildirim hatası:", e);
    // Webhook'a 200 dönüyoruz: bildirim gitmese bile randevu kaydı bozulmasın.
    return new Response(JSON.stringify({ hata: String(e) }), { status: 200 });
  }
});
