#!/usr/bin/env python3
"""Draws examples/architecture.svg: a hand-drawn style picture of how one Eon request flows.
Run: python3 tools/diagram.py   (then render the SVG to PNG with any browser)
Text is measured (monospace), and the script refuses to write the file if any line is wider than its box."""
import random, sys, html
random.seed(11)
W, H = 1200, 1230
INK, PAPER, BLUE, GREEN, TEAL, RED, GREY = '#1c1b19', '#fbfaf5', '#2b46c9', '#2f6b3a', '#1f7a68', '#c2412d', '#77736a'
CH = 0.602  # monospace advance as a fraction of font size
o, problems = [], []

def j(a=1.6): return random.uniform(-a, a)
def esc(s): return html.escape(s, quote=False)

def rough(x, y, w, h, col=INK, sw=2.2, dash=False, fill=None):
    d = ' stroke-dasharray="8 7"' if dash else ''
    if fill:
        o.append(f'<path d="M{x+j():.1f} {y+j():.1f} L{x+w+j():.1f} {y+j():.1f} L{x+w+j():.1f} {y+h+j():.1f} L{x+j():.1f} {y+h+j():.1f} Z" fill="{fill}"/>')
    for k in range(2):
        a = [(px + j(1.8), py + j(1.8)) for px, py in [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]]
        p = f'M{a[0][0]:.1f} {a[0][1]:.1f} ' + ''.join(f'L{px:.1f} {py:.1f} ' for px, py in a[1:]) + f'L{a[0][0]+j(2.5):.1f} {a[0][1]+j(2.5):.1f}'
        o.append(f'<path d="{p}" fill="none" stroke="{col}" stroke-width="{sw if k == 0 else sw*0.55}" stroke-linejoin="round" stroke-linecap="round"{d}/>')

def text(x, y, s, size, col=INK, weight=400, anchor='start'):
    o.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{col}" font-weight="{weight}" text-anchor="{anchor}">{esc(s)}</text>')

def node(x, y, w, h, title, lines=(), col=INK, dash=False, fill=None, tcol=None, sw=2.2):
    rough(x, y, w, h, col, sw, dash, fill)
    text(x + 16, y + 32, title, 21, tcol or col, 700)
    if len(title) * 21 * CH > w - 32: problems.append(f'title too wide: {title}')
    for i, l in enumerate(lines):
        text(x + 16, y + 60 + i * 22, l, 15.5, GREY)
        if len(l) * 15.5 * CH > w - 32: problems.append(f'line too wide in "{title}": {l}')
    if 60 + (len(lines) - 1) * 22 + 14 > h and lines: problems.append(f'box too short: {title}')

def arrow(pts, col=INK, dash=False, both=False, sw=2.2):
    d = ' stroke-dasharray="7 7"' if dash else ''
    p = f'M{pts[0][0]+j(.8):.1f} {pts[0][1]+j(.8):.1f} ' + ''.join(f'L{px+j(.8):.1f} {py+j(.8):.1f} ' for px, py in pts[1:])
    ms = ' marker-start="url(#hs)"' if both else ''
    o.append(f'<path d="{p}" fill="none" stroke="{col}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"{d} marker-end="url(#h)"{ms}/>')

def num(x, y, n, col=BLUE):
    o.append(f'<circle cx="{x}" cy="{y}" r="15" fill="{col}"/>')
    text(x, y + 6, str(n), 17, '#fff', 700, 'middle')

# title with a highlighter sized to the words
title = 'eon: what happens to one request'
tw = len(title) * 26 * CH
o.append(f'<rect x="38" y="42" width="{tw+26:.0f}" height="40" fill="#ffe66d" opacity=".6" transform="rotate(-.8 38 42)"/>')
text(50, 72, title, 26, INK, 800)

L, C, R = 60, 450, 860          # column left edges
LW, CW, RW = 320, 340, 280      # column widths

node(L, 120, LW, 92, 'you', ['type a task, approve plans'])
node(C, 120, CW, 92, 'terminal', ['status line, diffs, Esc stops'])
arrow([(L + LW, 166), (C, 166)]); num(L + LW + 35, 148, 1)

