# serve.py
import mimetypes
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

# --- 修正常見 MIME 對應（Windows 上特別重要） ---
mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('application/javascript', '.mjs')   # ES6 modules
mimetypes.add_type('application/wasm',       '.wasm')
mimetypes.add_type('application/json',       '.map')   # source maps
mimetypes.add_type('application/json',       '.json')

class COOPCOEPHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 讓頁面成為 cross-origin isolated
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"伺服器運行在 http://127.0.0.1:{port}/")
    print("MIME types 已修正: .js/.mjs → application/javascript, .wasm → application/wasm")
    # 在專案根目錄執行，確保能看到 index.html / dist / models
    ThreadingHTTPServer(("127.0.0.1", port), COOPCOEPHandler).serve_forever()
