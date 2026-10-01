"""Generates the Ilse flow diagram, hand-laid, in Portuguese and English:
.github/assets/ilse-architecture.svg (en, used by the README) and ilse-architecture.pt.svg.

Run: python3 scripts/architecture-svg.py
Edit the boxes/arrows below; positions are in px on a 1680-wide canvas.
Strings are written in Portuguese; EN holds their English version.
"""
from pathlib import Path
import sys
from xml.sax.saxutils import escape

LANG = sys.argv[1] if len(sys.argv) > 1 else 'en'
EN = {
    'como funciona — do clique no browser ao commit': 'how it works — from a click in the browser to the commit',
    'tracejado = opcional (modo MCP)': 'dashed = optional (MCP mode)',
    'laranja = volta, decisão ou nota': 'orange = loop, decision or note',
    'DESIGNER · APONTA': 'DESIGNER · POINTS', 'ILSE · ENTENDE E ROTEIA': 'ILSE · UNDERSTANDS & ROUTES',
    'AGENTE · EXECUTA': 'AGENT · EXECUTES', 'CÓDIGO · MOSTRA E REGISTRA': 'CODE · SHOWS & RECORDS',
    'Roda npx ilse': 'Run npx ilse', 'terminal': 'terminal', 'na pasta do projeto': 'in the project folder',
    'Detecta sozinho': 'Detects on its own', 'agente': 'agent', 'dev server': 'dev server', 'tokens': 'tokens',
    'Sobe o proxy': 'Starts the proxy', 'injeta a toolbar': 'injects the toolbar',
    'Combina o commit': 'Agrees on commits',
    'se for git · pergunta 1 vez': 'if it is git · asks once', 'abre o browser': 'opens the browser',
    'nada da Ilse vai pro repo': 'nothing of Ilse goes in the repo', 'é um proxy local — o projeto': "it's a local proxy — the project",
    'não ganha dependência': 'gets no dependency',
    'quem commita': 'whoever commits', 'sabe o porquê de cada': 'knows the why of every', 'mudança da Ilse': 'change Ilse made',
    '↑ MONTAGEM · UMA VEZ': '↑ SETUP · ONCE', '↓ USO · A CADA AJUSTE': '↓ USE · EVERY TWEAK',
    'Aponta': 'Points', 'clique': 'click', 'texto': 'text', 'área': 'area', 'lápis': 'pencil',
    'Ajusta ao vivo': 'Adjusts live', 'arrasta': 'drag', 'entra/sai': 'in/out', 'redimensiona': 'resize',
    'painel': 'panel', 'Aplicar em': 'Apply to',
    'Envia': 'Sends', 'comandos no campo': 'commands in the field', 'nota': 'note',
    'Localiza': 'Locates', 'arquivo:linha': 'file:line', 'pilha do React': 'React stack',
    'conta': 'account', '⌘Z no rascunho': '⌘Z in the draft', 'limite da conta → fila → retoma': 'account limit → queue → resumes',
    'desfazer ⌘Z · refazer ⇧⌘Z': 'undo ⌘Z · redo ⇧⌘Z',
    'mais de uma conta do Claude?': 'more than one Claude account?', 'pergunta qual, uma vez por projeto': 'asks which, once per project',
    'sessão nova': 'new session', 'lê só o trecho': 'reads a slice',
    'dois sinais que concordam': 'two signals that agree', 'o código (AST) e a pilha': 'the code (AST) and React\'s',
    'do próprio React': 'own stack',
    'o agente não procura': "the agent doesn't search", 'chega sabendo onde, o que já': 'it arrives knowing where, what',
    'mudou e quem mais usa': 'changed before, who else uses it',
    'Monta o contexto': 'Builds the context', 'ficha do componente': 'component card', 'histórico': 'history', 'escopo': 'scope',
    'Escolhe o degrau': 'Picks the step', 'o mais barato que resolve': 'the cheapest that works',
    'Troca de classe': 'Class swap', 'sem IA': 'no AI', '$0 · instantâneo': '$0 · instant',
    'Rápido': 'Quick', 'modelo fast': 'fast model', 'JSON de classes': 'classes as JSON', '~$0,01': '~$0.01',
    'Agente': 'Agent', 'sem Bash': 'no Bash', 'Ou o agente puxa': 'Or the agent pulls',
    'ajuste do painel': 'panel tweak', 'classes de 1 elemento': 'classes of 1 element',
    'precisa de mais → agente': 'needs more → agent', 'estrutura · criar': 'structure · create',
    'nada mudou → sobe 1 nível': 'nothing changed → one tier up',
    'Arquivo muda': 'File changes', 'a página atualiza': 'the page updates',
    'Registra': 'Records', 'desfazer ⌘Z': 'undo ⌘Z', 'Commit com contexto': 'Commit with context',
    'Vê na hora': 'Sees it live', 'na própria tela': 'on the real screen',
    'a página muda sozinha': 'the page updates itself', 'não gostou → ⌘Z desfaz': "don't like it → ⌘Z undoes",
    'próximo ajuste': 'next tweak',
    'o degrau mais barato': 'the cheapest step', 'que resolve: $0 → ~$0,01': 'that works: $0 → ~$0.01', '→ agente completo': '→ full agent',
    'tudo desfazível,': 'everything undoable,', 'tudo medido': 'everything measured', '(tempo, tokens, custo)': '(time, tokens, cost)',
    'a IA é sempre': 'the AI is always', 'a do usuário — sem chave,': "the user's own — no key,", 'sem conta da Ilse': 'no Ilse account',
}

