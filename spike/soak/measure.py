import json, os, statistics, subprocess, sys, threading, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SPIKE = os.path.dirname(HERE)
OUT = os.path.expanduser("~/tmp/investigations/review-desk/measure")
FIXTURE = os.path.expanduser("~/tmp/investigations/review-desk/fixture.json")
A_SERVER = f"{SPIKE}/a-bun/dist/review-desk-spike"
A_TRAY = f"{SPIKE}/a-tray/target/release/review-desk-tray"
B = f"{SPIKE}/b-rust/target/release/review-desk-b"
WATCH = b'{"_tag":"Request","id":"1","tag":"Watch","payload":null,"headers":[]}\n'

SPIKES = {
    "a": {"port": 4710, "mock": 4811, "launch": [A_TRAY], "stream": "rpc"},
    "b": {"port": 4720, "mock": 4812, "launch": [B], "stream": "sse"},
}


def env_for(name, poll_ms):
    spike = SPIKES[name]
    return {
        **os.environ,
        "GITHUB_TOKEN": "soak",
        "GITHUB_GRAPHQL_URL": f"http://127.0.0.1:{spike['mock']}/graphql",
        "POLL_MS": str(poll_ms),
        "PORT": str(spike["port"]),
        "REVIEW_DESK_SERVER": A_SERVER,
    }


def tree(pid):
    children = subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True).stdout.split()
    return [pid] + [p for c in children for p in tree(int(c))]


def rss_kb(pids):
    out = subprocess.run(["ps", "-o", "pid=,rss=", "-p", ",".join(map(str, pids))], capture_output=True, text=True).stdout
    return {int(pid): int(rss) for pid, rss in (line.split() for line in out.strip().splitlines())}


def open_page(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


def stream_for(name, seconds):
    spike = SPIKES[name]
    request = (
        urllib.request.Request(f"http://127.0.0.1:{spike['port']}/rpc", data=WATCH, headers={"content-type": "application/ndjson"})
        if spike["stream"] == "rpc"
        else urllib.request.Request(f"http://127.0.0.1:{spike['port']}/events")
    )
    deadline = time.time() + seconds
    try:
        with urllib.request.urlopen(request, timeout=seconds + 5) as response:
            while time.time() < deadline and response.read1(65536):
                pass
    except Exception:
        pass


def start(name, poll_ms):
    return subprocess.Popen(SPIKES[name]["launch"], env=env_for(name, poll_ms), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def stop(process):
    subprocess.run(["pkill", "-TERM", "-g", str(os.getpgid(process.pid))])
    process.wait(timeout=10)


def startup_ms(name):
    process = start(name, 60_000)
    began = time.perf_counter()
    while not open_page(SPIKES[name]["port"]):
        time.sleep(0.005)
    took = (time.perf_counter() - began) * 1000
    stop(process)
    time.sleep(1)
    return took


def sample(process):
    pids = tree(process.pid)
    return rss_kb(pids)


def soak(name, poll_ms, minutes, churn):
    process = start(name, poll_ms)
    while not open_page(SPIKES[name]["port"]):
        time.sleep(0.05)
    running = threading.Event()
    running.set()

    def churner():
        while running.is_set():
            open_page(SPIKES[name]["port"])
            stream_for(name, 3)

    workers = [threading.Thread(target=churner, daemon=True) for _ in range(churn)]
    [worker.start() for worker in workers]
    path = f"{OUT}/soak-{name}-{poll_ms}ms.csv"
    began = time.time()
    with open(path, "w") as csv:
        csv.write("seconds,total_kb,per_process\n")
        while time.time() - began < minutes * 60:
            rss = sample(process)
            csv.write(f"{int(time.time() - began)},{sum(rss.values())},{json.dumps(rss).replace(',', ';')}\n")
            csv.flush()
            time.sleep(15)
    running.clear()
    stop(process)
    return path


def idle_and_polling(name):
    process = start(name, 60_000)
    while not open_page(SPIKES[name]["port"]):
        time.sleep(0.05)
    time.sleep(30)
    idle = sample(process)
    stop(process)
    time.sleep(1)
    process = start(name, 1000)
    while not open_page(SPIKES[name]["port"]):
        time.sleep(0.05)
    client = threading.Thread(target=stream_for, args=(name, 70), daemon=True)
    client.start()
    readings = []
    end = time.time() + 60
    while time.time() < end:
        readings.append(sample(process))
        time.sleep(2)
    stop(process)
    time.sleep(1)
    return {"idle": idle, "polling_last": readings[-1], "polling_peak_total": max(sum(r.values()) for r in readings)}


def mocks():
    return [
        subprocess.Popen([sys.executable, "-I", f"{HERE}/mock_github.py", FIXTURE, str(spike["mock"]), f"{OUT}/polls-{spike['mock']}.txt"], start_new_session=True)
        for spike in SPIKES.values()
    ]


def main():
    os.makedirs(OUT, exist_ok=True)
    mode = sys.argv[1]
    servers = mocks()
    time.sleep(1)
    try:
        if mode == "basics":
            result = {
                "sizes": {path: os.path.getsize(path) for path in [A_SERVER, A_TRAY, B]},
                "startup_ms": {name: statistics.median([startup_ms(name) for _ in range(5)]) for name in SPIKES},
                "memory": {name: idle_and_polling(name) for name in SPIKES},
            }
            open(f"{OUT}/basics.json", "w").write(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
        if mode == "soak":
            poll_ms, minutes, churn = int(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
            threads = [threading.Thread(target=soak, args=(name, poll_ms, minutes, churn)) for name in SPIKES]
            [thread.start() for thread in threads]
            [thread.join() for thread in threads]
            print("soak done")
    finally:
        [subprocess.run(["kill", str(server.pid)]) for server in servers]


main()
