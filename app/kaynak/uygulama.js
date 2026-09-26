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
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
// db.js tembel bir dbAl() veriyor (webde CDN düşerse modül ölmesin diye).
// Pakette kitaplık gömülü, yani burada her zaman aynı istemci döner — panelle
// ortak örnek, oturumu görebilsin.
import { dbAl } from "./db.js";

if (Capacitor.isNativePlatform()) {
  window.UYGULAMA_PAYLAS = fotoPaylas;
  baslat();
}

/* ---- Stüdyo: düzenlenen fotoğrafı galeriye kaydet ----
   WebView indirme yapamıyor. Dosyayı önbelleğe yazıp paylaşım sayfasını
   açıyoruz; berber "Resmi Kaydet" ile galeriye, ya da doğrudan
   Instagram / WhatsApp'a gönderir. */
async function fotoPaylas(adres, ad) {
  const blob = await (await fetch(adres)).blob();
  const veri = await new Promise((ok, red) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.onerror = red;
    r.readAsDataURL(blob);
  });
  const { uri } = await Filesystem.writeFile({ path: ad, data: veri, directory: Directory.Cache });
  await Share.share({ files: [uri] });
}

async function baslat() {
  const db = await dbAl();
  if (!db) return;

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
      bildirimleriKur(db).catch((e) => console.error("bildirim kurulamadı:", e));
    }
  });

  /* ---- Uygulamaya geri dönünce randevular tazelensin ----
     Berber telefonu cebine koyup çıkarınca eski listeyi görmesin.
     Sayfayı yeniden yüklemiyoruz: berber blok düzenini yazarken uygulamadan
     çıkıp dönerse kaydetmediği satırlar durmalı. */
  App.addListener("appStateChange", ({ isActive }) => {
    if (isActive && document.querySelector("#panelEkrani")?.hidden === false) {
      tazele();
    }
  });
}

/** Panelin kendi tazeleme kancası. Yoksa (panel henüz açılmadıysa) sessiz kal. */
function tazele() {
  if (typeof window.UYGULAMA_TAZELE === "function") window.UYGULAMA_TAZELE();
}

let kuruldu = false;

async function bildirimleriKur(db) {
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
    cihazKaydet(db, token).catch((e) => console.error("cihaz kaydedilemedi:", e));
  });

  // Bildirime dokununca paneli tazele ki yeni randevu hemen görünsün.
  await FirebaseMessaging.addListener("notificationActionPerformed", () => {
    tazele();
  });

  const { token } = await FirebaseMessaging.getToken();
  if (token) await cihazKaydet(db, token);
}

async function cihazKaydet(db, token) {
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
