import itertools, json, os, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

S = os.path.dirname(os.path.abspath(__file__))
HOURS = float(sys.argv[1])
fixture = json.load(open(f"{S}/github-fixture.json"))
base = fixture["data"]["repository"]["pullRequests"]["nodes"][0]
counter = itertools.count()

def body():
    n = next(counter)
    nodes = [dict(base, number=i + 1, state="OPEN", title=f"{base['title']} {i}" + (f" #{n}" if i == n % 30 else "")) for i in range(30)]
    return json.dumps({"data": {"repository": {"pullRequests": {"nodes": nodes}}}}).encode()

class Mock(BaseHTTPRequestHandler):
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

threading.Thread(target=ThreadingHTTPServer(("127.0.0.1", 4813), Mock).serve_forever, daemon=True).start()
desk = subprocess.Popen([f"{S}/review-desk-bin", "serve"], env={**os.environ, "REVIEW_DESK_HOME": f"{S}/home"}, stdout=open(f"{S}/desk.log", "w"), stderr=subprocess.STDOUT)
time.sleep(5)
running = threading.Event(); running.set()
WATCH = b'{"_tag":"Request","id":"1","tag":"WatchBoard","payload":null,"headers":[]}\n'

def churn():
    while running.is_set():
        try:
            request = urllib.request.Request("http://127.0.0.1:4794/rpc", data=WATCH, headers={"content-type": "application/ndjson"})
            with urllib.request.urlopen(request, timeout=8) as response:
                end = time.time() + 3
                while time.time() < end and response.read1(65536):
                    pass
            urllib.request.urlopen("http://127.0.0.1:4794/", timeout=5).read()
        except Exception:
            time.sleep(1)

[threading.Thread(target=churn, daemon=True).start() for _ in range(2)]
began = time.time()
with open(f"{S}/rss.csv", "w") as csv:
    csv.write("minutes,polls,rss_kb\n")
    while time.time() - began < HOURS * 3600 and desk.poll() is None:
        rss = subprocess.run(["ps", "-o", "rss=", "-p", str(desk.pid)], capture_output=True, text=True).stdout.strip()
        csv.write(f"{(time.time() - began) / 60:.1f},{next(counter)},{rss}\n")
        csv.flush()
        time.sleep(60)
running.clear()
desk.terminate()
print("soak done", "desk exited early" if desk.poll() not in (None, -15, 0) else "")
