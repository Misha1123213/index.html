#!/usr/bin/env python3
"""Simple static file server for local development on Replit.

Serves the project's static files (index.html, JSON data, images) on
port 5000 and disables caching so edits show up immediately on refresh.
"""
import http.server
import socketserver

PORT = 5000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with ReusableTCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        print(f"Serving on http://0.0.0.0:{PORT}")
        httpd.serve_forever()
