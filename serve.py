# serve.py
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

class COOPCOEPHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 讓頁面成為 cross-origin isolated
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        # 保持
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        # self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        # self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        # 如果你需要載外部 CDN 且它沒有 CORP，可改成：
        # self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        super().end_headers()

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    # 在專案根目錄執行，確保能看到 index.html / dist / models
    ThreadingHTTPServer(("127.0.0.1", port), COOPCOEPHandler).serve_forever()
