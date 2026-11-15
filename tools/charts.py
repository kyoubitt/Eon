#!/usr/bin/env python3
"""Draws docs/img/bench-*.png from docs/bench-data.json (made by tools/bench.mjs)."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sketch import *
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(root, 'docs', 'bench-data.json')))

def bars(s, x0, y0, w, h, items, unit, vmax, colors):
    """Horizontal bars. items: [(label, value)]"""
    row = h / len(items)
    for i, (label, v) in enumerate(items):
        y = y0 + i * row
        s.text(x0, y + row * 0.62, label, 16, INK, 600)
        bw = max(6, (w - 190) * v / vmax)
        s.rough(x0 + 150, y + row * 0.2, bw, row * 0.55, colors[i % len(colors)], 2, fill=colors[i % len(colors)] + '33')
        s.text(x0 + 150 + bw + 12, y + row * 0.62, f'{v:g} {unit}', 16, INK, 700)

# 1. per message, per site
s = Sketch(1200, 700, seed=21)
s.title('Eon\'s own time per message (stand-in pages, no model time)')
sites = d['perSite']
items = [(k, v['median']) for k, v in sites.items()]
bars(s, 60, 120, 1080, 440, items, 's', 2.0, [BLUE, TEAL, GREEN, AMBER])
s.text(60, 600, 'About 1.2 s is Eon\'s own cost per message: paste it, send it, and a short quiet window to be sure the reply is finished.', 15, GREY)
s.text(60, 624, 'A real model adds its own time on top. Pauses meant to look human are off by default (--pace slow adds them).', 15, GREY)
s.text(60, 660, f'median of {list(sites.values())[0]["n"]} messages per site · node {d["node"]} · {d["platform"]} · {d["cpus"]} cores', 14, BLUE)
s.save('bench-driver')

# 2. messages for a small fix
s = Sketch(1200, 520, seed=22)
s.title('model messages needed for a one-line fix (scripted minimum)')
m = d['messages']
items = [(x['level'], x['messages']) for x in m]
bars(s, 60, 120, 1080, 220, items, 'messages', 4, [BLUE, GREEN, TEAL])
s.text(60, 380, 'focused: read the code, send a plan, then edit and finish. quick: an edit under 20 lines in one file needs no plan.', 15, GREY)
s.text(60, 404, 'A scripted model that answers in the fewest messages the rules allow; a real model can take more. It shows the protocol, not a model.', 15, GREY)
s.text(60, 440, f'start-up: eon --help takes {d["startupMs"]["median"]} ms (median of 15 runs)', 15, BLUE)
s.save('bench-messages')
