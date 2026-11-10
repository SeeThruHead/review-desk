import itertools, json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

fixture = json.load(open(sys.argv[1]))
port = int(sys.argv[2])
count_file = sys.argv[3] if len(sys.argv) > 3 else None
counter = itertools.count()

def body():
    n = next(counter)
    if count_file and n % 100 == 0:
        open(count_file, "w").write(str(n))
    nodes = fixture["data"]["search"]["nodes"]
    changed = [dict(node, title=f"{node.get('title', '')} #{n}") if i == n % len(nodes) else node for i, node in enumerate(nodes)]
    return json.dumps({"data": {**fixture["data"], "search": {"nodes": changed}}}).encode()

class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length", "0")))
        payload = body()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass

ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