def tr(s):
    return EN.get(s, s) if LANG == 'en' else s

ROOT = Path(__file__).resolve().parent.parent
LOGO = '<path d="M54.9554 13.7935H68.4799V-1.52588e-05H149.626V96.551V110.345V151.721H14.3823V137.932H0.857956V-1.52588e-05H54.9554V13.7935ZM109.053 137.932H122.577V124.138H109.053V137.932ZM14.3823 110.345H27.9067V96.551H68.4799V110.345H41.431V124.138H27.9067V137.932H82.004V124.138H95.5284V110.345H109.053V82.7575H122.577V55.1705H82.004V68.964H14.3823V110.345Z" fill="#FA6900"/>'

W, H = 1680, 1600
FG, MUTED, FAINT, LINE, BG, CARD, BRAND = '#0a0a0a', '#6b6b6b', '#a1a1a1', '#9b9b9b', '#fafafa', '#ffffff', '#FA6900'
SANS = "Geist, 'Geist Sans', Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
MONO = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
HAND = "Caveat, 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive"

LANES = {1: 60, 2: 400, 3: 740, 4: 1080}
LW = 300
out = []

def text(x, y, s, size=13, fill=FG, family=SANS, weight=400, anchor='start', spacing=0, rotate=None, style=''):
    s = tr(s)
    rot = f' transform="rotate({rotate} {x} {y})"' if rotate else ''
    ls = f' letter-spacing="{spacing}"' if spacing else ''
    out.append(f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{ls}{rot}{style}>{escape(s)}</text>')

def chip_w(s):
    return len(tr(s)) * 6.25 + 12

boxes = {}

def box(key, lane, y, num, title, rows, dashed=False):
    x = LANES[lane]
    h = 36 + 24 * len(rows) + 4
    dash = ' stroke-dasharray="5 4"' if dashed else ''
    out.append(f'<rect x="{x}" y="{y}" width="{LW}" height="{h}" rx="6" fill="{CARD}" stroke="#c4c4c4" stroke-width="1.25"{dash}/>')
    text(x + 16, y + 25, num, 12, FAINT, MONO)
    text(x + 16 + (len(num) * 7.5 + 10), y + 25, title, 15, FG, SANS, 600)
    cy = y + 36
    for row in rows:
        cx = x + 16
        for c in row:
            w = chip_w(c)
            out.append(f'<rect x="{cx}" y="{cy}" width="{w:.1f}" height="18" rx="3" fill="{CARD}" stroke="#dedede"/>')
            text(cx + 6, cy + 13, c, 10.5, MUTED, MONO)
            cx += w + 5
        cy += 24
    boxes[key] = dict(x=x, y=y, w=LW, h=h, cx=x + LW / 2, cy=y + h / 2, r=x + LW, b=y + h)
    return boxes[key]

def arrow(points, color=LINE, dashed=False, label=None, lx=None, ly=None, lcolor=None, lsize=11, lanchor='middle', lrot=None, hand=False):
    d = 'M ' + ' L '.join(f'{px} {py}' for px, py in points)
    dash = ' stroke-dasharray="4 4"' if dashed else ''
    marker = 'url(#arrow-brand)' if color == BRAND else 'url(#arrow)'
    out.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="1.4"{dash} marker-end="{marker}"/>')
    if label:
        text(lx, ly, label, lsize if not hand else 17, lcolor or (BRAND if color == BRAND else MUTED), HAND if hand else SANS, 400, lanchor, rotate=lrot)

def note(x, y, lines, first_bold=True):
    for i, l in enumerate(lines):
        text(x, y + i * 22, l, 21 if (i == 0 and first_bold) else 17, BRAND, HAND, 600 if (i == 0 and first_bold) else 400)

def connector(x1, y1, x2, y2):
    out.append(f'<path d="M {x1} {y1} L {x2} {y2}" stroke="{BRAND}" stroke-width="1.1" stroke-dasharray="3 4" fill="none"/>')

# ── Frame ───────────────────────────────────────────────────────────────────
out.append(f'<rect width="{W}" height="{H}" fill="{BG}"/>')
out.append(f'<g transform="translate(60 44) scale(0.2)">{LOGO}</g>')
text(98, 69, 'Ilse', 22, FG, SANS, 700)
text(146, 69, 'como funciona — do clique no browser ao commit', 15, MUTED)
text(1640, 60, 'tracejado = opcional (modo MCP)', 12, MUTED, anchor='end')
text(1640, 80, 'laranja = volta, decisão ou nota', 12, MUTED, anchor='end')

for lane, label in {1: 'DESIGNER · APONTA', 2: 'ILSE · ENTENDE E ROTEIA', 3: 'AGENTE · EXECUTA', 4: 'CÓDIGO · MOSTRA E REGISTRA'}.items():
    x = LANES[lane]
    text(x, 150, label, 11.5, MUTED, MONO, 500, spacing=2)
    out.append(f'<rect x="{x - 10}" y="166" width="{LW + 20}" height="{H - 200}" rx="4" fill="none" stroke="#dcdcdc" stroke-dasharray="2 5"/>')

# ── Setup, once ─────────────────────────────────────────────────────────────
s1 = box('s1', 1, 200, '0', 'Roda npx ilse', [['terminal', 'na pasta do projeto']])
s2 = box('s2', 2, 200, '·', 'Detecta sozinho', [['agente', 'conta', 'dev server', 'tokens']])
s3 = box('s3', 2, 310, '·', 'Sobe o proxy', [['localhost:4700', 'injeta a toolbar']])
s4 = box('s4', 4, 310, '·', 'Combina o commit', [['AGENTS.md', 'CLAUDE.md']])
arrow([(s1['r'], s1['cy']), (s2['x'], s2['cy'])])
arrow([(s2['cx'], s2['b']), (s3['cx'], s3['y'])])
arrow([(s2['r'], s2['cy']), (s4['cx'], s2['cy']), (s4['cx'], s4['y'])], label='se for git · pergunta 1 vez', lx=s4['cx'] + 8, ly=s2['cy'] - 8, lanchor='start')
arrow([(s3['x'], s3['cy'] + 12), (s1['r'] - 50, s3['cy'] + 12), (s1['r'] - 50, 500)], label='abre o browser', lx=s1['r'] - 42, ly=s3['cy'] + 40, lanchor='start')
connector(s3['r'], s3['cy'] - 8, 760, s3['cy'] - 8)
note(768, s3['cy'] - 14, ['nada da Ilse vai pro repo', 'é um proxy local — o projeto', 'não ganha dependência'])
connector(s2['r'], s2['b'] - 8, 760, s2['b'] - 8)
note(768, s2['b'] - 2, ['mais de uma conta do Claude?', 'pergunta qual, uma vez por projeto'])
connector(s4['r'], s4['cy'], 1420, s4['cy'])
note(1428, s4['cy'] - 6, ['quem commita', 'sabe o porquê de cada', 'mudança da Ilse'])

# ── Divider ─────────────────────────────────────────────────────────────────
out.append(f'<path d="M 40 452 L {W - 40} 452" stroke="#c8c8c8" stroke-width="1.2" stroke-dasharray="7 5"/>')
text(60, 438, '↑ MONTAGEM · UMA VEZ', 11.5, MUTED, MONO, 500, spacing=2)
text(60, 478, '↓ USO · A CADA AJUSTE', 11.5, MUTED, MONO, 500, spacing=2)

# ── Use, every adjustment ───────────────────────────────────────────────────
u1 = box('u1', 1, 500, '1', 'Aponta', [['clique', 'texto', 'área', 'lápis']])
u2 = box('u2', 1, 600, '2', 'Ajusta ao vivo', [['arrasta', 'entra/sai', 'redimensiona'], ['painel', 'Aplicar em', '⌘Z no rascunho']])
u3 = box('u3', 1, 730, '3', 'Envia', [['comandos no campo', 'nota']])
arrow([(u1['cx'], u1['b']), (u2['cx'], u2['y'])])
arrow([(u2['cx'], u2['b']), (u3['cx'], u3['y'])])

u4 = box('u4', 2, 730, '4', 'Localiza', [['arquivo:linha', 'AST', 'pilha do React']])
u5 = box('u5', 2, 830, '5', 'Monta o contexto', [['ficha do componente', 'histórico'], ['escopo', 'tokens']])
u6 = box('u6', 2, 960, '6', 'Escolhe o degrau', [['o mais barato que resolve']])
arrow([(u3['r'], u3['cy']), (u4['x'], u4['cy'])])
connector(u4['r'], u4['cy'] - 8, 760, u4['cy'] - 8)
note(768, u4['cy'] - 14, ['dois sinais que concordam', 'o código (AST) e a pilha', 'do próprio React'])
arrow([(u4['cx'], u4['b']), (u5['cx'], u5['y'])])
arrow([(u5['cx'], u5['b']), (u6['cx'], u6['y'])])
connector(u5['r'], u5['cy'] - 8, 760, u5['cy'] - 8)
note(768, u5['cy'] - 14, ['o agente não procura', 'chega sabendo onde, o que já', 'mudou e quem mais usa'])

d0 = box('d0', 2, 1090, '0', 'Troca de classe', [['sem IA', '$0 · instantâneo']])
d1 = box('d1', 3, 1090, '1', 'Rápido', [['modelo fast', 'JSON de classes', '~$0,01']])
d3 = box('d3', 3, 1220, '2', 'Agente', [['claude -p · codex · cursor', 'sessão nova'], ['sem Bash', 'fast / strong', 'lê só o trecho'], ['limite da conta → fila → retoma']])
mcp = box('mcp', 3, 1452, '·', 'Ou o agente puxa', [['MCP', 'ilse_watch']], dashed=True)
arrow([(u6['cx'], u6['b']), (d0['cx'], d0['y'])], label='ajuste do painel', lx=u6['cx'] + 8, ly=u6['b'] + 20, lanchor='start')
arrow([(u6['r'], u6['cy'] - 6), (d1['cx'], u6['cy'] - 6), (d1['cx'], d1['y'])], label='classes de 1 elemento', lx=d1['cx'] + 8, ly=u6['cy'] - 14, lanchor='start')
arrow([(d1['cx'], d1['b']), (d1['cx'], d3['y'])], color=BRAND, label='precisa de mais → agente', lx=d1['cx'] + 8, ly=d1['b'] + 24, lanchor='start', hand=True)
arrow([(u6['r'], u6['cy'] + 10), (722, u6['cy'] + 10), (722, d3['cy']), (d3['x'], d3['cy'])], label='estrutura · criar', lx=714, ly=1132, lanchor='middle', lrot=-90)
# escalation loop on the agent box: a small self-loop under it
lx0, lx1 = d3['x'] + 40, d3['x'] + 96
out.append(f'<path d="M {lx0} {d3["b"]} L {lx0} {d3["b"] + 16} L {lx1} {d3["b"] + 16} L {lx1} {d3["b"] + 2}" fill="none" stroke="{BRAND}" stroke-width="1.4" marker-end="url(#arrow-brand)"/>')
text(lx1 + 10, d3['b'] + 21, 'nada mudou → sobe 1 nível', 15, BRAND, HAND, 400)

# ── Code lane ───────────────────────────────────────────────────────────────
c1 = box('c1', 4, 1090, '7', 'Arquivo muda', [['HMR', 'a página atualiza']])
c2 = box('c2', 4, 1220, '9', 'Registra', [['desfazer ⌘Z · refazer ⇧⌘Z', 'journal'], ['.git/ilse/changes.jsonl']])
c3 = box('c3', 4, 1452, '10', 'Commit com contexto', [['ilse changes', 'ilse_changes']])
arrow([(d1['r'], d1['cy']), (c1['x'], d1['cy'])])
bus = 1060
arrow([(d0['cx'], d0['b']), (d0['cx'], 1196), (bus, 1196), (bus, c1['cy'] + 10), (c1['x'], c1['cy'] + 10)])
out.append(f'<path d="M {d3["r"]} {d3["cy"] - 14} L {bus} {d3["cy"] - 14} L {bus} 1196" fill="none" stroke="{LINE}" stroke-width="1.4"/>')
out.append(f'<path d="M {mcp["r"]} {mcp["cy"]} L {bus} {mcp["cy"]} L {bus} {d3["cy"] - 14}" fill="none" stroke="{LINE}" stroke-width="1.4" stroke-dasharray="4 4"/>')
arrow([(c1['cx'], c1['b']), (c2['cx'], c2['y'])])
arrow([(c2['cx'], c2['b']), (c3['cx'], c3['y'])])

# designer sees it, then keeps, undoes or points again
u7 = box('u7', 1, 1090, '8', 'Vê na hora', [['na própria tela']])
arrow([(c1['cx'], c1['y']), (c1['cx'], 1062), (u7['cx'], 1062), (u7['cx'], u7['y'])], label='a página muda sozinha', lx=300, ly=1056)
arrow([(u7['cx'], u7['b']), (u7['cx'], 1410), (c2['cx'] + 60, 1410), (c2['cx'] + 60, c2['b'])], color=BRAND, label='não gostou → ⌘Z desfaz', lx=u7['cx'] + 10, ly=1402, lanchor='start', hand=True)
arrow([(u7['x'], u7['cy']), (36, u7['cy']), (36, u1['cy']), (u1['x'], u1['cy'])], color=BRAND, label='próximo ajuste', lx=28, ly=(u1['cy'] + u7['cy']) / 2, lrot=-90, hand=True)

connector(c1['r'], c1['cy'], 1420, c1['cy'])
note(1428, c1['cy'] - 6, ['o degrau mais barato', 'que resolve: $0 → ~$0,01', '→ agente completo'])
connector(c2['r'], c2['cy'], 1420, c2['cy'])
note(1428, c2['cy'] - 6, ['tudo desfazível,', 'tudo medido', '(tempo, tokens, custo)'])
note(1428, c3['cy'] + 6, ['a IA é sempre', 'a do usuário — sem chave,', 'sem conta da Ilse'])

DESC = ('Ilse flow: setup (npx ilse, detection, proxy) and every tweak (point, adjust live, send, locate, build context, pick the step — class swap, quick, agent — file changes, designer sees it, records and commits).'
        if LANG == 'en' else
        'Fluxo da Ilse: montagem (npx ilse, detecção, proxy) e uso a cada ajuste (apontar, ajustar ao vivo, enviar, localizar, montar contexto, escolher o degrau — troca de classe, rápido, agente — arquivo muda, designer vê, registra e commita).')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">
<title id="t">{'Ilse — how it works' if LANG == 'en' else 'Ilse — como funciona'}</title>
<desc id="d">{DESC}</desc>
<defs>
<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="{LINE}"/></marker>
<marker id="arrow-brand" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="{BRAND}"/></marker>
</defs>
{chr(10).join(out)}
</svg>
'''
name = 'ilse-architecture.svg' if LANG == 'en' else f'ilse-architecture.{LANG}.svg'
(ROOT / '.github' / 'assets' / name).write_text(svg, encoding='utf8')
print('ok', len(svg))
