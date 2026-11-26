#!/usr/bin/env python3
"""
Procedural pixel-art puppy sprite generator for the Desktop Dog GNOME extension.

Draws a cute sitting Shiba-style puppy on a 32x32 logical grid using layered
primitives (ellipses / triangles), then adds a 1px silhouette outline.
Emits one crisp SVG per pose (vector rects, shape-rendering=crispEdges) plus a
scaled PNG contact sheet for visual review.
"""
import os
from PIL import Image

W = H = 32  # logical pixel grid

# ---- palette -------------------------------------------------------------
OUT   = '#3b2b22'  # outline (soft dark brown, cuter than pure black)
FUR   = '#f7d7a8'  # cream main fur
DRK   = '#e3b079'  # tan  (head cap, ear outer, back, tail)
LGT   = '#fff7ec'  # near-white (muzzle, chest, paws, tail tip)
NOSE  = '#44332b'  # nose / mouth
EYE   = '#3b2b22'  # eyes
GLINT = '#ffffff'  # eye sparkle
PINK  = '#f4a7b0'  # cheeks / tongue / inner ear
DEEP  = '#d98fa0'  # deeper pink (open mouth)
COL   = '#79c7c5'  # collar (teal)
TAG   = '#ffd166'  # collar tag (gold)
BONE  = '#d9a066'  # biscuit / treat (contrasts against the chest)
BONEHI = '#eac08a' # biscuit highlight
BALL  = '#e58b8b'  # toy ball (soft red)
BALLHI = '#f4b6b6' # ball highlight


def new_grid():
    return [[None] * W for _ in range(H)]


def put(g, x, y, c):
    x = int(round(x)); y = int(round(y))
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = c


def ellipse(g, cx, cy, rx, ry, c):
    x0, x1 = int(cx - rx - 1), int(cx + rx + 1)
    y0, y1 = int(cy - ry - 1), int(cy + ry + 1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            nx = (x + 0.5 - cx) / (rx + 0.0001)
            ny = (y + 0.5 - cy) / (ry + 0.0001)
            if nx * nx + ny * ny <= 1.0:
                put(g, x, y, c)


def circle(g, cx, cy, r, c):
    ellipse(g, cx, cy, r, r, c)


def rect(g, x0, y0, x1, y1, c):
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            put(g, x, y, c)


def triangle(g, p1, p2, p3, c):
    xs = [p1[0], p2[0], p3[0]]
    ys = [p1[1], p2[1], p3[1]]
    x0, x1 = int(min(xs)), int(max(xs))
    y0, y1 = int(min(ys)), int(max(ys))

    def sign(a, b, p):
        return (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])

    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            p = (x + 0.5, y + 0.5)
            d1, d2, d3 = sign(p1, p2, p), sign(p2, p3, p), sign(p3, p1, p)
            neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
            pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
            if not (neg and pos):
                put(g, x, y, c)


