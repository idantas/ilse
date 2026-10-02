# Referência

[English](reference.md) · **Português** · [← README](../README.pt-BR.md)

## Instalar

Rode sem instalar:

```bash
npx github:idantas/ilse
```

A Ilse ainda não está no npm, então isso instala direto do GitHub e faz o build na primeira vez. Para deixar o comando disponível, instale uma vez — em dois passos, porque o npm não consegue fazer o build de um pacote numa instalação global direto do git:

```bash
npm pack git+https://github.com/idantas/ilse.git   # gera o pacote a partir do GitHub
npm install -g ./ilse-design-*.tgz                  # instala como `ilse` / `ilse-design`
```

## Modos

Na primeira vez, a Ilse pergunta como entregar as anotações ao seu agente:

- **Automático** (recomendado): a Ilse chama o seu agente. Nada para colar.
- **Pelo chat do agente (MCP)**: o seu agente puxa as anotações — veja [Conectar seu agente](#conectar-seu-agente-mcp).
- **Área de transferência**: a Ilse copia cada anotação e você cola onde quiser.

## A barra

### Apontar e ajustar

- **3 jeitos de apontar:** clicar num elemento, selecionar texto ou desenhar uma área.
- **Selecionar o pai:** o botão ↰ no card da nota sobe a seleção para o elemento que contém o atual (wrappers de biblioteca do mesmo tamanho são pulados). Um clique dentro de um SVG seleciona o `<svg>` inteiro.
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
- **Configurações:** estado da conexão e das anotações, a conta do Claude em uso, **Design System** (cole um `tokens.json` do W3C quando a Ilse não acha seus tokens), **Snap to grid**, **Idioma** (inglês / português, detectado automaticamente), **Conectar agente** (MCP) e **Logs**.

Todo prompt leva `ilse · annotation <id> · <Componente> · <arquivo>`, então correções antigas são fáceis de achar no histórico do seu agente.

## CLI

```bash
ilse-design                 # acha o servidor de dev, abre o proxy, escuta
ilse-design --target 3000   # porta do servidor de dev, se a detecção falhar
ilse-design --proxy-port 4800
ilse-design --no-open       # não abre o navegador
ilse-design --mode mcp      # modo MCP só nesta execução
ilse-design --inject        # põe <Ilse /> no seu layout em vez de usar o proxy
ilse-design --reset         # escolhe o modo de novo
ilse-design --account       # escolhe de novo a conta do Claude deste projeto
ilse-design changes         # o que a Ilse mudou e ainda não foi commitado
```

Isso supõe a instalação global. Sem ela, use `npx github:idantas/ilse` no lugar de `ilse-design`. O comando também existe como `ilse`.

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

## Sem o proxy: `<Ilse />` no seu layout

Se o proxy atrapalhar — por exemplo, callbacks de login presos à porta de dev:

```bash
npm install -D github:idantas/ilse
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
