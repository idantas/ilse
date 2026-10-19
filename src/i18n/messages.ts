/**
 * i18n message dictionary — pt-BR and en.
 * No external deps. Keys are semantic (area.context).
 * Agent prompts stay in EN always (executor.ts) — this covers user-facing text only.
 */

export type Locale = 'pt' | 'en';

const messages = {
  // ── Toolbar (react) ──────────────────────────────────────────────────────
  'toolbar.placeholder.issue': {
    pt: 'O que está errado?',
    en: 'What\'s wrong?',
  },
  'toolbar.placeholder.describe': {
    pt: 'O que você quer mudar?',
    en: 'What do you want to change?',
  },
  'toolbar.placeholder.chat': {
    pt: 'Peça qualquer coisa...',
    en: 'Ask anything...',
  },
  'toolbar.drag': {
    pt: 'Arraste para reposicionar',
    en: 'Drag to reposition',
  },
  'toolbar.close': {
    pt: 'Fechar',
    en: 'Close',
  },
  'toolbar.closeReport': {
    pt: 'Fechar relatório',
    en: 'Close report',
  },
  'toolbar.rescan': {
    pt: 'Re-escanear página',
    en: 'Re-scan page for design issues',
  },
  'toolbar.openReport': {
    pt: 'Abrir relatório completo',
    en: 'Open full report',
  },
  'toolbar.chat': {
    pt: 'Chat',
    en: 'Chat',
  },
  'toolbar.testRun': {
    pt: 'Testar o app',
    en: 'Test the app',
  },
  'toolbar.testRunning': {
    pt: 'Testando…',
    en: 'Testing…',
  },
  'toolbar.testHint': {
    pt: 'Um agente abre o seu app num navegador à parte, passa pelas páginas no computador e no celular e lista o que encontrou: acessibilidade, erros, links quebrados, layout, e o que atrapalha agentes de IA. Nada sai da sua máquina.',
    en: 'An agent opens your app in a separate browser, goes through its pages on desktop and mobile, and lists what it found: accessibility, errors, broken links, layout, and what gets in the way of AI agents. Nothing leaves your machine.',
  },
  'toolbar.testIgnore': {
    pt: 'Ignorar teste',
    en: 'Ignore test',
  },
  'toolbar.runFixes': {
    pt: 'Executar correções',
    en: 'Run fixes',
  },
  'toolbar.testFoundHere': {
    pt: '{count} achados nesta página: já estão nos marcadores',
    en: '{count} findings on this page: they are on the markers',
  },
  'toolbar.testFindingsList': {
    pt: 'Achados nesta página',
    en: 'Findings on this page',
  },
  'toolbar.testRunAgain': {
    pt: 'Testar de novo',
    en: 'Test again',
  },
  'toolbar.testNoneHere': {
    pt: 'Nada nesta página.',
    en: 'Nothing on this page.',
  },
  'toolbar.testElsewhere': {
    pt: 'Mais {count} em outras páginas — abra a página para ver.',
    en: '{count} more on other pages — open the page to see them.',
  },
  'toolbar.testStepChecking': {
    pt: 'Abrindo o app…',
    en: 'Opening the app…',
  },
  'toolbar.testStepStart': {
    pt: 'Começando o teste…',
    en: 'Starting the test…',
  },
  'toolbar.testStepPage': {
    pt: 'Abrindo {page}',
    en: 'Opening {page}',
  },
  'toolbar.testOnMobile': {
    pt: '{page} no celular',
    en: '{page} on mobile',
  },
  'toolbar.testStepClean': {
    pt: '{page}: tudo certo',
    en: '{page}: all good',
  },
  'toolbar.testStepFound': {
    pt: '{page}: {count} achados — {kinds}',
    en: '{page}: {count} findings — {kinds}',
  },
  'toolbar.cat.accessibility': { pt: 'acessibilidade', en: 'accessibility' },
  'toolbar.cat.agent': { pt: 'uso por agentes', en: 'use by agents' },
  'toolbar.cat.console': { pt: 'erros', en: 'errors' },
  'toolbar.cat.network': { pt: 'requisições', en: 'requests' },
  'toolbar.cat.link': { pt: 'links', en: 'links' },
  'toolbar.cat.layout': { pt: 'layout', en: 'layout' },
  'toolbar.testStepMobile': {
    pt: 'Testando {page} no celular',
    en: 'Testing {page} on mobile',
  },
  'toolbar.testChecking': {
    pt: 'Abrindo o app para ver se ele pede login…',
    en: 'Opening the app to see if it asks for a login…',
  },
  'toolbar.testLoginAsk': {
    pt: 'Esse app abre numa tela de login. Quer entrar antes, para o teste ver as páginas de dentro?',
    en: 'This app opens on a login screen. Log in first, so the test sees the pages inside?',
  },
  'toolbar.testLoginExpired': {
    pt: 'A sessão salva para o teste expirou. Entrar de novo?',
    en: 'The session saved for testing has expired. Log in again?',
  },
  'test.retest': {
    pt: 'Teste de novo depois da correção: {fixed} resolvido(s), {still} ainda aparece(m)',
    en: 'Tested again after the fix: {fixed} fixed, {still} still there',
  },
  'toolbar.testRetesting': {
    pt: 'Conferindo se a correção resolveu…',
    en: 'Checking whether the fix worked…',
  },
  'toolbar.testRetestFixed': {
    pt: 'Conferi: {count} resolvido(s) ✓',
    en: 'Checked: {count} fixed ✓',
  },
  'toolbar.testRetestStill': {
    pt: 'Conferi: {count} ainda aparece(m) no teste',
    en: 'Checked: {count} still show up in the test',
  },
  'toolbar.testCameBack': {
    pt: 'voltou',
    en: 'came back',
  },
  'toolbar.testLoginYes': {
    pt: 'Entrar e testar',
    en: 'Log in and test',
  },
  'toolbar.testLoginNo': {
    pt: 'Testar sem login',
    en: 'Test without login',
  },
  'toolbar.testLoginOpen': {
    pt: 'Abri uma janela do Chrome com o app. Faça login lá e volte aqui. A sessão fica só na sua máquina.',
    en: 'A Chrome window with the app is open. Log in there and come back. The session stays on your machine.',
  },
  'toolbar.testLoginDone': {
    pt: 'Pronto, testar',
    en: 'Done, test',
  },
  'toolbar.testLoginCancel': {
    pt: 'Cancelar',
    en: 'Cancel',
  },
  'toolbar.testDone': {
    pt: 'Teste pronto: {count} achados em {pages} páginas',
    en: 'Test done: {count} findings on {pages} pages',
  },
  'toolbar.testNoBrowser': {
    pt: 'Não achei um navegador para o teste. Instale o Google Chrome.',
    en: "Couldn't find a browser for the test. Install Google Chrome.",
  },
  'toolbar.testFailed': {
    pt: 'O teste parou no meio. Veja o terminal do ilse.',
    en: 'The test stopped. See the ilse terminal.',
  },
  'toolbar.testFindings': {
    pt: 'Do ilse test ({count})',
    en: 'From ilse test ({count})',
  },
  'toolbar.testDiscard': {
    pt: 'Ignorar — a Ilse não avisa mais',
    en: 'Ignore — Ilse stops warning about it',
  },
  'memory.title': { pt: 'Memória do projeto', en: 'Project memory' },
  'memory.open': { pt: 'Memória do projeto', en: 'Project memory' },
  'memory.intro': { pt: 'O que a Ilse lembra deste projeto — e o que o agente lê daqui. Nada fica guardado sem aparecer aqui.', en: 'What Ilse remembers of this project — and what the agent reads from it. Nothing is kept out of sight.' },
  'memory.loading': { pt: 'Carregando…', en: 'Loading…' },
  'memory.design': { pt: 'Mudanças de design', en: 'Design changes' },
  'memory.designEmpty': { pt: 'Nenhuma mudança ainda. Cada ajuste que a Ilse aplicar aparece aqui.', en: 'No changes yet. Every change Ilse applies shows up here.' },
  'memory.designCount': { pt: '{count} mudanças feitas pela Ilse', en: '{count} changes made by Ilse' },
  'memory.designPending': { pt: '{count} ainda sem commit', en: '{count} not committed yet' },
  'memory.noNote': { pt: '(sem nota)', en: '(no note)' },
  'memory.designAgent': { pt: 'Quando o agente mexe num desses arquivos, ele recebe as últimas mudanças feitas ali e o motivo de cada uma.', en: 'When the agent works on one of these files, it gets the latest changes made there and why.' },
  'memory.test': { pt: 'Modo teste', en: 'Test mode' },
  'memory.testLocked': { pt: 'Com o Ilse Pro, aqui aparece o que o modo teste lembra: o que foi corrigido, o que voltou e o que você pediu para ignorar. Veja em ilse.design/#pro', en: 'With Ilse Pro, this shows what test mode remembers: what was fixed, what came back and what you asked to ignore. See ilse.design/#pro' },
  'memory.testUpdatePro': { pt: 'Atualize o Ilse Pro para ver a memória do modo teste aqui.', en: 'Update Ilse Pro to see test mode\'s memory here.' },
  'memory.testEmpty': { pt: 'Nenhum teste ainda. Rode o modo teste e a memória começa aqui.', en: 'No tests yet. Run test mode and the memory starts here.' },
  'memory.testRuns': { pt: '{count} testes · último {when}', en: '{count} tests · last {when}' },
  'memory.testOpen': { pt: '{count} ainda lá', en: '{count} still there' },
  'memory.testFixed': { pt: '{count} corrigidos', en: '{count} fixed' },
  'memory.testReturned': { pt: '{count} voltaram depois de corrigidos', en: '{count} came back after a fix' },
  'memory.openPage': { pt: 'Abrir a página', en: 'Open the page' },
  'memory.ignored': { pt: 'Você pediu para ignorar ({count})', en: 'You asked to ignore ({count})' },
  'memory.ignoredHint': { pt: 'A Ilse não avisa mais sobre estes.', en: 'Ilse no longer warns about these.' },
  'memory.unignore': { pt: 'Voltar a avisar', en: 'Warn me again' },
  'memory.accuracy': { pt: 'Onde as checagens acertam', en: 'Where the checks are right' },
  'memory.accuracyDetail': { pt: 'Você aprovou {approved} de {total}', en: 'You approved {approved} of {total}' },
  'memory.testAgent': { pt: 'O modo teste usa esta memória: não mostra de novo o que você ignorou e marca o que voltou depois de corrigido.', en: 'Test mode uses this memory: it never shows again what you ignored, and marks what came back after a fix.' },
  'memory.forget': { pt: 'Esquecer a memória do teste', en: 'Forget test mode\'s memory' },
  'memory.forgetAsk': { pt: 'Apagar tudo o que o modo teste lembra?', en: 'Erase everything test mode remembers?' },
  'memory.forgetYes': { pt: 'Apagar', en: 'Erase' },
  'memory.forgetNo': { pt: 'Cancelar', en: 'Cancel' },
  'memory.justNow': { pt: 'agora', en: 'just now' },
  'memory.minutesAgo': { pt: 'há {count} min', en: '{count} min ago' },
  'memory.hoursAgo': { pt: 'há {count} h', en: '{count} h ago' },
  'memory.yesterday': { pt: 'ontem', en: 'yesterday' },
  'memory.daysAgo': { pt: 'há {count} dias', en: '{count} days ago' },
  'memory.category.accessibility': { pt: 'Acessibilidade', en: 'Accessibility' },
  'memory.category.agent': { pt: 'Usável por agentes de IA', en: 'Usable by AI agents' },
  'memory.category.console': { pt: 'Erros no console', en: 'Console errors' },
  'memory.category.network': { pt: 'Requisições que falharam', en: 'Failed requests' },
  'memory.category.link': { pt: 'Links quebrados', en: 'Broken links' },
  'memory.category.layout': { pt: 'Layout', en: 'Layout' },
  'toolbar.scanThisView': {
    pt: 'Nesta tela agora',
    en: 'On screen now',
  },
  'toolbar.mode': {
    pt: 'Modo da toolbar',
    en: 'Toolbar mode',
  },
  'toolbar.modeDesign': {
    pt: 'Design',
    en: 'Design',
  },
  'toolbar.modeTest': {
    pt: 'Teste',
    en: 'Test',
  },
  'toolbar.modeDesignHint': {
    pt: 'Modo design: anote, desenhe e edite no app',
    en: 'Design mode: annotate, draw and edit on the app',
  },
  'toolbar.modeTestHint': {
    pt: 'Modo teste: um agente testa o app e lista o que achou',
    en: 'Test mode: an agent tests the app and lists what it found',
  },
  'toolbar.scan': {
    pt: 'Agent tester',
    en: 'Agent tester',
  },
  'toolbar.settings': {
    pt: 'Configurações',
    en: 'Settings',
  },
  'toolbar.run': {
    pt: 'Executar',
    en: 'Run',
  },
  'toolbar.running': {
    pt: 'Executando...',
    en: 'Running...',
  },
  'toolbar.stop': {
    pt: 'Parar',
    en: 'Stop',
  },
  'toolbar.selectMode': {
    pt: 'Modo seleção (clicar na página)',
    en: 'Selection mode (click on page)',
  },
  'toolbar.pencil': {
    pt: 'Lápis (desenhar na tela)',
    en: 'Pencil (draw on the page)',
  },
  'toolbar.sketch.label': {
    pt: 'desenho',
    en: 'sketch',
  },
  'toolbar.sketch.empty': {
    pt: '[desenho numa área vazia]',
    en: '[sketch over empty space]',
  },
  'toolbar.sketch.inside': {
    pt: 'dentro de {label}',
    en: 'inside {label}',
  },
  'toolbar.annotateMode': {
    pt: 'Modo anotação (clicar pra marcar)',
    en: 'Annotation mode (click to mark)',
  },
  'toolbar.pauseAnimations': {
    pt: 'Pausar animações',
    en: 'Pause animations',
  },
  'toolbar.resumeAnimations': {
    pt: 'Retomar animações',
    en: 'Resume animations',
  },
  'toolbar.hideMarkers': {
    pt: 'Ocultar marcadores',
    en: 'Hide markers',
  },
  'toolbar.showMarkers': {
    pt: 'Mostrar marcadores',
    en: 'Show markers',
  },
  'toolbar.clearConfirm': {
    pt: 'Clique novamente para confirmar',
    en: 'Click again to confirm',
  },
  'toolbar.clearAnnotations': {
    pt: 'Limpar anotações',
    en: 'Clear annotations',
  },
  'toolbar.clipboard.copied': {
    pt: 'Copiado! Cole no seu agente (Cmd+V)',
    en: 'Copied! Paste in your agent (Cmd+V)',
  },
  'toolbar.clipboard.error': {
    pt: 'Não foi possível copiar.',
    en: 'Could not copy.',
  },
  'toolbar.clipboard.noTokens': {
    pt: 'Nenhum token válido encontrado no JSON',
    en: 'No valid tokens found in JSON',
  },
  'toolbar.clipboard.invalidJson': {
    pt: 'JSON inválido',
    en: 'Invalid JSON',
  },
  'toolbar.area.empty': {
    pt: 'Área vazia — criar conteúdo',
    en: 'Empty area — create content',
  },
  'toolbar.area.elements': {
    pt: 'Área: {count} elementos',
    en: 'Area: {count} elements',
  },
  'toolbar.generatedBy': {
    pt: 'Gerado por Ilse — cole no seu agente de código para corrigir.',
    en: 'Generated by Ilse — paste in your code agent to fix.',
  },
  'toolbar.resolved': {
    pt: 'Corrigido',
    en: 'Fixed',
  },

  // ── CLI: default.ts ──────────────────────────────────────────────────────
  'cli.noAgent': {
    pt: 'Nenhum agente CLI encontrado (claude, codex, cursor-agent, gemini)',
    en: 'No CLI agent found (claude, codex, cursor-agent, gemini)',
  },
  'cli.clipboardFallback': {
    pt: 'Vou usar modo clipboard — você cola no seu agente quando quiser.',
    en: 'Using clipboard mode — paste in your agent when ready.',
  },
  'cli.modeQuestion': {
    pt: 'Como você quer usar a Ilse?',
    en: 'How do you want to use Ilse?',
  },
  'cli.modeAutomatic': {
    pt: 'Automático (recomendado)',
    en: 'Automatic (recommended)',
  },
  'cli.modeAutomaticHint': {
    pt: 'a Ilse chama {agent} pra aplicar as correções',
    en: 'Ilse calls {agent} to apply fixes',
  },
  'cli.modeCopyPaste': {
    pt: 'Copy/paste',
    en: 'Copy/paste',
  },
  'cli.modeCopyPasteHint': {
    pt: 'copia o contexto pro clipboard, você cola no agente',
    en: 'copies context to clipboard, you paste in the agent',
  },
  'cli.cancelled': {
    pt: 'Cancelado.',
    en: 'Cancelled.',
  },
  'cli.newProject': {
    pt: 'ilse · novo projeto',
    en: 'ilse · new project',
  },
  'cli.detected': {
    pt: 'Detectei {framework} neste projeto',
    en: 'Detected {framework} in this project',
  },
  'cli.injectQuestion': {
    pt: 'Posso adicionar {component} no seu layout?',
    en: 'Can I add {component} to your layout?',
  },
  'cli.injected': {
    pt: 'Adicionado em {path}',
    en: 'Added to {path}',
  },
  'cli.injectError': {
    pt: 'Erro ao injetar',
    en: 'Failed to inject',
  },
  'cli.addManually': {
    pt: 'Adicione manualmente:',
    en: 'Add manually:',
  },
  'cli.addManuallyLater': {
    pt: 'Ok. Adicione manualmente quando quiser:',
    en: 'Ok. Add manually when ready:',
  },
  'cli.alreadyInstalled': {
    pt: '<Ilse /> já está no layout',
    en: '<Ilse /> is already in the layout',
  },
  'cli.legacyFailed': {
    pt: 'Não consegui remover sozinha sem arriscar o arquivo. Tire o import e o <Ilse /> de {path} à mão — por agora a barra antiga continua.',
    en: "Couldn't remove it safely on my own. Take the import and <Ilse /> out of {path} by hand — the old toolbar keeps working for now.",
  },
  'cli.unknownFramework': {
    pt: 'Framework não detectado. Adicione manualmente:',
    en: 'Framework not detected. Add manually:',
  },
  'cli.ready': {
    pt: 'Pronto. Reinicie o dev server.',
    en: 'Done. Restart your dev server.',
  },
  'cli.listening': {
    pt: 'Estou aqui e ouvindo.',
    en: 'Listening.',
  },
  'cli.annotateHint': {
    pt: 'Pode anotar no browser e mandar.',
    en: 'Annotate in the browser and send.',
  },
  'cli.modeAutoLabel': {
    pt: 'automático',
    en: 'automatic',
  },
  'cli.modeClipboardLabel': {
    pt: 'clipboard',
    en: 'clipboard',
  },
  'cli.commitContextQuestion': {
    pt: 'Avisar o agente do projeto (no {file}) que as mudanças da Ilse devem entrar nos commits?',
    en: "Tell the project's agent (in {file}) that Ilse's changes belong in commits?",
  },
  'cli.commitContextAdded': {
    pt: 'Instrução de commit adicionada em {path}',
    en: 'Commit instruction added to {path}',
  },
  'cli.noPendingChanges': {
    pt: 'Nenhuma mudança da Ilse pendente de commit.',
    en: 'No Ilse changes waiting for a commit.',
  },
  'cli.quick': {
    pt: 'rápido, sem agente',
    en: 'quick, no agent',
  },
  'cli.agentLimit': {
    pt: 'A conta {account} atingiu o limite de uso — renova às {time}. As anotações ficam na fila e eu retomo sozinha.',
    en: 'The account {account} hit its usage limit — it resets at {time}. Annotations stay queued and resume on their own.',
  },
  'cli.agentLimitDeferred': {
    pt: '{count} anotação(ões) na fila até o limite renovar',
    en: '{count} annotation(s) queued until the limit resets',
  },
  'cli.accountQuestion': { pt: 'Qual conta do Claude a Ilse deve usar neste projeto?', en: 'Which Claude account should Ilse use in this project?' },
  'cli.accountHint': { pt: 'Trocar de conta: ilse --account', en: 'Switch account: ilse --account' },
  'cli.agentResume': { pt: 'Limite renovado — retomando {count} anotação(ões)', en: 'Limit reset — resuming {count} annotation(s)' },
  'cli.escalate': {
    pt: 'Nenhum arquivo mudou com {from} — tentando de novo com {to}',
    en: 'No file changed with {from} — retrying with {to}',
  },
  'cli.invoking': {
    pt: 'Invocando {agent} com {count} anotações...',
    en: 'Invoking {agent} with {count} annotations...',
  },
  'cli.sessionResumed': {
    pt: 'session resumida',
    en: 'session resumed',
  },
  'cli.done': {
    pt: 'concluído ({seconds}s)',
    en: 'done ({seconds}s)',
  },
  'cli.offPage': {
    pt: 'O agente mudou {files}, que não aparece na página da anotação',
    en: 'The agent changed {files}, which is not on the annotated page',
  },
  'cli.offPageRoutes': {
    pt: 'usado em {routes}',
    en: 'used on {routes}',
  },
  'toolbar.offPage.text': {
    pt: 'Mudei {files}, mas não aparece nesta página.',
    en: "I changed {files}, but it isn't on this page.",
  },
  'toolbar.offPage.usedIn': {
    pt: 'Fica em {routes}.',
    en: "It's on {routes}.",
  },
  'toolbar.offPage.redoHere': {
    pt: 'Refazer nesta página',
    en: 'Redo on this page',
  },
  'toolbar.offPage.undo': {
    pt: 'Desfazer',
    en: 'Undo',
  },
  'toolbar.offPage.keep': {
    pt: 'Manter',
    en: 'Keep',
  },
  'toolbar.checkFailed.text': {
    pt: 'A mudança quebra checagens do projeto ({count}) e não consegui corrigir: {first}',
    en: 'The change breaks project checks ({count}) and I couldn\'t fix it: {first}',
  },
  'toolbar.checkFailed.keep': {
    pt: 'Manter mesmo assim',
    en: 'Keep anyway',
  },
  'cli.batchError': {
    pt: 'Erro no batch',
    en: 'Batch error',
  },
  'cli.noPort': {
    pt: 'Nenhuma porta disponível (4747-4757). Muitos ilses rodando?',
    en: 'No port available (4747-4757). Too many ilse instances?',
  },
  'cli.stopping': {
    pt: 'Parando agente...',
    en: 'Stopping agent...',
  },
  'cli.stopped': {
    pt: 'Parado pelo usuário.',
    en: 'Stopped by user.',
  },
  'cli.ctrlcAgain': {
    pt: 'Ctrl+C novamente pra sair.',
    en: 'Ctrl+C again to exit.',
  },
  'cli.bye': {
    pt: 'tchau',
    en: 'bye',
  },
  'cli.resetDone': {
    pt: 'Setup resetado. Rodando de novo...',
    en: 'Setup reset. Running again...',
  },
  'cli.farewell1': {
    pt: 'Terminamos. O que achou? Tem mais ajustes?',
    en: 'Done. How does it look? Any more tweaks?',
  },
  'cli.farewell2': {
    pt: 'Pronto. Dá uma olhada — quer refinar mais alguma coisa?',
    en: 'Done. Take a look — want to refine anything?',
  },
  'cli.farewell3': {
    pt: 'Feito. Confere aí, fico no aguardo.',
    en: 'Done. Check it out, I\'ll be here.',
  },
  'cli.thinkingError': {
    pt: 'Algo travou aqui. Dá uma olhada no terminal?',
    en: 'Something got stuck. Check the terminal?',
  },
  'cli.frameworkUnknown': {
    pt: 'desconhecido',
    en: 'unknown',
  },

  // ── CLI: listen.ts ───────────────────────────────────────────────────────
  'listen.batch': {
    pt: 'batch: {count} anotações enviadas',
    en: 'batch: {count} annotations sent',
  },
  'listen.waiting': {
    pt: 'aguardando anotações...',
    en: 'waiting for annotations...',
  },
  'listen.totalAnnotations': {
    pt: '{total} anotações',
    en: '{total} annotations',
  },
  'listen.noneFound': {
    pt: 'nenhuma anotação encontrada',
    en: 'no annotations found',
  },
  'listen.resolved': {
    pt: 'resolvida',
    en: 'resolved',
  },
  'listen.notFound': {
    pt: 'Anotação {id} não encontrada',
    en: 'Annotation {id} not found',
  },

  // ── CLI: index.ts (commander descriptions) ───────────────────────────────
  'cmd.reset': {
    pt: 'Resetar setup e rodar de novo',
    en: 'Reset setup and run again',
  },
  'cmd.setup': {
    pt: 'Instalar a Ilse (MCP) nos agentes que você escolher — o mesmo que mcp install',
    en: 'Install Ilse (MCP) in the agents you pick — same as mcp install',
  },
  'cmd.mcp': { pt: 'Ilse no MCP dos seus agentes', en: "Ilse in your agents' MCP" },
  'cmd.mcpInstall': {
    pt: 'Instalar nos agentes (sem nome: pergunta quais). claude-code, claude-desktop, cursor, codex, gemini',
    en: 'Install in agents (none named: asks which). claude-code, claude-desktop, cursor, codex, gemini',
  },
  'cmd.mcpUninstall': { pt: 'Remover dos agentes', en: 'Remove from agents' },
  'cmd.mcpPrint': { pt: 'Só mostrar o que mudaria', en: 'Only show what would change' },
  'cmd.listen': {
    pt: 'Iniciar servidor de anotações visuais (modo manual, sem auto-execute)',
    en: 'Start visual annotation server (manual mode, no auto-execute)',
  },
  'cmd.account': { pt: 'Escolher de novo qual conta do Claude usar', en: 'Choose again which Claude account to use' },
  'cmd.changes': {
    pt: 'Mudanças da Ilse ainda sem commit (para escrever o commit)',
    en: 'Ilse changes not committed yet (to write the commit)',
  },
  'cmd.annotations': {
    pt: 'Listar anotações visuais',
    en: 'List visual annotations',
  },
  'cmd.resolve': {
    pt: 'Resolver uma anotação',
    en: 'Resolve an annotation',
  },

  // ── CLI: mcp install ─────────────────────────────────────────────────────
  'mcp.none': {
    pt: 'Nenhum agente encontrado. Diga qual: ilse mcp install <agente> ({agents})',
    en: 'No agent found. Name one: ilse mcp install <agent> ({agents})',
  },
  'mcp.pickInstall': { pt: 'Em quais agentes instalar a Ilse? (espaço marca, enter confirma)', en: 'Which agents should get Ilse? (space to pick, enter to confirm)' },
  'mcp.pickUninstall': { pt: 'De quais agentes remover a Ilse?', en: 'Which agents should Ilse be removed from?' },
  'mcp.nothing': { pt: 'Nada mudou.', en: 'Nothing changed.' },
  'mcp.name': { pt: 'Diga em quais: ilse mcp install <agente> — encontrados: {agents}', en: 'Name them: ilse mcp install <agent> — found: {agents}' },
  'mcp.unknown': { pt: 'Agente desconhecido: {agent}. Use: {agents}', en: 'Unknown agent: {agent}. Use: {agents}' },
  'mcp.installed': { pt: 'Ilse instalada em {agent}', en: 'Ilse installed in {agent}' },
  'mcp.removed': { pt: 'Ilse removida de {agent}', en: 'Ilse removed from {agent}' },
  'mcp.failed': { pt: 'Não consegui em {agent}: {error}', en: "Couldn't in {agent}: {error}" },
  'mcp.wouldWrite': { pt: '{agent} — {where}', en: '{agent} — {where}' },
  'mcp.after': {
    pt: 'Abra uma conversa nova no agente. Com a Ilse rodando no projeto, peça "watch the Ilse annotations" — e antes de commitar ele chama ilse_changes sozinho.',
    en: 'Open a new conversation in the agent. With Ilse running in the project, ask it to "watch the Ilse annotations" — and before a commit it calls ilse_changes on its own.',
  },

  // ── Suggestions (toolbar) ─────────────────────────────────────────────────
  'suggestions.see': {
    pt: 'Ver sugestões',
    en: 'See suggestions',
  },
  'suggestions.fixAll': {
    pt: 'Corrigir todas as sugestões',
    en: 'Fix all suggestions',
  },
  'suggestions.none': {
    pt: 'Nenhum problema encontrado na análise local.',
    en: 'No issues found by the local check.',
  },
  'suggestions.askAI': {
    pt: 'Analisar com IA',
    en: 'Review with AI',
  },
  'suggestions.askAIHint': {
    pt: 'Roda o seu agente para revisar reuso, consistência e tokens — usa tokens da sua conta',
    en: 'Runs your agent to review reuse, consistency and tokens — uses your account\'s tokens',
  },
  'suggestions.askingAI': {
    pt: 'perguntando à IA...',
    en: 'asking AI...',
  },
  'suggestions.analyzing': {
    pt: 'analisando...',
    en: 'analyzing...',
  },

  // ── Settings panel (toolbar) ──────────────────────────────────────────────
  'settings.wsConnected': {
    pt: 'WS conectado',
    en: 'WS connected',
  },
  'settings.offline': {
    pt: 'offline',
    en: 'offline',
  },
  'settings.noAnnotations': {
    pt: 'Nenhuma anotação',
    en: 'No annotations',
  },
  'settings.pending': {
    pt: 'pendente',
    en: 'pending',
  },
  'settings.sent': {
    pt: 'enviado',
    en: 'sent',
  },
  'settings.resolved': {
    pt: 'resolvido',
    en: 'resolved',
  },
  'settings.designSystem': {
    pt: 'Design System',
    en: 'Design System',
  },
  'settings.loadTokens': {
    pt: 'Carregar tokens',
    en: 'Load tokens',
  },
  'settings.removeTokens': {
    pt: 'Remover tokens',
    en: 'Remove tokens',
  },
  'settings.planProHint': { pt: 'Ilse Pro ativo nesta máquina: modo teste e memória do teste', en: 'Ilse Pro is active on this machine: test mode and its memory' },
  'settings.planFreeHint': { pt: 'Ilse grátis. O modo teste é do Ilse Pro — ilse.design/#pro', en: 'Ilse free. Test mode is part of Ilse Pro — ilse.design/#pro' },
  'settings.wsConnectedHint': { pt: 'WebSocket conectado ao ilse na porta {port}', en: 'WebSocket connected to ilse on port {port}' },
  'settings.wsOfflineHint': { pt: 'WebSocket desconectado: o ilse não está rodando ou caiu', en: 'WebSocket disconnected: ilse is not running or stopped' },
  'settings.defaultModel': { pt: 'modelo padrão', en: 'default model' },
  'settings.modelCalls': { pt: '{count} chamadas nesta sessão', en: '{count} calls this session' },
  'settings.accountHint': { pt: 'Conta em que o agente roda. Para trocar: ilse --account', en: 'Account the agent runs on. To switch: ilse --account' },
  'toolbar.deferred': { pt: 'Na fila até o limite do agente renovar', en: "Queued until the agent's limit resets" },
  'panel.remove': { pt: 'Remover elemento', en: 'Remove element' },
  'panel.removeHint': { pt: 'Também: Delete (fn+⌫) com a nota vazia, ou ⌫ fora da nota', en: 'Also: Delete (fn+⌫) with the note empty, or ⌫ outside the note' },
  'panel.removedShort': { pt: 'Será removido', en: 'Will be removed' },
  'panel.removed': { pt: 'Marcado para remover — o × no comando desfaz', en: 'Marked for removal — the × on its command takes it back' },
  'panel.noTokens': { pt: 'nenhum token detectado no projeto', en: 'no tokens detected in this project' },
  'toolbar.removeCommand': { pt: 'Remover {what}', en: 'Remove {what}' },
  'undo.remove': { pt: 'remover', en: 'remove' },
  'toolbar.textCommand': { pt: 'Texto', en: 'Text' },
  'toolbar.removeWithNote': { pt: 'Este elemento será removido junto com o pedido. Não era isso? × no comando.', en: 'This element will be removed along with the request. Not what you meant? × on the command.' },
  'cli.syntaxRepair': { pt: 'o código ficou quebrado ({where}) — pedindo ao agente para corrigir', en: 'the code no longer parses ({where}) — asking the agent to fix it' },
  'cli.syntaxRepaired': { pt: 'sintaxe corrigida', en: 'syntax fixed' },
  'cli.checking': { pt: 'conferindo os tipos e os testes do projeto…', en: 'checking the project\'s types and tests…' },
  'cli.checkPassed': { pt: 'tipos e testes do projeto ok ({seconds}s)', en: 'project types and tests pass ({seconds}s)' },
  'cli.checkRepair': { pt: 'a mudança quebrou {count} checagens do projeto — pedindo ao agente para corrigir', en: 'the change broke {count} project checks — asking the agent to fix them' },
  'cli.checkOk': { pt: 'tipos e testes do projeto ok', en: 'project types and tests pass' },
  'cli.checkRepaired': { pt: 'checagens do projeto corrigidas', en: 'project checks fixed' },
  'cli.checkFailed': { pt: 'a mudança ainda quebra {count} checagens do projeto (mantida — desfaça na toolbar se preferir)', en: 'the change still breaks {count} project checks (kept — undo it from the toolbar if you like)' },
  'cli.syntaxReverted': { pt: 'Desfeito: o código ficou quebrado ({where})', en: 'Undone: the code no longer parsed ({where})' },
  'settings.snapToGrid': {
    pt: 'Snap to grid',
    en: 'Snap to grid',
  },
  'settings.language': {
    pt: 'Idioma',
    en: 'Language',
  },

  // ── Undo ─────────────────────────────────────────────────────────────────
  'undo.button': {
    pt: 'Desfazer',
    en: 'Undo',
  },
  'redo.done': {
    pt: 'Refeito: {count} arquivo(s)',
    en: 'Redone: {count} file(s)',
  },
  'redo.hint': { pt: 'Refazer ({keys})', en: 'Redo ({keys})' },
  'redo.toast': { pt: 'Refeito', en: 'Redone' },
  'undo.draftStart': { pt: 'Início deste ajuste — nada mais para desfazer aqui', en: 'Start of this adjustment — nothing more to undo here' },
  'undo.draftStep': { pt: 'Desfeito: {what}', en: 'Undone: {what}' },
  'undo.panel': { pt: 'ajuste do painel', en: 'panel edit' },
  'undo.resize': { pt: 'redimensionar', en: 'resize' },
  'undo.move': { pt: 'mover', en: 'move' },
  'undo.reorder': { pt: 'reordenar', en: 'reorder' },
  'undo.done': {
    pt: 'Desfeito — {count} arquivo(s) restaurado(s)',
    en: 'Undone — {count} file(s) restored',
  },
  'undo.conflicts': {
    pt: 'mantidos (editados depois)',
    en: 'kept (edited afterwards)',
  },
  'undo.toast': {
    pt: 'Desfeito. A anotação voltou pra pendente.',
    en: 'Undone. The annotation is pending again.',
  },
  'undo.toastConflicts': {
    pt: 'Desfeito em parte: {files} foi editado depois e ficou como está.',
    en: 'Partly undone: {files} was edited afterwards and was kept.',
  },

  // ── CLI: MCP (agent pulls) ────────────────────────────────────────────────
  'cli.modeMcp': {
    pt: 'Pelo chat do seu agente (MCP)',
    en: 'From your agent\'s chat (MCP)',
  },
  'cli.modeMcpHint': {
    pt: 'Claude Desktop, Cursor… buscam as anotações; conecte pela toolbar',
    en: 'Claude Desktop, Cursor… pull the annotations; connect from the toolbar',
  },
  'cli.modeMcpLabel': {
    pt: 'MCP — seu agente busca as anotações',
    en: 'MCP — your agent pulls the annotations',
  },
  'cli.mcpWaiting': {
    pt: '{count} anotação(ões) esperando o agente (MCP)',
    en: '{count} annotation(s) waiting for the agent (MCP)',
  },
  'cli.mcpClaimed': {
    pt: 'agente pegou {count} anotação(ões) via MCP',
    en: 'agent took {count} annotation(s) via MCP',
  },
  'cli.mcpHint': {
    pt: 'conectar: toolbar → configurações',
    en: 'connect: toolbar → settings',
  },
  'settings.connectAgent': {
    pt: 'Conectar agente',
    en: 'Connect agent',
  },
  'settings.connectHint': {
    pt: 'Cole no seu agente. O token fica só na sua máquina.',
    en: 'Paste into your agent. The token stays on your machine.',
  },
  'settings.logsAnnotations': {
    pt: 'anotações',
    en: 'annotations',
  },
  'settings.logsMedian': {
    pt: 'mediana até resolver',
    en: 'median to resolve',
  },
  'settings.logsHint': {
    pt: 'Tempos, etapas, tokens e custo de cada ação. Sem o texto das anotações.',
    en: 'Timings, steps, tokens and cost of every action. No annotation text.',
  },
  'settings.copy': {
    pt: 'Copiar',
    en: 'Copy',
  },
  'settings.copied': {
    pt: 'Copiado',
    en: 'Copied',
  },

  // ── CLI: proxy ───────────────────────────────────────────────────────────
  'proxy.waiting': {
    pt: 'Esperando o dev server subir (rode npm run dev em outro terminal)…',
    en: 'Waiting for the dev server (run npm run dev in another terminal)…',
  },
  'proxy.open': {
    pt: 'Abra com a Ilse:',
    en: 'Open with Ilse:',
  },
  'proxy.target': {
    pt: 'dev server em',
    en: 'dev server at',
  },
  'proxy.componentInstalled': {
    pt: '<Ilse /> já está no layout — use a URL normal do seu dev server.',
    en: '<Ilse /> is already in the layout — use your dev server URL.',
  },
  'proxy.failed': {
    pt: 'Não consegui subir o proxy da Ilse',
    en: 'Could not start the Ilse proxy',
  },
  'proxy.direct': {
    pt: 'Seu dev server já carrega a Ilse (plugin) — sem proxy, abra:',
    en: 'Your dev server already loads Ilse (plugin) — no proxy, open:',
  },
  'bookmarklet.notRunning': {
    pt: 'A Ilse não está rodando na porta {port}. Suba com npx ilse-design@latest e clique de novo.',
    en: "Ilse isn't running on port {port}. Start it with npx ilse-design@latest, then click again.",
  },
  'bookmarklet.pageTitle': {
    pt: 'Ilse em qualquer página local',
    en: 'Ilse on any local page',
  },
  'bookmarklet.pageDrag': {
    pt: 'Arraste o botão abaixo para a barra de favoritos.',
    en: 'Drag the button below to your bookmarks bar.',
  },
  'bookmarklet.pageUse': {
    pt: 'Na página do seu app (localhost), clique no favorito e a barra aparece, no endereço de sempre. Ela fala com a Ilse em execução; nada entra no seu projeto.',
    en: "On your app's page (localhost), click the bookmark and the toolbar shows up, on your usual address. It talks to the running Ilse; nothing goes into your project.",
  },
  'bookmarklet.cliPage': {
    pt: 'Arraste o botão desta página para a barra de favoritos:',
    en: 'Drag the button on this page to your bookmarks bar:',
  },
  'bookmarklet.cliOr': {
    pt: 'Ou crie um favorito com este endereço:',
    en: 'Or create a bookmark with this address:',
  },
  'cmd.bookmarklet': {
    pt: 'Mostra o bookmarklet que põe a barra em qualquer página local',
    en: 'Print the bookmarklet that puts the toolbar on any local page',
  },
  'vite.notRunning': {
    pt: 'Ilse: a barra aparece quando o `ilse` estiver rodando (npx ilse-design@latest) — depois, recarregue a página.',
    en: 'Ilse: the toolbar shows up once `ilse` is running (npx ilse-design@latest) — then reload the page.',
  },
  'cmd.target': {
    pt: 'Porta do dev server (padrão: detecta sozinho)',
    en: 'Dev server port (default: auto-detect)',
  },
  'cmd.proxyPort': {
    pt: 'Porta do proxy da Ilse (padrão: 4700)',
    en: 'Ilse proxy port (default: 4700)',
  },
  'cmd.inject': {
    pt: 'Instala o <Ilse /> no layout em vez de usar o proxy',
    en: 'Install <Ilse /> in the layout instead of using the proxy',
  },
  'cmd.noOpen': {
    pt: 'Não abrir o browser automaticamente',
    en: 'Do not open the browser automatically',
  },

  // ── Property panel, value lists, colour picker, pencil ────────────────────
  'panel.stroke.add': { pt: 'Adicionar stroke', en: 'Add stroke' },
  'panel.shadow.add': { pt: 'Adicionar sombra', en: 'Add shadow' },
  'panel.shadow.remove': { pt: 'Remover sombra', en: 'Remove shadow' },
  'panel.stroke.remove': { pt: 'Remover stroke', en: 'Remove stroke' },
  'panel.stroke.solid': { pt: 'Sólido', en: 'Solid' },
  'panel.stroke.dashed': { pt: 'Tracejado', en: 'Dashed' },
  'panel.stroke.dotted': { pt: 'Pontilhado', en: 'Dotted' },
  'panel.flow.block': { pt: 'Block — sem flow', en: 'Block — no flow' },
  'panel.size.fixedHint': { pt: '{cls}-[px] ou %', en: '{cls}-[px] or %' },
  'panel.size.hugHint': { pt: '{cls} — abraça o conteúdo', en: '{cls} — hugs the content' },
  'panel.size.fillHint': { pt: '{cls} — ocupa o espaço do pai', en: '{cls} — fills the parent' },
  'panel.size.placeholder': { pt: 'px ou %', en: 'px or %' },
  'panel.size.title': { pt: 'Número = px · aceita 50%, 20rem…', en: 'Number = px · also takes 50%, 20rem…' },
  'panel.edited': { pt: 'alterado', en: 'changed' },
  'panel.align.left': { pt: 'esquerda', en: 'left' },
  'panel.align.center': { pt: 'centro', en: 'center' },
  'panel.align.right': { pt: 'direita', en: 'right' },
  'panel.align.top': { pt: 'topo', en: 'top' },
  'panel.align.middle': { pt: 'meio', en: 'middle' },
  'panel.align.bottom': { pt: 'base', en: 'bottom' },
  'panel.offScale': { pt: 'fora do padrão', en: 'off scale' },
  'panel.group.project': { pt: 'No padrão do projeto', en: 'Project scale' },
  'panel.group.common': { pt: 'Valores comuns', en: 'Common values' },
  'panel.side.top': { pt: 'Em cima', en: 'Top' },
  'panel.side.right': { pt: 'Direita', en: 'Right' },
  'panel.side.bottom': { pt: 'Embaixo', en: 'Bottom' },
  'panel.side.left': { pt: 'Esquerda', en: 'Left' },
  'panel.sides.all': { pt: 'Todos os lados', en: 'All sides' },
  'panel.sides.axis': { pt: 'Horizontal e vertical', en: 'Horizontal and vertical' },
  'panel.sides.each': { pt: 'Cada lado', en: 'Each side' },
  'panel.clickFor': { pt: 'Clique: {next}', en: 'Click: {next}' },
  'select.other': { pt: 'Outro valor…', en: 'Other value…' },
  'select.more': { pt: 'Ver mais ({n})', en: 'Show more ({n})' },
  'select.less': { pt: 'Ver menos', en: 'Show less' },
  'select.offScale': { pt: 'Valor fora da escala do projeto — escolha um da lista ou mantenha como exceção', en: 'Off the project scale — pick one from the list or keep it as an exception' },
  'color.section.neutral': { pt: 'Neutros', en: 'Neutrals' },
  'color.section.color': { pt: 'Cores', en: 'Colors' },
  'color.section.translucent': { pt: 'Transparentes', en: 'Translucent' },
  'color.section.gradient': { pt: 'Degradês', en: 'Gradients' },
  'color.gradient': { pt: 'degradê', en: 'gradient' },
  'color.eyedropper': { pt: 'Conta-gotas', en: 'Eyedropper' },
  'color.none': { pt: 'Sem cor', en: 'No color' },
  'color.value': { pt: 'Valor da cor', en: 'Color value' },
  'color.opacity': { pt: 'Opacidade', en: 'Opacity' },
  'sketch.penColor': { pt: 'Cor do lápis', en: 'Pen color' },
  'sketch.pen.orange': { pt: 'Laranja', en: 'Orange' },
  'sketch.pen.red': { pt: 'Vermelho', en: 'Red' },
  'sketch.pen.blue': { pt: 'Azul', en: 'Blue' },
  'sketch.pen.green': { pt: 'Verde', en: 'Green' },
  'sketch.pen.black': { pt: 'Preto', en: 'Black' },
  'sketch.undo': { pt: 'Desfazer traço', en: 'Undo stroke' },
  'sketch.clear': { pt: 'Apagar desenho', en: 'Clear drawing' },

  // ── Note card (toolbar) ──────────────────────────────────────────────────
  'toolbar.scope.label': { pt: 'Aplicar em', en: 'Apply to' },
  'toolbar.scope.one': { pt: 'Só neste', en: 'Only this' },
  'toolbar.scope.oneTitle': { pt: 'Só este {component} muda', en: 'Only this {component} changes' },
  'toolbar.scope.all': { pt: 'Todos · {count}', en: 'All · {count}' },
  'toolbar.scope.allTitle': { pt: 'Todos os {count} {component} desta tela (e onde mais ele for usado) mudam', en: 'All {count} {component} on this screen (and wherever else it is used) change' },
  'toolbar.scope.component': { pt: 'Componente {component}', en: 'Component {component}' },
  'toolbar.summaryTitle': { pt: 'O que a Ilse vai mandar para o agente', en: 'What Ilse will send to the agent' },
  'cli.updateAvailable': { pt: 'ilse-design {version} disponível', en: 'ilse-design {version} available' },
  'cmd.port': { pt: 'Porta em que o seu app roda (fica salva para este projeto)', en: 'Port your app runs on (saved for this project)' },
  'samePort.portQuestion': { pt: 'Seu app vai rodar em {url}', en: 'Your app will run at {url}' },
  'samePort.portKeep': { pt: 'Rodar nessa porta', en: 'Run on this port' },
  'cli.modeLabel': { pt: 'Modo', en: 'Mode' },
  'cli.agentLabel': { pt: 'Agente', en: 'Agent' },
  'samePort.busyUse': { pt: 'Rodar em {url}', en: 'Run at {url}' },
  'samePort.busyBy': { pt: '{url} está em uso por {who}', en: '{url} is in use by {who}' },
  'samePort.whoIlse': { pt: 'outra Ilse ({project})', en: 'another Ilse ({project})' },
  'samePort.whoIlseAlone': { pt: 'outra Ilse', en: 'another Ilse' },
  'samePort.fromCode': { pt: 'citada em {source}', en: 'named in {source}' },
  'samePort.recommended': { pt: '(recomendado)', en: '(recommended)' },
  'samePort.stopIlse': { pt: 'Parar essa Ilse e rodar em {url}', en: 'Stop that Ilse and run at {url}' },
  'samePort.loginHere': { pt: 'o login espera essa porta', en: 'the login expects this port' },
  'samePort.loginWarn': { pt: 'o login pode falhar: {source} aponta pra :{port}', en: 'login may fail: {source} points to :{port}' },
  'samePort.loginWarnSaid': { pt: 'o login pode falhar: ele depende da :{port}', en: 'login may fail: it depends on :{port}' },
  'samePort.loginQuestion': { pt: 'O login deste app depende da porta {port}? (callbacks de OAuth/SSO, NEXTAUTH_URL…)', en: "Does this app's login depend on port {port}? (OAuth/SSO callbacks, NEXTAUTH_URL…)" },
  'samePort.codePorts': { pt: 'Portas que o código do projeto cita: {list}', en: "Ports this project's code names: {list}" },
  'samePort.stopping': { pt: 'Parando a outra Ilse…', en: 'Stopping the other Ilse…' },
  'samePort.stopFailed': { pt: 'A outra Ilse não parou. Feche ela no terminal dela (Ctrl+C) e rode ilse de novo.', en: "The other Ilse didn't stop. Close it in its own terminal (Ctrl+C) and run ilse again." },
  'samePort.portChange': { pt: 'Mudar a porta', en: 'Change the port' },
  'samePort.portAsk': { pt: 'Em que porta você quer que ele rode?', en: 'Which port should it run on?' },
  'samePort.portInvalid': { pt: 'Digite um número de porta (por exemplo 3000)', en: 'Type a port number (for example 3000)' },
  'samePort.portSaved': { pt: 'Porta deste projeto: {port} — salva.', en: "This project's port: {port} — saved." },
  'samePort.portHint': { pt: 'outra porta? ilse --port <número>', en: 'another port? ilse --port <number>' },
  'samePort.appQuestion': { pt: 'Qual app abrir?', en: 'Which app should Ilse open?' },
  'pro.testLocked': { pt: 'O modo teste é do Ilse Pro: um agente usa o seu app como um usuário e aponta o que quebrou. Saiba mais:', en: 'Test mode is part of Ilse Pro: an agent uses your app like a user and points out what broke. Learn more:' },
  'toolbar.testLocked': { pt: 'O modo teste é do Ilse Pro — um agente usa o seu app e aponta o que quebrou. Veja em ilse.design/#pro', en: 'Test mode is part of Ilse Pro — an agent uses your app and points out what broke. See ilse.design/#pro' },
  'cmd.test': { pt: 'O agente testa o app que você está rodando e mostra o que achou', en: 'The agent tests the app you are running and reports what it found' },
  'cmd.testPages': { pt: 'Quantas páginas percorrer no máximo', en: 'Most pages to visit' },
  'cmd.testNoMobile': { pt: 'Só desktop, sem testar no tamanho de celular', en: 'Desktop only, skip the phone size' },
  'cmd.testLogin': { pt: 'Abre o app para você fazer login uma vez; a sessão fica salva para os próximos testes', en: 'Opens the app so you log in once; the session is kept for the next tests' },
  'test.noApp': { pt: 'Não achei o seu app rodando. Suba ele (ilse em outro terminal, ou npm run dev) ou passe o endereço: ilse test http://localhost:3000', en: "Couldn't find your app running. Start it (ilse in another terminal, or npm run dev) or pass the address: ilse test http://localhost:3000" },
  'test.localOnly': { pt: 'O modo teste só roda no app local (localhost). O navegador clica e carrega de verdade — em produção isso mexe em dados reais.', en: 'Test mode only runs on your local app (localhost). The browser really clicks and loads — in production that touches real data.' },
  'test.loginOpen': { pt: 'Abrindo o app numa janela. Faça login normalmente.', en: 'Opening the app in a window. Log in as usual.' },
  'test.loginDone': { pt: 'Depois de logar, aperte Enter aqui:', en: 'Once you are logged in, press Enter here:' },
  'test.loginSaved': { pt: 'Sessão salva para os próximos testes (fica só na sua máquina).', en: 'Session saved for the next tests (it stays on your machine).' },
  'test.withLogin': { pt: 'com a sua sessão salva', en: 'with your saved session' },
  'test.summary': { pt: '{count} achados em {pages} páginas', en: '{count} findings on {pages} pages' },
  'test.high': { pt: 'altos', en: 'high' },
  'test.medium': { pt: 'médios', en: 'medium' },
  'test.low': { pt: 'baixos', en: 'low' },
  'test.known': { pt: '{count} já descartados por você, não mostrados', en: '{count} you discarded before, not shown' },
  'test.more': { pt: 'e mais {count} no relatório', en: 'and {count} more in the report' },
  'test.report': { pt: 'Relatório:', en: 'Report:' },
  'test.noBrowser': { pt: 'Não achei um navegador para o teste. Instale o Google Chrome, ou rode:', en: "Couldn't find a browser for the test. Install Google Chrome, or run:" },
  'cmd.separate': { pt: 'Abrir a Ilse num endereço separado (localhost:4700) nesta execução', en: 'Open Ilse on a separate address (localhost:4700) for this run' },
  'cli.addressQuestion': { pt: 'Onde abrir a Ilse?', en: 'Where should Ilse open?' },
  'cli.addressSame': { pt: 'No endereço de sempre do app (recomendado)', en: "On your app's usual address (recommended)" },
  'cli.addressSameHint': { pt: 'a Ilse sobe o seu dev server por trás; login e SSO continuam funcionando', en: 'Ilse starts your dev server behind it; login and SSO keep working' },
  'cli.addressSeparate': { pt: 'Num endereço separado (localhost:4700)', en: 'On a separate address (localhost:4700)' },
  'cli.addressSeparateHint': { pt: 'você roda o dev server como sempre; login e SSO presos à porta podem não funcionar', en: "you run the dev server as usual; login and SSO tied to the port may not work" },
  'cmd.samePort': { pt: 'Usar a Ilse no endereço de sempre do app: ela sobe o seu dev server por trás', en: "Use Ilse on the app's usual address: it starts your dev server behind it" },
  'samePort.noScript': { pt: 'Sem script "dev" ou "start" no package.json — usando um endereço separado.', en: 'No "dev" or "start" script in package.json — using a separate address.' },
  'samePort.busy': { pt: 'A porta {port} já está em uso.', en: 'Port {port} is already in use.' },
  'samePort.busyHint': { pt: 'Se for o seu dev server, pare ele e rode ilse de novo — a Ilse sobe ele por trás. Para usar o que já está rodando: ilse --separate.', en: "If it's your dev server, stop it and run ilse again — Ilse starts it behind itself. To use the one already running: ilse --separate." },
  'samePort.starting': { pt: 'Subindo o seu dev server por trás ({script})…', en: 'Starting your dev server behind Ilse ({script})…' },
  'samePort.failed': { pt: 'Não consegui subir o dev server', en: "Couldn't start the dev server" },
  'samePort.ownPort': { pt: 'Seu script de dev fixa a porta {port} e ignora a que a Ilse passa (PORT).', en: 'Your dev script fixes port {port} and ignores the one Ilse gives it (PORT).' },
  'samePort.ownPortHint': { pt: 'Para abrir no endereço de sempre, faça o script ler PORT — ex.: ${PORT:-{port}} no lugar de {fixed}.', en: 'To open it at its usual address, have the script read PORT — e.g. ${PORT:-{port}} instead of {fixed}.' },
  'samePort.failedHint': { pt: 'O script precisa usar a porta de PORT, ou escrever o endereço no log. Ou rode o dev server você mesmo e use ilse --separate.', en: 'The script must use the port in PORT, or print its address in the log. Or run the dev server yourself and use ilse --separate.' },
  'samePort.open': { pt: 'Abra o seu app no endereço de sempre:', en: 'Open your app at its usual address:' },
  'samePort.lockStuck': { pt: 'Já tem um dev server deste projeto aberto (PID {pid}), mas ele não responde — e o Next só deixa rodar um por pasta.', en: "There's already a dev server of this project open (PID {pid}), but it doesn't answer — and Next allows only one per folder." },
  'samePort.lockStuckHint': { pt: 'Pare ele com kill -9 {pid} e rode ilse de novo.', en: 'Stop it with kill -9 {pid} and run ilse again.' },
  'samePort.lockReuse': { pt: 'Já tem um dev server deste projeto rodando na porta {port} (PID {pid}) — usando ele.', en: 'A dev server of this project is already running on port {port} (PID {pid}) — using it.' },
  'samePort.exited': { pt: 'O dev server parou (código {code}). Rode ilse de novo.', en: 'The dev server stopped (code {code}). Run ilse again.' },
  'toolbar.send': { pt: 'Enviar', en: 'Send' },
  'sketch.clearShort': { pt: 'Limpar', en: 'Clear' },
  'sketch.done': { pt: 'Pronto', en: 'Done' },
  'shortcuts.title': { pt: 'Atalhos de teclado', en: 'Keyboard shortcuts' },
  'shortcuts.recentered': { pt: 'Barra de volta ao lugar padrão', en: 'Toolbar back in its default place' },
  'shortcuts.group.toolbar': { pt: 'Barra', en: 'Toolbar' },
  'shortcuts.group.selection': { pt: 'Seleção e nota', en: 'Selection and note' },
  'shortcuts.group.undo': { pt: 'Desfazer', en: 'Undo' },
  'shortcuts.group.pencil': { pt: 'Lápis', en: 'Pencil' },
  'shortcuts.select': { pt: 'Alternar entre selecionar elementos e usar a página', en: 'Switch between selecting elements and using the page' },
  'shortcuts.recenter': { pt: 'Trazer a barra de volta ao lugar padrão', en: 'Bring the toolbar back to its default place' },
  'shortcuts.escape': { pt: 'Fechar o que estiver por cima (nota, scan, configurações) e, por fim, a barra', en: 'Close what is on top (note, scan, settings), then the toolbar' },
  'shortcuts.deepSelect': { pt: 'Selecionar o elemento exato dentro de um SVG', en: 'Select the exact element inside an SVG' },
  'shortcuts.send': { pt: 'Enviar a nota', en: 'Send the note' },
  'shortcuts.remove': { pt: 'Remover o elemento selecionado (com a nota vazia)', en: 'Remove the selected element (with the note empty)' },
  'shortcuts.undo': { pt: 'Desfazer: um passo do rascunho ou a última mudança aplicada', en: 'Undo: a draft step, or the last applied change' },
  'shortcuts.redo': { pt: 'Refazer', en: 'Redo' },
  'shortcuts.pencilDone': { pt: 'Concluir o desenho', en: 'Finish the sketch' },
  'shortcuts.pencilUndo': { pt: 'Desfazer o último traço', en: 'Undo the last stroke' },
  'shortcuts.pencilDiscard': { pt: 'Descartar o desenho', en: 'Discard the sketch' },
  'toolbar.selectParent': { pt: 'Selecionar o elemento pai', en: 'Select the parent element' },
  'toolbar.tree.toggle': { pt: 'Mostrar onde o elemento está', en: 'Show where the element sits' },
  'toolbar.tree.label': { pt: 'Estrutura do elemento', en: 'Element structure' },
  'toolbar.tree.more': { pt: '+{count} mais', en: '+{count} more' },
  'toolbar.tree.unfold': { pt: 'Mostrar todos os elementos acima', en: 'Show every element above' },
  'toolbar.tree.locked': { pt: 'Envie ou descarte a alteração para trocar de elemento', en: 'Send or discard the change to select another element' },
  'toolbar.removeChip': { pt: 'Remover comando', en: 'Remove command' },
  'toolbar.markerTitle': { pt: 'Clique para abrir · arraste para mover', en: 'Click to open · drag to move' },
  'toolbar.chip.panelOne': { pt: '1 ajuste do painel', en: '1 panel adjustment' },
  'toolbar.chip.panelMany': { pt: '{n} ajustes do painel', en: '{n} panel adjustments' },
  'toolbar.chip.sketchOne': { pt: 'Desenho · 1 traço lido', en: 'Drawing · 1 stroke read' },
  'toolbar.chip.sketchMany': { pt: 'Desenho · {n} traços lidos', en: 'Drawing · {n} strokes read' },
  'toolbar.chip.reorder': { pt: 'Reordenar "{item}" → posição {to} de {count}', en: 'Reorder "{item}" → position {to} of {count}' },
  'toolbar.chip.reorderIn': { pt: 'Reordenar "{item}" → posição {to} de {count} em <{owner}>', en: 'Reorder "{item}" → position {to} of {count} in <{owner}>' },
  'toolbar.chip.moveInto': { pt: 'Mover "{item}" para dentro de "{into}"', en: 'Move "{item}" into "{into}"' },
  'toolbar.chip.moveOut': { pt: 'Tirar "{item}" para dentro de "{into}"', en: 'Take "{item}" out into "{into}"' },
  'toolbar.chip.resized': { pt: 'Redimensionado de {from} para {to}.', en: 'Resized from {from} to {to}.' },
  'toolbar.chip.dragged': { pt: 'Arrastado {parts}.', en: 'Dragged {parts}.' },
  'toolbar.chip.and': { pt: ' e ', en: ' and ' },
  'toolbar.chip.up': { pt: '{px}px para cima', en: '{px}px up' },
  'toolbar.chip.down': { pt: '{px}px para baixo', en: '{px}px down' },
  'toolbar.chip.left': { pt: '{px}px para esquerda', en: '{px}px left' },
  'toolbar.chip.right': { pt: '{px}px para direita', en: '{px}px right' },
  'toolbar.runFailed': { pt: 'Erro ao executar', en: 'Run failed' },

  // ── CLI: no-AI class swap, proxy errors ──────────────────────────────────
  'swap.summary': { pt: '{edits} em {file}:{line} (sem IA)', en: '{edits} in {file}:{line} (no AI)' },
  'proxy.unreachable': { pt: 'Ilse: não consegui falar com o dev server em {host}:{port} ({error}).', en: "Ilse: couldn't reach the dev server at {host}:{port} ({error})." },

  // ── Bridge: augment.ts ───────────────────────────────────────────────────
  'augment.noNote': {
    pt: 'sem nota',
    en: 'no note',
  },
} as const;

export type MessageKey = keyof typeof messages;

export default messages;
