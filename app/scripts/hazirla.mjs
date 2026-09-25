/* Paneli web sitesinden alıp uygulama paketine (www/) hazırlar.
 *
 * Tek kaynak ilkesi: panelin HTML/CSS/JS'i sitede duruyor, burada kopyalanıyor.
 * Böylece bir hatayı düzeltince hem site hem iki uygulama birden düzeliyor.
 *
 * Uygulamaya özel iki fark var:
 *   1. supabase-js CDN'den değil, pakete gömülü olarak gelir (uçakta bile açılır,
 *      WKWebView'da CDN engellenirse etkilenmez).
 *   2. kaynak/ altındaki native yapıştırıcı (push, güvenli alan) eklenir.
 */
import { build } from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kok = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const site = resolve(kok, "..");
const www = resolve(kok, "www");

const log = (m) => console.log("  " + m);

await rm(www, { recursive: true, force: true });
await mkdir(resolve(www, "js/vendor"), { recursive: true });
await mkdir(resolve(www, "css"), { recursive: true });

/* ---- 1. supabase-js'i tek dosyaya gömle ---- */
// Giriş dosyasının yolunu sabit yazmıyoruz; paket sürümleri arasında değişiyor.
// Paket adını verip çözümlemeyi package.json exports alanına bırakıyoruz.
await writeFile(
  resolve(kok, "scripts/.supabase-giris.mjs"),
  'export * from "@supabase/supabase-js";\n'
);
await build({
  entryPoints: [resolve(kok, "scripts/.supabase-giris.mjs")],
  bundle: true,
  format: "esm",
  target: ["es2020"],
  minify: true,
  outfile: resolve(www, "js/vendor/supabase.js"),
  absWorkingDir: kok,
  logLevel: "silent",
});
await rm(resolve(kok, "scripts/.supabase-giris.mjs"), { force: true });
log("supabase-js pakete gömüldü");

/* ---- 2. Panelin dosyalarını kopyala ---- */
for (const [kaynak, hedef] of [
  ["css/style.css", "css/style.css"],
  ["css/berber.css", "css/berber.css"],
  ["js/db.js", "js/db.js"],
  ["js/berber.js", "js/berber.js"],
]) {
  let icerik = await readFile(resolve(site, kaynak), "utf8");
  // Sürüm damgaları tarayıcı önbelleği içindi; pakette gereksiz.
  icerik = icerik.replace(/\?v=\d+/g, "");
  // CDN yerine gömülü sürüm. db.js kitaplığı tembel yüklüyor — import("…")
  // biçimi de yakalanmalı; yoksa uygulama gömülü kopyayı hiç kullanmaz ve
  // CDN'e erişilemeyen yerde panel açılmaz.
  icerik = icerik.replace(
    /(from\s+|import\()"https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\/\+esm"/g,
    '$1"./vendor/supabase.js"'
  );
  await writeFile(resolve(www, hedef), icerik);
}
log("panel dosyaları kopyalandı");

// Hero videosu panelde yok; pakete yalnız görseller giriyor.
await cp(resolve(site, "assets/img"), resolve(www, "assets/img"), { recursive: true });
log("görseller kopyalandı");

/* ---- 3. Uygulamaya özel katmanlar ---- */
// Capacitor eklentileri npm paketi; tarayıcı bare specifier'ı çözemez, bu yüzden
// paketleniyor. ./db.js dışarıda bırakılıyor ki panelle AYNI supabase istemcisini
// kullansın — ayrı bir kopya olsaydı oturumu göremezdi.
await build({
  entryPoints: [resolve(kok, "kaynak/uygulama.js")],
  bundle: true,
  format: "esm",
  target: ["es2020"],
  minify: true,
  // ./db.js panelle aynı örnek olsun diye dışarıda bırakılıyor.
  external: ["./db.js"],
  // firebase/messaging, eklentinin WEB sürümünün bağımlılığı. Native'de o kod
  // hiç çalışmıyor. Daha önce "external" bırakmıştım; o zaman pakette çıplak
  // bir "firebase/messaging" importu kalıyor ve WebView bunu çözemeyip
  // "does not resolve to a valid URL" ile tüm modülü düşürüyordu — yani
  // bildirim kaydı hiç yapılmıyordu. Bu yüzden boş bir modülle karşılıyoruz.
  plugins: [{
    name: "firebase-web-bos",
    setup(b) {
      b.onResolve({ filter: /^firebase\// }, (a) => ({ path: a.path, namespace: "fb-bos" }));
      b.onLoad({ filter: /.*/, namespace: "fb-bos" }, () => ({
        contents: `
          const yok = () => { throw new Error("web push bu uygulamada kullanılmıyor"); };
          export const deleteToken = yok, getMessaging = yok, getToken = yok,
                       onMessage = yok, isSupported = async () => false;
        `,
        loader: "js",
      }));
    },
  }],
  outfile: resolve(www, "js/uygulama.js"),
  logLevel: "silent",
});
await cp(resolve(kok, "kaynak/uygulama.css"), resolve(www, "css/uygulama.css"));
log("uygulama katmanı paketlendi");

/* ---- 4. index.html'i panelden türet ---- */
let html = await readFile(resolve(site, "berber.html"), "utf8");
html = html.replace(/\?v=\d+/g, "");

// Google Fonts internete bağlı; uygulamada sistem yazı tipine düşsün diye
// bırakıyoruz ama engellenirse tasarım bozulmasın (style.css'te fallback var).
html = html.replace(
  '<link rel="stylesheet" href="css/berber.css" />',
  '<link rel="stylesheet" href="css/berber.css" />\n<link rel="stylesheet" href="css/uygulama.css" />'
);
html = html.replace(
  '<script type="module" src="js/berber.js"></script>',
  '<script type="module" src="js/berber.js"></script>\n<script type="module" src="js/uygulama.js"></script>'
);
// Native kabukta viewport'un klavyeyle zıplamaması için
html = html.replace(
  /<meta name="viewport" content="[^"]*"/,
  '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, user-scalable=no"'
);
// Uygulamada oturum korunur: telefon zaten kilitli, her açılışta şifre sorulmaz.
// Webde bu bayrak yok, orada her açılışta şifre sorulmaya devam eder.
html = html.replace(
  "</head>",
  "<script>window.UYGULAMA_NATIVE = true;</script>\n</head>"
);
await writeFile(resolve(www, "index.html"), html);
log("index.html hazırlandı");

console.log("\n  www/ hazır. Sıradaki: npx cap sync\n");
