# Referência

[English](reference.md) · **Português** · [← README](../LEIAME.md)

## Instalar

Rode sem instalar, na pasta do seu projeto:

```bash
npx ilse-design
```

Para deixar o comando disponível, instale uma vez:

```bash
npm install -g ilse-design   # instala como `ilse` / `ilse-design`
```

Quando sai uma versão nova, a Ilse avisa ao iniciar, com o comando para atualizar. Cada versão também vira uma [Release no GitHub](https://github.com/idantas/ilse/releases).

## Onde a Ilse abre

Por padrão a Ilse **sobe o seu servidor de dev por trás e fica com a porta de sempre**. Ela roda o seu script `dev` (ou `start`) numa porta escondida — a porta do app + 10000 — e põe o proxy dela na porta do próprio app:

```
localhost:3000  →  Ilse (proxy + barra)  →  localhost:13000  (seu servidor de dev)
```

O navegador continua no mesmo endereço, então o que está preso a ele continua funcionando: o login salvo no navegador, cookies, callbacks de SSO e OAuth, links em e-mails. Nada é escrito no projeto, e funciona em qualquer navegador. Ctrl+C para a Ilse e o servidor de dev juntos; o log do servidor aparece no terminal da Ilse.

- **A porta:** detectada — um `--port` / `-p` no script, senão `server.port` no `vite.config`, senão o padrão do framework (Next 3000, Vite 5173). Na primeira vez em cada projeto a Ilse mostra — *Seu app vai rodar em localhost:5173* — e você escolhe **rodar nessa porta** ou **mudar a porta**. A escolha fica salva por projeto em `~/.ilse/config.json`; `ilse-design --port <n>` muda depois, `--target <n>` vale só para uma execução.
- **Monorepos:** quando o script da raiz é um orquestrador (`turbo dev`, …), a Ilse acha os apps Vite e Next do workspace (`workspaces` no `package.json`, ou `pnpm-workspace.yaml`) e roda o `dev` do próprio app, na pasta dele — o orquestrador não repassaria a porta escondida. Com vários apps, ela pergunta uma vez qual abrir.
- **A porta escondida:** `PORT` para todos, mais `--port` no Next e no Vite (uma flag depois da do script vale mais).
- **Porta já em uso:** a Ilse avisa e para — ela nunca põe a barra em cima de um servidor que não subiu, que pode ser de outro projeto. Se for o seu servidor de dev, pare ele e rode `ilse` de novo, ou use ele como está com `--separate`. Um servidor que já carrega a barra (plugin Vite) é usado ali mesmo.
- **Endereço separado:** `--separate` numa execução, ou escolha isso na primeira vez. Você roda o servidor de dev e a Ilse abre `localhost:4700`; o que está preso ao endereço original (login, callbacks) fica lá.
- **Ainda não coberto:** um script de dev que sobe vários servidores juntos (todos recebem a mesma `PORT`), apps que precisam de outros serviços do workspace rodando junto, e frameworks que não leem nem `PORT` nem `--port`. Use `--separate` nesses casos.

## Modos

Na primeira vez, a Ilse pergunta como entregar as anotações ao seu agente:

- **Automático** (recomendado): a Ilse chama o seu agente. Nada para colar.
- **Pelo chat do agente (MCP)**: o seu agente puxa as anotações — veja [Conectar seu agente](#conectar-seu-agente-mcp).
- **Área de transferência**: a Ilse copia cada anotação e você cola onde quiser.

## A barra

### Apontar e ajustar

- **3 jeitos de apontar:** clicar num elemento, selecionar texto ou desenhar uma área.
- **Selecionar o pai:** o botão ↰ no card da nota sobe a seleção para o elemento que contém o atual (wrappers de biblioteca do mesmo tamanho são pulados). Um clique dentro de um SVG seleciona o `<svg>` inteiro; ⌘-clique (Ctrl-clique) seleciona o elemento exato, como um path de um ícone.
- **Painel de propriedades:** texto, layout (largura/altura como Fixed · Hug · Fill, fluxo, alinhamento, gap, padding e margin por lado), tipografia, cores, borda, arredondamento e opacidade — com a escala e os tokens do seu projeto.
- **None:** as listas de espaçamento, arredondamento e espessura da borda começam com *None* (zero) — sem padding, cantos retos, sem borda.
- **Borda:** o *+* adiciona e já mostra cor, espessura, estilo e lados; o *−* tira.
- **Aplicar em — só neste ou todos:** quando o elemento faz parte de um componente repetido na página. Com *Todos · N*, os ajustes do painel aparecem em todas as instâncias de uma vez.
- **Editar texto:** elementos de texto ganham um campo *Text* no topo do painel. Texto que vem de variável, prop ou tradução vai para o agente, que muda na origem.
- **Remover um elemento:** *Remove element* no fim do painel, ou a tecla Delete (fn+⌫ no Mac) com a nota vazia — o ⌫ funciona com o foco fora da nota. Numa lista feita com `.map`, só aquele item sai, a não ser que *Aplicar em* diga todos.
- **Mover de verdade:** arraste para reordenar, ou para dentro e para fora de containers; a página se reorganiza ao vivo.
- **Redimensionar:** arraste as alças, com encaixe na grade.
- **Lápis:** rabisque na página; os traços são lidos e vão junto.
- **Imagens de referência:** cole ou envie um print ou SVG.

### Revisar a página

- **Scan:** analisa a página inteira e lista problemas de design por categoria — contraste, tipografia, espaçamento, acessibilidade, componentes. Passe o mouse num problema para ver onde ele está.
- **Sugestões de um elemento:** o botão dos óculos no card mostra os problemas daquele elemento. *Corrigir todas as sugestões* envia tudo como um pedido; *Analisar com IA* roda o seu agente para revisar reuso, consistência e tokens (usa a sua conta).

### Barra e configurações

- **Executar:** envia as anotações pendentes juntas. **Parar:** interrompe o agente; as anotações voltam para pendentes.
- **Progresso ao vivo:** veja cada correção chegar enquanto o agente trabalha.
- **Pausar animações:** congele tooltips, toasts e dropdowns para anotá-los.
- **Ocultar marcadores:** esconde os pontos das anotações na página.
- **Limpar anotações:** apaga todas (clique duas vezes para confirmar).
- **Configurações:** estado da conexão e das anotações, a conta do Claude em uso, **Design System** (cole um `tokens.json` do W3C quando a Ilse não acha seus tokens), **Snap to grid**, **Conectar agente** (MCP), **Logs**, **Atalhos de teclado** e **Idioma** (inglês / português, detectado automaticamente).

### Atalhos de teclado

Também em Configurações → **Atalhos de teclado**, e no tooltip de cada controle que tem um. Teclas simples nunca disparam enquanto você digita num campo.

| Teclas | O que faz |
|---|---|
| `V` | Alterna entre selecionar elementos e usar a página |
| `I` `I` | Traz a barra de volta ao lugar padrão (depois de arrastá-la para fora da vista) |
| `Esc` | Fecha o que estiver por cima (nota, scan, configurações) e, por fim, a barra |
| `⌘`-clique (`Ctrl`-clique) | Seleciona o elemento exato dentro de um SVG |
| `⌘↵` (`Ctrl+Enter`) | Envia a nota |
| `Delete` (fn+⌫) | Remove o elemento selecionado, com a nota vazia |
| `⌘Z` / `⇧⌘Z` | Desfazer / refazer: um passo do rascunho ou a última mudança aplicada |
| Lápis: `↵` · `⌘Z` · `Esc` | Conclui o desenho · desfaz o último traço · descarta |

Todo prompt leva `ilse · annotation <id> · <Componente> · <arquivo>`, então correções antigas são fáceis de achar no histórico do seu agente.

## CLI

```bash
ilse-design                 # sobe seu servidor de dev por trás da Ilse, na porta de sempre, e escuta
ilse-design --separate      # nesta execução: abre num endereço separado (localhost:4700); você roda o servidor de dev
ilse-design --same-port     # nesta execução: o endereço de sempre, mesmo que o setup tenha escolhido o separado
ilse-design --port 5173     # a porta em que o seu app roda, salva para este projeto
ilse-design --target 3000   # porta do servidor de dev, se a detecção falhar
ilse-design --proxy-port 4800
ilse-design --no-open       # não abre o navegador
ilse-design --mode mcp      # modo MCP só nesta execução
ilse-design --inject        # põe <Ilse /> no seu layout em vez de usar o proxy
ilse-design --reset         # responde de novo as perguntas do setup (modo, onde a Ilse abre)
ilse-design --account       # escolhe de novo a conta do Claude deste projeto
ilse-design changes         # o que a Ilse mudou e ainda não foi commitado
ilse-design bookmarklet     # o bookmarklet que põe a barra em qualquer página local
```

Isso supõe a instalação global. Sem ela, use `npx ilse-design` no lugar de `ilse-design`. O comando também existe como `ilse`.

**Variáveis de ambiente**, principalmente para comparar execuções:

| Variável | Efeito |
|---|---|
| `ILSE_DEBUG=1` | Mostra prompts, modelos, tokens e cache por execução |
| `ILSE_MODEL=<modelo>` | Um modelo para tudo |
| `ILSE_QUICK=0` | Sem o degrau rápido |
| `ILSE_HISTORY=0` | Sem o histórico da Ilse no prompt |
| `ILSE_COMPONENT_CARD=0` | Sem a ficha do componente |
| `ILSE_RESUME=1` | Retoma a sessão do agente entre lotes |
| `ILSE_AGENT_USER_CONTEXT=1` | Deixa o agente carregar seu `CLAUDE.md` pessoal e memória |

## Logs

Barra → Configurações → **Logs** copia o journal da sessão em Markdown ou JSON (também salvo em `~/.ilse/logs/`). Para cada anotação: o caminho que ela tomou (troca sem IA, rápido, agente ou MCP, e o modelo), se foi localizada, quanto tempo você levou para escrever, uma linha do tempo (na fila → agente começou → primeira edição → resolvida), se você desfez, e para cada execução do agente os turnos, ferramentas, tokens e custo.

Ele nunca registra o texto da nota, prompts, código nem caminhos de arquivo.

## Conectar seu agente (MCP)

Para trabalhar pelo chat do agente (Claude Desktop, Claude Code, Cursor…): rode `ilse-design --mode mcp`, abra as configurações da barra → **Conectar agente**, copie o bloco do seu agente e cole nas configurações de MCP dele.

No começo de uma conversa, inicie a observação uma vez:

- **Claude Code:** `/mcp__ilse__watch`
- **Claude Desktop:** escolha **watch** nos prompts da Ilse, no menu de anexos (+)
- **Qualquer agente:** diga "Observe as anotações da Ilse."

O agente então espera, recebe, edita, responde e espera de novo. Agentes de chat não observam para sempre: depois de uma pausa longa ele pode parar — é só pedir de novo, ou usar o modo automático.

O endpoint roda em `localhost`, protegido por um token em `~/.ilse/token`. No Claude Desktop o bloco usa o `ilse-mcp`, uma pequena ponte para a Ilse em execução.

## Qual conta do Claude a Ilse usa

O Claude Code guarda um login por diretório de configuração (`CLAUDE_CONFIG_DIR`), então uma máquina pode ter uma conta pessoal e uma de trabalho lado a lado. A Ilse encontra as que estão logadas (`~/.claude`, qualquer `~/.claude-*` e diretórios definidos no perfil do seu shell) e, quando há mais de uma, pergunta qual usar neste projeto:

```
Which Claude account should Ilse use in this project?
● voce@gmail.com · Pro                     ~/.claude
○ voce@empresa.com · Team (Empresa)        ~/.claude-empresa
```

A escolha fica salva por projeto em `~/.ilse/config.json` (nunca no repositório) e aparece na linha de início e nas configurações da barra. `ilse-design --account` pergunta de novo. Para adicionar uma conta, faça login uma vez com um diretório próprio: `CLAUDE_CONFIG_DIR=~/.claude-trabalho claude`.

## Na porta do seu app: plugin Vite

Com `--separate`, o proxy dá ao seu app um segundo endereço, `localhost:4700`, e o que está preso ao original fica lá: a sessão de login salva no navegador, callbacks de OAuth, links em e-mails. Com o plugin Vite a barra vem do próprio servidor de dev, e você continua no endereço de sempre.

```bash
npm install -D ilse-design
```

```ts
// vite.config.ts
import { ilse } from "ilse-design/vite";

export default defineConfig({
  plugins: [react(), ilse()],
});
```

Rode `ilse-design` como sempre: ele vê que a barra já está na página, pula o proxy e mostra o endereço do seu servidor de dev.

- Só no `vite dev` — o build de produção nunca o inclui.
- A barra vem da Ilse em execução, então sempre bate com a versão do CLI. Enquanto a Ilse não está rodando, a página carrega um script vazio e o Vite avisa uma vez; suba a Ilse e recarregue.
- `ilse({ port: 4748 })` se a Ilse estiver em outra porta (a linha de início mostra `ws://localhost:<porta>`).
- Para ligar só quando quiser, condicione: `plugins: [react(), ...(process.env.ILSE ? [ilse()] : [])]`.

**Sem instalar o pacote** — um monorepo, ou um projeto que não deve depender da Ilse — o mesmo cabe em poucas linhas no `vite.config.ts`, apontando para a Ilse em execução (porta 4747):

```ts
import type { Plugin } from "vite";

const ilseToolbar: Plugin = {
  name: "ilse-toolbar",
  apply: "serve",
  transformIndexHtml: () => [{ tag: "script", attrs: { src: "/__ilse/toolbar.js", defer: true }, injectTo: "body" }],
};

export default defineConfig({
  plugins: [react(), ilseToolbar],
  server: { proxy: { "/__ilse": "http://127.0.0.1:4747" } },
});
```

Mantenha o script no endereço do próprio app, como acima, em vez de carregar `http://localhost:4747/__ilse/toolbar.js` direto: um service worker (MSW, PWAs) pode derrubar requisições para outra porta local.

## Qualquer página local: bookmarklet ou extensão do Chrome

Sem proxy e nada no projeto, nem dependência de dev: o próprio navegador põe a barra na página, no endereço de sempre. Qualquer framework.

**Bookmarklet.** Com o `ilse-design` rodando, abra `http://localhost:4747/__ilse/bookmarklet` e arraste o botão para a barra de favoritos (`ilse-design bookmarklet` mostra o link e o código). Na página do seu app, clique no favorito. Um recarregamento completo tira a barra; clique de novo.

**Extensão do Chrome.** Liga a barra por site e a traz de volta a cada recarregamento. Carregue uma vez: `chrome://extensions` → *Modo do desenvolvedor* → *Carregar sem compactação* → a pasta `extension/` deste repositório. Depois, na página do seu app, clique no ícone da Ilse — o selo mostra **ON**. Clique de novo para desligar.

Os dois só funcionam em páginas `localhost`. Eles buscam a barra na Ilse em execução e a rodam na página sem nenhuma requisição de rede, então um service worker (MSW, PWAs) não consegue derrubá-la. Uma página com Content-Security-Policy restrita ainda pode bloqueá-los; nesse caso use o proxy, que remove esse cabeçalho.

## Sem o proxy: `<Ilse />` no seu layout

Se o proxy atrapalhar e seu app não usa Vite — por exemplo, callbacks de login presos à porta de dev no Next.js:

```bash
npm install -D ilse-design
```

```tsx
// app/layout.tsx (Next.js) ou o componente raiz (Vite)
import { Ilse } from "ilse-design/react";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Ilse />
      </body>
    </html>
  );
}
```

Em produção ele não renderiza nada. Rode `ilse-design` como sempre e ele pula o proxy.

## Compatibilidade

| Framework | Status |
|---|---|
| Next.js 13+ (App e Pages Router) | ✓ testado no 15 e no 16 |
| Vite + React | ✓ testado no Vite 7 / React 19 |
| Create React App, Remix, Astro + React | deve funcionar, não testado de novo |

| Agente | Como a Ilse usa |
|---|---|
| Claude Code | roda `claude -p` (automático) ou via MCP |
| Codex, Cursor CLI, Gemini CLI | roda a CLI (automático), ainda não testado de ponta a ponta |
| Qualquer outro | área de transferência |
