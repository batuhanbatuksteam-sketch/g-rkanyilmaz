# Gürkan Yılmaz Berber — uygulama

```bash
cd app
npm install
npx cap add ios
npx cap add android
npm run senkron
```

## İkon ve açılış ekranı

Markanın logosunu 1024x1024 koyu zemine ortalayıp `assets/icon.png`,
2732x2732 olarak `assets/splash.png` yap. Logoyu **büyütme** — küçükse
tuvalde daha çok boşluk bırak, bulanıklaştırma.

```bash
npx capacitor-assets generate \
  --iconBackgroundColor '#08090b' --splashBackgroundColor '#08090b'
```

## iOS

`ios/App/App/AppDelegate.swift` içine (bildirimler bunsuz çalışmaz):

```swift
import FirebaseCore
// didFinishLaunchingWithOptions içinde, return'den önce:
FirebaseApp.configure()
```

Sonra Xcode'da: Signing & Capabilities → Team seç → + Capability →
Push Notifications.

## Android

`android/app/google-services.json` dosyasını koy, `npm run apk` çalıştır.
Gradle dosyayı görünce google-services eklentisini kendi devreye alıyor.
