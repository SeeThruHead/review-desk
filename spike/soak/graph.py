import csv, sys
rows = list(csv.DictReader(open(sys.argv[1])))
pts = [(float(r["minutes"]), int(r["rss_kb"]) / 1024) for r in rows if int(r["rss_kb"]) > 0]
W, H, L, R, T, B = 760, 340, 64, 20, 24, 56
ymax = 140
xmax = 480
x = lambda m: L + m / xmax * (W - L - R)
y = lambda mb: T + (1 - mb / ymax) * (H - T - B)
raw = " ".join(f"{x(m):.1f},{y(v):.1f}" for m, v in pts)
buckets = [[v for m, v in pts if h * 30 <= m < (h + 1) * 30] for h in range(16)]
avg = " ".join(f"{x(h * 30 + 15):.1f},{y(sum(b) / len(b)):.1f}" for h, b in enumerate(buckets) if b)
grid = "".join(f'<line x1="{L}" x2="{W - R}" y1="{y(v):.1f}" y2="{y(v):.1f}" stroke="#dee2e6"/><text x="{L - 8}" y="{y(v) + 5:.1f}" text-anchor="end">{v} MB</text>' for v in range(0, ymax + 1, 20))
ticks = "".join(f'<text x="{x(h * 60):.1f}" y="{H - B + 22}" text-anchor="middle">{h} h</text>' for h in range(9))
print(f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" font-family="system-ui, sans-serif" font-size="14" fill="#212529">
<rect width="{W}" height="{H}" fill="#ffffff"/>
{grid}{ticks}
<text x="{(L + W - R) / 2}" y="{H - 10}" text-anchor="middle">Time since start, polling every second with two pages reconnecting</text>
<polyline points="{raw}" fill="none" stroke="#74c0fc" stroke-width="1.5"/>
<polyline points="{avg}" fill="none" stroke="#1864ab" stroke-width="3"/>
<text x="{W - R - 4}" y="{T + 14}" text-anchor="end" fill="#1864ab" font-weight="600">Half-hour average</text>
<text x="{W - R - 4}" y="{T + 32}" text-anchor="end" fill="#1971c2">Each minute</text>
</svg>''')
