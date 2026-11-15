#!/usr/bin/env python3
"""Records examples/demo.gif: Eon fixing a typo with a scripted model (no login, no browser).
Needs: pip install pyte pillow. Run from the repo root:  python3 tools/make-demo.py"""
import os, pty, sys, time, select, subprocess, tempfile, struct, fcntl, termios, json
import pyte
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COLS, ROWS = 96, 36
FONT = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf'
BOLD = '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf'
PAL = {'default': None, 'black': '#1b1d21', 'red': '#e06c75', 'green': '#7fc98f', 'brown': '#e5c07b', 'blue': '#6aa0f0', 'magenta': '#c678dd', 'cyan': '#56b6c2', 'white': '#c8ccd4',
       'brightblack': '#6b7280', 'brightred': '#ff8f86', 'brightgreen': '#98e0a8', 'brightbrown': '#f0d28a', 'brightblue': '#8db0ff', 'brightmagenta': '#d9a0f0', 'brightcyan': '#7fd6e0', 'brightwhite': '#f5f6f8'}
BG, FG = (13, 14, 16), (200, 204, 212)
fnt, fb = ImageFont.truetype(FONT, 15), ImageFont.truetype(BOLD, 15)
SYM = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 15)  # for symbols JetBrains Mono lacks
SYMS = set('⎿⎇❯●✓✗•…↑↓→')
CW, CH = 9, 19

def color(c):
    if c in PAL and PAL[c]: return PAL[c]
    if len(c) == 6:
        try: int(c, 16); return '#' + c
        except ValueError: return None
    return None

def render(screen):
    im = Image.new('RGB', (COLS * CW + 24, ROWS * CH + 24), BG); d = ImageDraw.Draw(im)
    for y in range(ROWS):
        line = screen.buffer[y]
        for x in range(COLS):
            ch = line[x]
            if ch.data == ' ' and not ch.reverse: continue
            glyph = {'⎿': '└', '⎇': '*'}.get(ch.data, ch.data)
            col = color(ch.fg) or '#%02x%02x%02x' % FG
            if ch.reverse:
                d.rectangle([12 + x * CW, 12 + y * CH, 12 + (x + 1) * CW, 12 + (y + 1) * CH], fill=(200, 204, 212)); col = '#0d0e10'
            d.text((12 + x * CW, 12 + y * CH), glyph, font=SYM if glyph in SYMS else (fb if ch.bold else fnt), fill=col)
    return im

def main():
    work = tempfile.mkdtemp(prefix='demo-')
    open(work + '/greet.js', 'w').write('const name = "wrold";\nconsole.log("hello " + name);\n')
    subprocess.run('git init -q && git add -A && git -c user.name=demo -c user.email=demo@localhost commit -q -m start', shell=True, cwd=work, check=True)
    screen = pyte.Screen(COLS, ROWS); stream = pyte.ByteStream(screen)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(work); e = dict(os.environ, TERM='xterm-256color', HOME=work + '/.home', EON_NO_UPDATE_CHECK='1'); os.makedirs(e['HOME'], exist_ok=True)
        os.makedirs(e['HOME'] + '/.eon', exist_ok=True); open(e['HOME'] + '/.eon/firstrun.json', 'w').write('{}')
        os.execvpe('node', ['node', ROOT + '/bin/eon.js', 'Fix the greeting', '--model', 'mock', '--script', ROOT + '/examples/demo-script.json', '--no-splash'], e)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    frames, last, t0, answered = [], None, time.time(), 0
    def pump(t):
        end = time.time() + t
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                try: d = os.read(fd, 65536)
                except OSError: return False
                if not d: return False
                stream.feed(d)
        return True
    while time.time() - t0 < 40:
        if not pump(0.35): break
        text = '\n'.join(screen.display)
        if text != last:
            frames.append((render(screen), 1.0)); last = text
        low = text.lower()
        # answer the questions: approve with Enter (the first option is "Yes")
        if ('approve this plan' in low or 'start step' in low or 'apply this edit' in low or 'run it' in low or 'yes' in low and '❯' in text) and answered < 8:
            time.sleep(0.8); pump(0.2); frames.append((render(screen), 1.2)); os.write(fd, b'\r'); answered += 1; last = None
        if 'done' in low and 'fix the greeting' in low and answered >= 1 and ('✓' in text):
            pump(0.8); frames.append((render(screen), 3.0)); break
    try: os.kill(pid, 9)
    except OSError: pass
    if len(frames) < 4: sys.exit('the demo did not run as expected (only %d frames)' % len(frames))
    # keep the GIF small: at most 28 frames, quantised
    step = max(1, len(frames) // 28); frames = frames[::step] + [frames[-1]]
    print('distinct frames:', len({f.tobytes() for f, _ in frames}), 'of', len(frames))
    imgs = [f.convert('P', palette=Image.ADAPTIVE, colors=64) for f, _ in frames]
    out = os.path.join(ROOT, 'examples', 'demo.gif')
    imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=[int(d * 1000) for _, d in frames], loop=0, optimize=True)
    print('wrote', out, os.path.getsize(out) // 1024, 'KB,', len(imgs), 'frames')

main()