node(C, 280, CW, 200, 'runtime', ['reads the reply as ACTIONS', 'plan gate: no edit without', 'an approved plan', 'keeps evidence, saves session'], BLUE, fill='#eef1ff', sw=3)
arrow([(C + CW / 2, 212), (C + CW / 2, 280)]); num(C + CW / 2 + 28, 250, 2)

# left of runtime
node(L, 280, LW, 92, 'your files', ['git branch, or backups'])
arrow([(C, 326), (L + LW, 326)]); num((C + L + LW) / 2, 304, 5)
node(L, 410, LW, 92, 'hooks (yours)', ['formatter etc. around edits'])
arrow([(C, 456), (L + LW, 456)], dash=True)
node(L, 560, LW, 118, 'pictures', ['@shot.png or /image path', 'text-only models get a', 'description from a helper'], INK, fill='#fff6e9')
arrow([(L + LW, 619), (420, 619), (420, 470), (C, 470)])
text(L, 704, 'look, screenshot, inspect_page', 14, BLUE)

# right: the web
node(R, 280, RW, 92, 'chat tab 1', ['a real browser window'])
arrow([(C + CW, 316), (R, 316)], BLUE); num((C + CW + R) / 2, 296, 2, BLUE)
arrow([(R, 352), (C + CW, 352)], BLUE); num((C + CW + R) / 2, 384, 3, BLUE)
node(R, 440, RW, 112, 'free web chat', ['deepseek, gemini, qwen,', 'sees text, never files'], GREEN, fill='#e9f3e6')
arrow([(R + RW / 2, 372), (R + RW / 2, 440)], both=True)

# below runtime
node(C, 545, 160, 100, 'commands', ['safe: free', 'rest: ask you'])
node(C + 180, 545, 160, 100, 'MCP', ['your tools', 'you approve'])
arrow([(C + 80, 480), (C + 80, 545)]); arrow([(C + 260, 480), (C + 260, 545)])
num(C + 80 + 28, 515, 4)


# sub-agent branch
node(C, 730, CW, 140, 'sub-agent', ['second loop, read only', 'max 8 turns, 3 per request', 'returns up to 300 words'], TEAL, fill='#e7f5f1')
arrow([(C + CW, 440), (825, 440), (825, 775), (C + CW, 775)], TEAL, dash=True)
text(836, 640, 'delegate', 14, TEAL)
node(R, 730, RW, 92, 'chat tab 2', ['its own tab'], TEAL)
arrow([(C + CW, 835), (R, 800)], TEAL)
node(R, 880, RW, 92, 'second model', ['can be a different one'], GREEN, fill='#e9f3e6')
arrow([(R + RW / 2, 822), (R + RW / 2, 880)], TEAL, both=True)

# the loop in words, bottom left
text(L, 760, 'one round', 20, INK, 800)
for i, s in enumerate(['you ask', 'task goes to the runtime', 'prompt goes out to the chat', 'reply comes back as text', 'plan gate checks, you approve', 'it runs; results go back to 2']):
    pass
steps = ['you ask', 'prompt out to the chat', 'reply back as text', 'runtime checks, you approve', 'it runs, results go back to 2']
for i, s in enumerate(steps):
    num(L + 14, 800 + i * 40, i + 1)
    text(L + 40, 806 + i * 40, s, 16)
    if len(s) * 16 * CH > 290: problems.append('step too wide: ' + s)

text(L, 1060, 'solid = works, tested on stand-in sites.   dashed = optional, only if you set it up.', 15, BLUE)
text(L, 1086, 'the live deepseek page itself is untested from the build machine.', 15, BLUE)
text(W - 60, 1086, 'esc / ctrl+c stop anything', 15, GREY, 400, 'end')

if problems:
    print('\n'.join(problems)); sys.exit(1)
svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="1130" viewBox="0 0 {W} 1130" font-family="JetBrains Mono, DejaVu Sans Mono, monospace">'
       '<defs><marker id="h" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9" fill="none" stroke="#333" stroke-width="1.8"/></marker>'
       '<marker id="hs" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9" fill="none" stroke="#333" stroke-width="1.8"/></marker></defs>'
       f'<rect width="{W}" height="1130" fill="{PAPER}"/>' + ''.join(o) + '</svg>')
open('examples/architecture.svg', 'w').write(svg)
print('wrote examples/architecture.svg')
