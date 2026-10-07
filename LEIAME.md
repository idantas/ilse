<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-ilse-dark.svg">
    <img src=".github/assets/logo-ilse.svg" alt="Ilse" width="220">
  </picture>
</p>

<p align="center"><a href="README.md">English</a> · <b>Português</b></p>

**O olho do designer dentro do agente de código.**

Você abre seu app no navegador, aponta o que está errado e diz como deveria ser — ou ajusta ali mesmo, como no Figma. Seu agente de IA muda o código. Você vê o resultado na página e decide se fica ou se desfaz.

> **Projeto pessoal, em beta.** Feito por um designer, para designers que trabalham com agentes de código. Gratuito e open source.

## O que dá para fazer

- **Apontar e dizer.** Clique num elemento, selecione um trecho de texto ou desenhe uma área, e escreva o que deve mudar: *"mais espaço entre os cards"*, *"esse título mais forte"*.
- **Ajustar você mesmo.** Um painel de propriedades como o do Figma: tamanho, layout, espaçamento, tipografia, cores, bordas. Você vê a mudança na hora, antes de enviar.
- **Editar texto e remover coisas.** Reescreva um texto direto no painel, ou remova um elemento.
- **Mover as coisas.** Arraste para reordenar, para dentro ou para fora de um container, redimensione.
- **Desenhar.** Rabisque na página com o lápis, ou cole um print como referência.
- **Desfazer qualquer coisa.** ⌘Z devolve o código exatamente como estava. Não precisa pedir para a IA reverter.

## O que você precisa

- Um projeto **React** rodando no seu computador (Next.js, Vite…).
- Um **agente de código com IA** instalado e logado: [Claude Code](https://claude.com/claude-code), Codex, Cursor CLI ou Gemini CLI.

A Ilse usa o *seu* agente e a *sua* conta. Ela não tem conta, chave nem servidor próprio, e nada sai da sua máquina.

## Experimente

Na pasta do seu projeto — sem precisar subir o app antes — rode:

```bash
npx ilse-design@latest
```

A Ilse está no npm como [`ilse-design`](https://www.npmjs.com/package/ilse-design) e precisa do Node.js 18 ou mais novo. O `@latest` garante a versão mais nova, mesmo que uma mais antiga esteja instalada na sua máquina.

A Ilse sobe o seu servidor de dev (`npm run dev`) por trás e abre o app no endereço de sempre — `http://localhost:3000`, ou a porta que ele usa — com a barra por cima. Login, SSO e callbacks continuam funcionando. Na primeira vez ela faz algumas perguntas e leva cerca de um minuto. Nas próximas, é só `ilse` se você a [instalou](docs/reference.pt-BR.md#instalar).

Prefere rodar o servidor de dev você mesmo? `--separate` abre a Ilse num endereço próprio, `localhost:4700`. Outros jeitos: o [plugin Vite](docs/reference.pt-BR.md#na-porta-do-seu-app-plugin-vite), o [bookmarklet ou a extensão do Chrome (experimental)](docs/reference.pt-BR.md#qualquer-página-local-bookmarklet-ou-extensão-do-chrome).

Não se sente à vontade com o terminal? Peça ao seu agente: *"Instale e rode a Ilse neste projeto — veja https://github.com/idantas/ilse"*.

## Quanto custa

A Ilse roda no plano do seu agente, então usa os limites dele. Ela sempre escolhe o caminho mais barato que resolve:

- **Ajustes do painel** que viram uma classe no seu código são feitos pela própria Ilse — sem IA, na hora, sem gastar nada do seu plano.
- **Pedidos pequenos** vão para um modelo rápido e mais barato: alguns segundos.
- **Os maiores** (telas novas, estrutura) vão para o agente completo — o degrau mais caro, por isso só quando precisa.

## Para ir mais fundo

- [Como funciona](docs/how-it-works.pt-BR.md) — como a Ilse acha o código, a escada de custo, modelos, verificações de segurança, limites de uso, desfazer e commits.
- [Referência](docs/reference.pt-BR.md) — comandos, configurações, conectar seu agente por MCP, logs, compatibilidade.
- [AGENTS.md](AGENTS.md) — para quem contribui e para os agentes dessas pessoas (em inglês).

## Por que "Ilse"

A IA livrou os designers do gargalo da execução, mas o ofício ainda precisa de julgamento humano. A Ilse é o olho do designer dentro do agente: você aponta o que está errado, o agente corrige, você aprova.

> "Design é uma ferramenta para melhorar a humanidade." — Ilse Crawford

## Contribuir

Issues e pull requests são bem-vindos — veja [CONTRIBUTING.md](CONTRIBUTING.md). Problemas de segurança vão em privado: [SECURITY.md](SECURITY.md).

Licença MIT — veja [LICENSE](LICENSE).
