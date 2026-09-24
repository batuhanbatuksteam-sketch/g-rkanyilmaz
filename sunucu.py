#!/usr/bin/env python3
"""GÜRKAN YILMAZ — THE BARBER · geliştirme sunucusu.

python3 -m http.server hiç cache başlığı göndermiyor; tarayıcı eski JS/CSS'i
tutuyor ve yaptığın değişiklik görünmüyor. Bu sunucu her yanıta no-store
ekler, böylece yenilemek yetiyor.

Kullanım:  python3 sunucu.py [port]     (varsayılan 8010)
"""
import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, bicim, *args):
        # 200'leri sustur, sadece hataları göster
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(bicim, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8010
    import pathlib
    handler = partial(NoCacheHandler, directory=str(pathlib.Path(__file__).parent))
    print(f"GÜRKAN YILMAZ — THE BARBER → http://localhost:{port}")
    print(f"  ana sayfa : http://localhost:{port}/")
    print(f"  randevu   : http://localhost:{port}/randevu.html")
    print(f"  berber    : http://localhost:{port}/berber.html")
    print("  (önbellek kapalı — yenilemek yeter)\n")
    HTTPServer(("", port), handler).serve_forever()