def outline(g):
    """Wrap the opaque silhouette with a 1px OUT ring (into transparent cells)."""
    ring = []
    for y in range(H):
        for x in range(W):
            if g[y][x] is not None:
                continue
            touches = False
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1),
                           (1, 1), (1, -1), (-1, 1), (-1, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and g[ny][nx] is not None \
                        and g[ny][nx] != OUT:
                    touches = True
                    break
            if touches:
                ring.append((x, y))
    for x, y in ring:
        g[y][x] = OUT


# ---- feature painters ----------------------------------------------------

def draw_eyes(g, mode):
    for cx in (12, 20):
        if mode == 'open':
            ellipse(g, cx, 13, 1.7, 2.1, EYE)
            put(g, cx - 1, 12, GLINT)
        elif mode == 'down':                      # looking down (eating)
            ellipse(g, cx, 14, 1.6, 1.7, EYE)
            put(g, cx - 1, 13, GLINT)
        elif mode == 'blink':                     # closed, neutral
            rect(g, cx - 2, 13, cx + 2, 13, EYE)
        elif mode == 'happy':                     # ^ ^  (closed, cheerful)
            for ox, oy in ((-2, 1), (-1, 0), (0, -1), (1, 0), (2, 1)):
                put(g, cx + ox, 13 + oy, EYE)
        elif mode == 'closed':                    # gentle smiling arc (sleep)
            for ox, oy in ((-2, -1), (-1, 0), (0, 0), (1, 0), (2, -1)):
                put(g, cx + ox, 14 + oy, EYE)


def draw_mouth(g, mode):
    # nose first
    ellipse(g, 16, 16, 1.3, 1.1, NOSE)
    put(g, 15, 16, GLINT)
    if mode == 'smile':
        for x, y in ((14, 19), (15, 20), (16, 20), (17, 20), (18, 19)):
            put(g, x, y, NOSE)
    elif mode == 'tiny':
        for x, y in ((15, 19), (16, 19)):
            put(g, x, y, NOSE)
    elif mode == 'open':
        ellipse(g, 16, 20, 2.2, 1.9, NOSE)
        ellipse(g, 16, 20, 1.3, 1.1, DEEP)
    elif mode == 'tongue':
        ellipse(g, 16, 20, 2.3, 1.9, NOSE)
        ellipse(g, 16, 20, 1.3, 1.0, DEEP)
        ellipse(g, 16, 22, 1.3, 1.6, PINK)      # tongue sticking out
        put(g, 16, 23, DEEP)


def draw_tail(g, pose):
    if pose == 'up':
        for (x, y, r) in ((23, 21, 2.3), (25, 18, 2.3), (26, 15, 2.1)):
            circle(g, x, y, r, DRK)
        circle(g, 26, 13, 1.6, LGT)
    elif pose == 'down':
        for (x, y, r) in ((24, 24, 2.3), (26, 26, 2.2)):
            circle(g, x, y, r, DRK)
        circle(g, 27, 27, 1.5, LGT)
    else:  # side (default resting curl)
        for (x, y, r) in ((24, 23, 2.4), (26, 21, 2.3), (27, 18, 2.0)):
            circle(g, x, y, r, DRK)
        circle(g, 27, 16, 1.5, LGT)


def draw_extra(g, extra):
    """Props get their own outline (drawn on a temp grid) so they stay
    readable even when they sit on top of same-coloured fur."""
    if not extra:
        return
    eg = new_grid()
    if extra == 'bone':                           # little bone biscuit, held low
        rect(eg, 13, 28, 19, 29, BONE)
        for cx in (13, 19):
            circle(eg, cx, 27, 1.2, BONE)
            circle(eg, cx, 30, 1.2, BONE)
        rect(eg, 15, 28, 17, 28, BONEHI)
    elif extra == 'ball':                         # bouncy toy ball
        circle(eg, 25, 29, 2.6, BALL)
        put(eg, 24, 28, BALLHI)
        put(eg, 23, 29, BALLHI)
    outline(eg)
    for y in range(H):
        for x in range(W):
            if eg[y][x] is not None:
                g[y][x] = eg[y][x]


# ---- full dog ------------------------------------------------------------

def build(pose):
    g = new_grid()
    eyes   = pose['eyes']
    mouth  = pose['mouth']
    tail   = pose['tail']
    extra  = pose.get('extra')
    cheeks = pose.get('cheeks', 'normal')

    # tail is behind the body
    draw_tail(g, tail)

    # body (sitting) + chest
    ellipse(g, 16, 24, 8.2, 7.0, FUR)
    ellipse(g, 16, 25, 4.2, 5.6, LGT)

    # front paws
    ellipse(g, 12, 30, 2.6, 1.9, LGT)
    ellipse(g, 20, 30, 2.6, 1.9, LGT)

    # collar across the neck
    rect(g, 10, 20, 22, 21, COL)
    ellipse(g, 16, 22, 1.3, 1.3, TAG)

    # head: tan cap, cream face overlay -> two-tone Shiba look
    circle(g, 16, 12, 8.0, DRK)
    ellipse(g, 16, 14, 7.0, 6.2, FUR)

    # ears (outer tan triangle + pink inner)
    triangle(g, (7, 2), (3, 11), (12, 9), DRK)
    triangle(g, (25, 2), (29, 11), (20, 9), DRK)
    triangle(g, (7, 5), (6, 10), (10, 9), PINK)
    triangle(g, (25, 5), (26, 10), (22, 9), PINK)

    # muzzle
    ellipse(g, 16, 17, 4.6, 3.6, LGT)

    # cheeks
    cr = 1.9 if cheeks == 'big' else 1.4
    ellipse(g, 9, 16, cr, cr * 0.75, PINK)
    ellipse(g, 23, 16, cr, cr * 0.75, PINK)

    draw_eyes(g, eyes)
    draw_mouth(g, mouth)
    draw_extra(g, extra)

    outline(g)
    return g


POSES = {
    'dog-idle':    dict(eyes='open',  mouth='smile',  tail='side'),
    'dog-blink':   dict(eyes='blink', mouth='smile',  tail='side'),
    'dog-wag':     dict(eyes='open',  mouth='smile',  tail='up'),
    'dog-happy':   dict(eyes='happy', mouth='open',   tail='up'),
    'dog-sleep':   dict(eyes='closed', mouth='tiny',  tail='down'),
    'dog-eating':  dict(eyes='down',  mouth='open',   tail='side', extra='bone'),
    'dog-playing': dict(eyes='happy', mouth='tongue', tail='up',   extra='ball'),
    'dog-petted':  dict(eyes='happy', mouth='smile',  tail='up',   cheeks='big'),
}


def to_svg(g):
    # merge equal-color horizontal runs into single rects -> smaller files
    rects = []
    for y in range(H):
        x = 0
        while x < W:
            c = g[y][x]
            if c is None:
                x += 1
                continue
            x2 = x
            while x2 + 1 < W and g[y][x2 + 1] == c:
                x2 += 1
            rects.append((x, y, x2 - x + 1, 1, c))
            x = x2 + 1
    body = '\n'.join(
        f'  <rect x="{rx}" y="{ry}" width="{rw}" height="{rh}" fill="{c}"/>'
        for (rx, ry, rw, rh, c) in rects)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" shape-rendering="crispEdges">\n'
        f'{body}\n</svg>\n')


