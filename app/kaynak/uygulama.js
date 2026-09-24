/* Gürkan Yılmaz Berber — yalnızca uygulamada çalışan katman.
 *
 * Panelin kendisi (berber.js) web ile ortak. Burada sadece native olan işler var:
 * bildirim izni ve cihaz kaydı, durum çubuğu, uygulamaya dönünce tazeleme.
 */
import { Capacitor } from "@capacitor/core";
// Capacitor'ın kendi PushNotifications eklentisi iOS'ta APNs token döndürüyor,
// Android'de FCM token. Sunucu tarafı FCM ile gönderdiği için iki platformda da
// FCM token veren Firebase Messaging eklentisi kullanılıyor.
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { StatusBar, Style } from "@capacitor/status-bar";
import { App } from "@capacitor/app";
import { db } from "./db.js";

if (Capacitor.isNativePlatform()) {
  baslat();
}

async function baslat() {
  /* ---- Durum çubuğu koyu temaya uysun ---- */
  try {
    await StatusBar.setStyle({ style: Style.Dark });
    if (Capacitor.getPlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#08090b" });
    }
  } catch { /* bazı cihazlarda desteklenmiyor, önemli değil */ }

  /* ---- Berber giriş yapınca cihazı bildirim için kaydet ---- */
  db.auth.onAuthStateChange((olay, oturum) => {
    if (oturum && (olay === "SIGNED_IN" || olay === "INITIAL_SESSION")) {
      bildirimleriKur().catch((e) => console.error("bildirim kurulamadı:", e));
    }
  });

  /* ---- Uygulamaya geri dönünce randevular tazelensin ----
     Berber telefonu cebine koyup çıkarınca eski listeyi görmesin. */
  App.addListener("appStateChange", ({ isActive }) => {
    if (isActive && document.querySelector("#panelEkrani")?.hidden === false) {
      location.reload();
    }
  });
}

let kuruldu = false;

async function bildirimleriKur() {
  if (kuruldu) return;

  let izin = await FirebaseMessaging.checkPermissions();
  if (izin.receive !== "granted") {
    izin = await FirebaseMessaging.requestPermissions();
  }
  if (izin.receive !== "granted") {
    console.warn("bildirim izni verilmedi");
    return;
  }

  kuruldu = true;

  // Token zamanla yenilenebilir; yenisi gelince üzerine yazıyoruz.
  await FirebaseMessaging.addListener("tokenReceived", ({ token }) => {
    cihazKaydet(token).catch((e) => console.error("cihaz kaydedilemedi:", e));
  });

  // Bildirime dokununca paneli tazele ki yeni randevu hemen görünsün.
  await FirebaseMessaging.addListener("notificationActionPerformed", () => {
    location.reload();
  });

  const { token } = await FirebaseMessaging.getToken();
  if (token) await cihazKaydet(token);
}

async function cihazKaydet(token) {
  const { data: hesap } = await db
    .from("berber_hesap").select("berber_id").single();
  if (!hesap) return;

  // Aynı cihaz tekrar kaydolabilir; token birincil anahtar olduğu için üzerine yazar.
  const { error } = await db.from("cihazlar").upsert(
    {
      token,
      berber_id: hesap.berber_id,
      platform: Capacitor.getPlatform(),
      son_gorulme: new Date().toISOString(),
    },
    { onConflict: "token" }
  );
  if (error) console.error("cihaz kaydı reddedildi:", error.message);
}
