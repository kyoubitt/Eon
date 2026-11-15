"""A tiny helper for the hand-drawn style pictures in docs/ (boxes, arrows, bars). Text is measured with the
monospace advance, and anything too wide for its box makes the picture refuse to render."""
import html, random, subprocess, sys, os
INK, PAPER, BLUE, GREEN, TEAL, RED, GREY, AMBER = '#1c1b19', '#fbfaf5', '#2b46c9', '#2f6b3a', '#1f7a68', '#c2412d', '#77736a', '#b7791f'
CH = 0.602
class Sketch:
    def __init__(self, w, h, seed=3):
        self.w, self.h, self.o, self.problems = w, h, [], []
        random.seed(seed)
    def j(self, a=1.6): return random.uniform(-a, a)
    def rough(self, x, y, w, h, col=INK, sw=2.2, dash=False, fill=None):
        d = ' stroke-dasharray="8 7"' if dash else ''
        if fill: self.o.append(f'<path d="M{x+self.j():.1f} {y+self.j():.1f} L{x+w+self.j():.1f} {y+self.j():.1f} L{x+w+self.j():.1f} {y+h+self.j():.1f} L{x+self.j():.1f} {y+h+self.j():.1f} Z" fill="{fill}"/>')
        for k in range(2):
            a = [(px + self.j(1.8), py + self.j(1.8)) for px, py in [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]]
            p = f'M{a[0][0]:.1f} {a[0][1]:.1f} ' + ''.join(f'L{px:.1f} {py:.1f} ' for px, py in a[1:]) + f'L{a[0][0]+self.j(2.5):.1f} {a[0][1]+self.j(2.5):.1f}'
            self.o.append(f'<path d="{p}" fill="none" stroke="{col}" stroke-width="{sw if k == 0 else sw*0.55}" stroke-linejoin="round" stroke-linecap="round"{d}/>')
    def text(self, x, y, s, size=15, col=INK, weight=400, anchor='start'):
        self.o.append(f'<text x="{x}" y="{y}" font-size="{size}" fill="{col}" font-weight="{weight}" text-anchor="{anchor}">{html.escape(s, quote=False)}</text>')
    def node(self, x, y, w, h, title, lines=(), col=INK, dash=False, fill=None, tcol=None, sw=2.2):
        self.rough(x, y, w, h, col, sw, dash, fill)
        self.text(x + 16, y + 32, title, 20, tcol or col, 700)
        if len(title) * 20 * CH > w - 32: self.problems.append(f'title too wide: {title}')
        for i, l in enumerate(lines):
            self.text(x + 16, y + 58 + i * 22, l, 15, GREY)
            if len(l) * 15 * CH > w - 32: self.problems.append(f'line too wide in "{title}": {l}')
        if lines and 58 + (len(lines) - 1) * 22 + 16 > h: self.problems.append(f'box too short: {title}')
    def arrow(self, pts, col=INK, dash=False, both=False, sw=2.2):
        d = ' stroke-dasharray="7 7"' if dash else ''
        p = f'M{pts[0][0]+self.j(.8):.1f} {pts[0][1]+self.j(.8):.1f} ' + ''.join(f'L{px+self.j(.8):.1f} {py+self.j(.8):.1f} ' for px, py in pts[1:])
        ms = ' marker-start="url(#hs)"' if both else ''
        self.o.append(f'<path d="{p}" fill="none" stroke="{col}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"{d} marker-end="url(#h)"{ms}/>')
    def num(self, x, y, n, col=BLUE):
        self.o.append(f'<circle cx="{x}" cy="{y}" r="15" fill="{col}"/>'); self.text(x, y + 6, str(n), 17, '#fff', 700, 'middle')
    def title(self, s, x=50, y=72, size=26):
        w = len(s) * size * CH
        self.o.append(f'<rect x="{x-12}" y="{y-30}" width="{w+26:.0f}" height="40" fill="#ffe66d" opacity=".6" transform="rotate(-.8 {x} {y})"/>')
        self.text(x, y, s, size, INK, 800)
    def svg(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" viewBox="0 0 {self.w} {self.h}" font-family="JetBrains Mono, DejaVu Sans Mono, monospace">'
                '<defs><marker id="h" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M1,1 L9,5 L1,9" fill="none" stroke="#333" stroke-width="1.8"/></marker>'
                '<marker id="hs" markerWidth="10" markerHeight="10" refX="2" refY="5" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9" fill="none" stroke="#333" stroke-width="1.8"/></marker></defs>'
                f'<rect width="{self.w}" height="{self.h}" fill="{PAPER}"/>' + ''.join(self.o) + '</svg>')
    def save(self, name):
        if self.problems: print('\n'.join(self.problems)); sys.exit(1)
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        svg = os.path.join(root, 'docs', 'img', name + '.svg')
        os.makedirs(os.path.dirname(svg), exist_ok=True)
        open(svg, 'w').write(self.svg())
        render(svg, svg[:-4] + '.png', self.w, self.h)
        print('wrote', svg[:-4] + '.png')

def render(svg, png, w, h):
    js = ("const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:%d,height:%d},deviceScaleFactor:2});"
          "await p.goto('file://%s');await p.screenshot({path:'%s'});await b.close();})();") % (w, h, svg, png)
    open('/tmp/_sketch_render.cjs', 'w').write(js)
    subprocess.run(['node', '/tmp/_sketch_render.cjs'], check=True, env=dict(os.environ, NODE_PATH=subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True).stdout.strip()))
