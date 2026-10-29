<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-ilse-dark.svg">
    <img src=".github/assets/logo-ilse.svg" alt="Ilse" width="220">
  </picture>
</p>

<p align="center"><a href="README.md">English</a> · <b>Português</b></p>

**Melhore a interface do seu app no navegador, com o seu próprio agente de código.**

Você abre seu app no navegador, aponta o que está errado e diz como deveria ser — ou ajusta ali mesmo. Seu agente de IA muda o código. Você vê o resultado na página e decide se fica ou se desfaz.

> **Projeto pessoal, em beta.** Para quem dá forma à interface — designer, dev frontend, PM — trabalhando no app de verdade com um agente de código. Gratuito para usar, com o código aberto para ler.

## O que dá para fazer

- **Apontar e dizer.** Clique num elemento, selecione um trecho de texto ou desenhe uma área, e escreva o que deve mudar: *"mais espaço entre os cards"*, *"esse título mais forte"*.
- **Ajustar você mesmo.** Um painel de propriedades: tamanho, posição, layout, espaçamento, tipografia, cores, bordas, efeitos. Você vê a mudança na hora, antes de enviar.
- **Trocar as props de um componente.** Selecione um componente e o painel mostra as props e variantes dele, lidas do seu código. Escolha outra variante e a Ilse reescreve no código — sem IA.
- **Editar texto, duplicar e remover coisas.** Reescreva um texto direto no painel, duplique um elemento (uma linha de lista vira um item novo nos dados dela) ou remova.
- **Todos os tamanhos de tela.** Abra a página na largura de celular, tablet ou desktop, com réguas, e ajuste cada uma com a mesma barra.
- **Mover as coisas.** Arraste para reordenar, para dentro ou para fora de um container, redimensione.
- **Desenhar.** Rabisque na página com o lápis, ou cole um print como referência.
- **Ver seus componentes.** A Biblioteca lista os componentes que o projeto já tem: busque, veja onde cada um está na página.
- **Escrever seu design system.** *Criar design system* (ou `ilse ds`) escreve os componentes e tokens em `.ilse/ds/DESIGN.md`, a partir do código, sem IA. *Adicionar ao AGENTS.md* aponta qualquer agente pra ele, com ou sem a Ilse rodando.
- **Desfazer qualquer coisa.** ⌘Z devolve o código exatamente como estava, mesmo depois de reiniciar a Ilse. Não precisa pedir para a IA reverter.
- **Mantém a página e o CI funcionando.** Depois de cada mudança a Ilse roda o typecheck do projeto e os testes que cobrem o que mudou; o que a mudança quebrou, o agente corrige antes de dizer que terminou. Erros novos na página aparecem com *Pedir correção* e *Desfazer*.

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
- [Free × Pro](docs/free-vs-pro.md) — o que é grátis e o que vem com o Ilse Pro (modo teste, jornadas) (em inglês).
- [AGENTS.md](AGENTS.md) — para quem contribui e para os agentes dessas pessoas (em inglês).

## Por que "Ilse"

A IA tirou boa parte do trabalho de escrever código de interface, mas o ofício ainda precisa de julgamento humano. A Ilse põe esse julgamento ao lado do agente: você aponta o que está errado, o agente corrige, você aprova.

> "Design é uma ferramenta para melhorar a humanidade." — Ilse Crawford

## Contribuir

Issues e pull requests são bem-vindos — veja [CONTRIBUTING.md](CONTRIBUTING.md). Problemas de segurança vão em privado: [SECURITY.md](SECURITY.md).

[PolyForm Shield 1.0.0](LICENSE): livre para usar, alterar e compartilhar — só não para criar um produto que concorra com a Ilse. Até a 0.5.1 a licença era MIT; veja [NOTICE](NOTICE).