def main():
    out_dir = os.environ.get('OUT_DIR', 'assets')
    os.makedirs(out_dir, exist_ok=True)
    grids = {}
    for name, pose in POSES.items():
        g = build(pose)
        grids[name] = g
        with open(os.path.join(out_dir, name + '.svg'), 'w') as f:
            f.write(to_svg(g))
        print('wrote', os.path.join(out_dir, name + '.svg'))

    # preview contact sheet (scaled 12x, nearest neighbour), light grey bg
    scale, cols, pad = 12, 4, 6
    rows = (len(grids) + cols - 1) // cols
    cw, ch = W * scale, H * scale
    sheet = Image.new('RGBA',
                      (cols * cw + (cols + 1) * pad * scale // 6,
                       rows * (ch + 22) + pad), (235, 235, 238, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(sheet)
    for i, (name, g) in enumerate(grids.items()):
        tile = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for y in range(H):
            for x in range(W):
                c = g[y][x]
                if c:
                    r = int(c[1:3], 16); gg = int(c[3:5], 16); b = int(c[5:7], 16)
                    tile.putpixel((x, y), (r, gg, b, 255))
        tile = tile.resize((cw, ch), Image.NEAREST)
        col = i % cols; row = i // cols
        px = col * cw + (col + 1) * (pad * scale // 6)
        py = row * (ch + 22) + pad
        sheet.alpha_composite(tile, (px, py))
        d.text((px + 2, py + ch + 4), name, fill=(40, 40, 40, 255))
    sheet.save(os.path.join(out_dir, '_preview.png'))
    print('wrote', os.path.join(out_dir, '_preview.png'))


if __name__ == '__main__':
    main()
