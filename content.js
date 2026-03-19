(() => {
  if (window.maximumNotificacoesInjected) {
    return;
  }
  window.maximumNotificacoesInjected = true;

  const root = document.createElement('div');
  root.id = 'maximum-notificacoes-root';

  const state = {
    open: false,
    loading: true,
    search: '',
    unreadOnly: false,
    dateFilter: 'all',
    sortDirection: 'desc',
    tokenValue: '',
    feed: {
      status: 'needs_token',
      notifications: [],
      tokenMissing: true,
      syncing: false,
      errorMessage: '',
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      stats: {
        total: 0,
        unread: 0,
        bySource: {
          obligations: 0,
          processes: 0,
          requests: 0,
          companies: 0
        }
      }
    },
    settings: {
      hasToken: false,
      lastTokenUpdatedAt: null
    },
    pageContext: {}
  };

  const inferUserName = () => {
    const bodyCandidates = [
      document.body?.dataset?.user,
      document.body?.dataset?.username,
      document.querySelector('[data-user-name]')?.getAttribute('data-user-name'),
      document.querySelector('meta[name="author"]')?.content,
      document.title.split('|')[0],
      document.title.split('-')[0]
    ];

    return bodyCandidates
      .map((value) => String(value || '').trim())
      .find(Boolean) || 'Usuário do Acessórias';
  };

  const currentUser = inferUserName();

  const runtimeMessage = (payload) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      if (!response?.ok) {
        reject(new Error(response?.error || 'Falha ao comunicar com a extensão.'));
        return;
      }

      resolve(response);
    });
  });

  const formatDateTime = (value) => {
    if (!value) {
      return 'Sem data';
    }

    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  };

  const formatRelativeSync = (value) => {
    if (!value) {
      return 'Aguardando primeira sincronização';
    }

    const diffInMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
    if (diffInMinutes < 1) {
      return 'Sincronizado agora';
    }
    if (diffInMinutes < 60) {
      return `Sincronizado há ${diffInMinutes} min`;
    }

    const diffInHours = Math.round(diffInMinutes / 60);
    return `Sincronizado há ${diffInHours} h`;
  };

  const elements = {
    toggle: null,
    toggleBadge: null,
    overlay: null,
    panel: null,
    syncPill: null,
    tokenNotice: null,
    tokenForm: null,
    tokenInput: null,
    saveTokenButton: null,
    clearTokenButton: null,
    refreshButton: null,
    markAllReadButton: null,
    searchInput: null,
    dateSelect: null,
    sortSelect: null,
    unreadCheckbox: null,
    list: null,
    footer: null,
    statsTotal: null,
    statsUnread: null,
    statsObligations: null,
    statsProcesses: null,
    statsRequests: null,
    statsCompanies: null,
    pageLabel: null,
    lastSyncLabel: null,
    closeButton: null
  };

  const categoryLabel = {
    obligation: 'Obrigação',
    process: 'Processo',
    comment: 'Comentário',
    update: 'Atualização',
    summary: 'Resumo'
  };

  const sourceLabel = {
    obligations: 'Obrigações',
    processes: 'Processos',
    requests: 'Solicitações',
    companies: 'Consolidação'
  };

  const getDatePredicate = () => {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    switch (state.dateFilter) {
      case 'today':
        return (date) => date >= startOfToday;
      case 'week':
        return (date) => date >= startOfWeek;
      case 'month':
        return (date) => date >= startOfMonth;
      default:
        return () => true;
    }
  };

  const getFilteredNotifications = () => {
    const predicate = getDatePredicate();
    const search = state.search.trim().toLowerCase();

    return (state.feed.notifications || [])
      .filter((notification) => !state.unreadOnly || notification.unread)
      .filter((notification) => predicate(new Date(notification.createdAt)))
      .filter((notification) => {
        if (!search) {
          return true;
        }

        return [
          notification.title,
          notification.message,
          notification.context,
          notification.author,
          sourceLabel[notification.source],
          categoryLabel[notification.category]
        ].join(' ').toLowerCase().includes(search);
      })
      .sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return state.sortDirection === 'asc' ? diff : -diff;
      });
  };

  const renderStats = () => {
    const stats = state.feed.stats || { total: 0, unread: 0, bySource: {} };
    elements.toggleBadge.textContent = stats.unread || 0;
    elements.statsTotal.textContent = stats.total || 0;
    elements.statsUnread.textContent = stats.unread || 0;
    elements.statsObligations.textContent = stats.bySource?.obligations || 0;
    elements.statsProcesses.textContent = stats.bySource?.processes || 0;
    elements.statsRequests.textContent = stats.bySource?.requests || 0;
    elements.statsCompanies.textContent = stats.bySource?.companies || 0;

    root.dataset.hasUnread = String((stats.unread || 0) > 0);
    root.dataset.syncing = String(Boolean(state.feed.syncing));
    elements.syncPill.textContent = state.feed.syncing ? 'Sincronizando...' : formatRelativeSync(state.feed.lastSuccessfulSyncAt);
    elements.lastSyncLabel.textContent = state.feed.lastSuccessfulSyncAt
      ? `Última leitura real da API: ${formatDateTime(state.feed.lastSuccessfulSyncAt)}`
      : 'Sem leitura da API ainda';
    elements.pageLabel.textContent = state.pageContext?.currentTitle
      ? `Página atual: ${state.pageContext.currentTitle}`
      : 'Página atual: app.acessorias.com';
  };

  const renderTokenState = () => {
    const needsToken = !state.settings.hasToken || state.feed.tokenMissing;
    const errorMessage = state.feed.errorMessage;

    elements.tokenNotice.innerHTML = needsToken
      ? `
        <div class="maximum-token-callout is-warning">
          <strong>API Token obrigatório</strong>
          <p>Para exibir atualizações reais de Obrigações, Processos, Solicitações e mudanças consolidadas, abra o Acessórias, vá na engrenagem do canto superior direito e gere seu API Token. Depois cole o token abaixo.</p>
        </div>
      `
      : errorMessage
        ? `
          <div class="maximum-token-callout is-error">
            <strong>Falha ao consultar a API</strong>
            <p>${errorMessage}</p>
          </div>
        `
        : `
          <div class="maximum-token-callout is-success">
            <strong>API conectada</strong>
            <p>O painel está lendo atualizações reais do domínio Acessórias e continuará verificando mudanças automaticamente enquanto a extensão estiver ativa.</p>
          </div>
        `;

    elements.tokenInput.value = state.tokenValue;
    elements.clearTokenButton.disabled = !state.settings.hasToken;
    elements.markAllReadButton.disabled = !(state.feed.stats?.unread > 0);
  };

  const renderList = () => {
    const notifications = getFilteredNotifications();

    if (!state.settings.hasToken || state.feed.tokenMissing) {
      elements.list.innerHTML = `
        <div class="maximum-empty-state">
          <div class="maximum-empty-icon">🔐</div>
          <h3>Informe o token para começar</h3>
          <p>Enquanto o API Token não for informado, as atualizações reais não aparecem.</p>
        </div>
      `;
      elements.footer.textContent = 'Sem dados reais até a configuração do token.';
      return;
    }

    if (notifications.length === 0) {
      elements.list.innerHTML = `
        <div class="maximum-empty-state">
          <div class="maximum-empty-icon">✨</div>
          <h3>Nenhuma alteração no filtro atual</h3>
          <p>Ajuste os filtros ou clique em atualizar agora para forçar uma nova leitura da API.</p>
        </div>
      `;
      elements.footer.textContent = '0 resultados exibidos';
      return;
    }

    elements.list.innerHTML = notifications.map((notification) => `
      <article class="maximum-notification-card" data-unread="${notification.unread}">
        <div class="maximum-notification-accent"></div>
        <div class="maximum-notification-body">
          <div class="maximum-notification-topline">
            <span class="maximum-pill maximum-pill--source">${sourceLabel[notification.source] || notification.source}</span>
            <span class="maximum-pill maximum-pill--category">${categoryLabel[notification.category] || 'Atualização'}</span>
            <span class="maximum-notification-time">${formatDateTime(notification.createdAt)}</span>
          </div>
          <h3>${notification.title}</h3>
          <p>${notification.message}</p>
          <div class="maximum-notification-meta">
            <span><strong>Contexto:</strong> ${notification.context}</span>
            <span><strong>Origem:</strong> ${notification.author}</span>
          </div>
        </div>
        <div class="maximum-notification-actions">
          <button type="button" class="maximum-secondary-button" data-action="toggle-read" data-id="${notification.id}" data-next-unread="${!notification.unread}">
            ${notification.unread ? 'Marcar como lida' : 'Marcar como não lida'}
          </button>
        </div>
      </article>
    `).join('');

    const unreadInView = notifications.filter((notification) => notification.unread).length;
    elements.footer.textContent = `${notifications.length} itens exibidos • ${unreadInView} não lidos nesta visualização`;
  };

  const render = () => {
    elements.overlay.dataset.open = String(state.open);
    elements.panel.dataset.open = String(state.open);
    elements.searchInput.value = state.search;
    elements.dateSelect.value = state.dateFilter;
    elements.sortSelect.value = state.sortDirection;
    elements.unreadCheckbox.checked = state.unreadOnly;
    renderStats();
    renderTokenState();
    renderList();
  };

  const hydrate = async () => {
    try {
      state.loading = true;
      const response = await runtimeMessage({ type: 'maximum:get-state' });
      state.feed = response.feed;
      state.settings = response.settings;
      state.pageContext = response.pageContext || {};
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'error';
    } finally {
      state.loading = false;
      render();
    }
  };

  root.innerHTML = `
    <button class="maximum-toggle-button" type="button" aria-label="Abrir painel de notificações Maximum">
      <span class="maximum-toggle-icon">✦</span>
      <span class="maximum-toggle-text">Maximum</span>
      <span class="maximum-toggle-badge">0</span>
    </button>
    <div class="maximum-overlay" data-open="false"></div>
    <aside class="maximum-panel" data-open="false" aria-label="Painel MaximumNotificações">
      <header class="maximum-hero">
        <div class="maximum-hero-row">
          <div>
            <span class="maximum-hero-kicker">Monitoramento inteligente</span>
            <h1>maximumNotificações</h1>
            <p class="maximum-hero-subtitle">Divisor</p>
          </div>
          <button type="button" class="maximum-close-button">Fechar</button>
        </div>
        <p class="maximum-hero-description">Mostra notificações reais de atualizações de Obrigações, Processos, Solicitações e mudanças consolidadas de tudo o que está relacionado ao ambiente do usuário dentro do domínio app.acessorias.com.</p>
        <div class="maximum-hero-status-row">
          <div class="maximum-sync-pill">Sincronizando...</div>
          <div class="maximum-page-label"></div>
        </div>
        <div class="maximum-stats-grid">
          <article class="maximum-stat-card">
            <span>Total</span>
            <strong data-stat="total">0</strong>
          </article>
          <article class="maximum-stat-card">
            <span>Não lidas</span>
            <strong data-stat="unread">0</strong>
          </article>
          <article class="maximum-stat-card">
            <span>Obrigações</span>
            <strong data-stat="obligations">0</strong>
          </article>
          <article class="maximum-stat-card">
            <span>Processos</span>
            <strong data-stat="processes">0</strong>
          </article>
          <article class="maximum-stat-card">
            <span>Solicitações</span>
            <strong data-stat="requests">0</strong>
          </article>
          <article class="maximum-stat-card">
            <span>Consolidadas</span>
            <strong data-stat="companies">0</strong>
          </article>
        </div>
      </header>

      <section class="maximum-token-section">
        <div class="maximum-token-notice"></div>
        <form class="maximum-token-form">
          <div class="maximum-input-group maximum-input-group--token">
            <label for="maximum-token-input">API Token</label>
            <input id="maximum-token-input" type="password" placeholder="Cole aqui o API Token gerado no Acessórias" autocomplete="off" />
          </div>
          <div class="maximum-token-actions">
            <button type="submit" class="maximum-primary-button">Salvar token</button>
            <button type="button" class="maximum-secondary-button" data-action="refresh">Atualizar agora</button>
            <button type="button" class="maximum-secondary-button" data-action="clear-token">Limpar token</button>
            <button type="button" class="maximum-secondary-button" data-action="mark-all-read">Marcar tudo como lido</button>
          </div>
        </form>
        <div class="maximum-last-sync"></div>
      </section>

      <section class="maximum-toolbar">
        <div class="maximum-input-group maximum-input-group--wide">
          <label for="maximum-search">Buscar</label>
          <input id="maximum-search" type="search" placeholder="Busque por empresa, processo, obrigação ou solicitação" />
        </div>
        <div class="maximum-input-group">
          <label for="maximum-date">Filtrar por data</label>
          <select id="maximum-date">
            <option value="all">Todas</option>
            <option value="today">Hoje</option>
            <option value="week">Últimos 7 dias</option>
            <option value="month">Este mês</option>
          </select>
        </div>
        <div class="maximum-input-group">
          <label for="maximum-sort">Ordenar por hora</label>
          <select id="maximum-sort">
            <option value="desc">Mais recente primeiro</option>
            <option value="asc">Hora crescente</option>
          </select>
        </div>
        <label class="maximum-inline-checkbox">
          <input id="maximum-unread-only" type="checkbox" />
          Somente não lidas
        </label>
      </section>

      <section class="maximum-content">
        <div class="maximum-notification-list"></div>
        <div class="maximum-content-footer"></div>
      </section>
    </aside>
  `;

  document.documentElement.appendChild(root);

  elements.toggle = root.querySelector('.maximum-toggle-button');
  elements.toggleBadge = root.querySelector('.maximum-toggle-badge');
  elements.overlay = root.querySelector('.maximum-overlay');
  elements.panel = root.querySelector('.maximum-panel');
  elements.syncPill = root.querySelector('.maximum-sync-pill');
  elements.tokenNotice = root.querySelector('.maximum-token-notice');
  elements.tokenForm = root.querySelector('.maximum-token-form');
  elements.tokenInput = root.querySelector('#maximum-token-input');
  elements.saveTokenButton = elements.tokenForm.querySelector('.maximum-primary-button');
  elements.clearTokenButton = root.querySelector('[data-action="clear-token"]');
  elements.refreshButton = root.querySelector('[data-action="refresh"]');
  elements.markAllReadButton = root.querySelector('[data-action="mark-all-read"]');
  elements.searchInput = root.querySelector('#maximum-search');
  elements.dateSelect = root.querySelector('#maximum-date');
  elements.sortSelect = root.querySelector('#maximum-sort');
  elements.unreadCheckbox = root.querySelector('#maximum-unread-only');
  elements.list = root.querySelector('.maximum-notification-list');
  elements.footer = root.querySelector('.maximum-content-footer');
  elements.statsTotal = root.querySelector('[data-stat="total"]');
  elements.statsUnread = root.querySelector('[data-stat="unread"]');
  elements.statsObligations = root.querySelector('[data-stat="obligations"]');
  elements.statsProcesses = root.querySelector('[data-stat="processes"]');
  elements.statsRequests = root.querySelector('[data-stat="requests"]');
  elements.statsCompanies = root.querySelector('[data-stat="companies"]');
  elements.pageLabel = root.querySelector('.maximum-page-label');
  elements.lastSyncLabel = root.querySelector('.maximum-last-sync');
  elements.closeButton = root.querySelector('.maximum-close-button');

  const setOpen = (value) => {
    state.open = value;
    render();
  };

  elements.toggle.addEventListener('click', () => setOpen(!state.open));
  elements.overlay.addEventListener('click', () => setOpen(false));
  elements.closeButton.addEventListener('click', () => setOpen(false));

  elements.tokenForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = elements.tokenInput.value.trim();
    state.tokenValue = token;
    elements.saveTokenButton.disabled = true;

    try {
      const response = await runtimeMessage({ type: 'maximum:save-token', token });
      state.feed = response.feed;
      state.settings = response.settings;
      state.pageContext = response.pageContext || state.pageContext;
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'error';
    } finally {
      elements.saveTokenButton.disabled = false;
      render();
    }
  });

  elements.refreshButton.addEventListener('click', async () => {
    try {
      const response = await runtimeMessage({ type: 'maximum:refresh' });
      state.feed = response.feed;
      state.settings = response.settings;
      render();
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'error';
      render();
    }
  });

  elements.clearTokenButton.addEventListener('click', async () => {
    state.tokenValue = '';
    try {
      const response = await runtimeMessage({ type: 'maximum:clear-token' });
      state.feed = response.feed;
      state.settings = response.settings;
      render();
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'error';
      render();
    }
  });

  elements.markAllReadButton.addEventListener('click', async () => {
    try {
      const response = await runtimeMessage({ type: 'maximum:mark-all-read' });
      state.feed = response.feed;
      state.settings = response.settings;
      render();
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'error';
      render();
    }
  });

  elements.searchInput.addEventListener('input', (event) => {
    state.search = event.target.value;
    render();
  });

  elements.dateSelect.addEventListener('change', (event) => {
    state.dateFilter = event.target.value;
    render();
  });

  elements.sortSelect.addEventListener('change', (event) => {
    state.sortDirection = event.target.value;
    render();
  });

  elements.unreadCheckbox.addEventListener('change', (event) => {
    state.unreadOnly = event.target.checked;
    render();
  });

  elements.list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action="toggle-read"]');
    if (!button) {
      return;
    }

    try {
      const response = await runtimeMessage({
        type: 'maximum:mark-read',
        notificationId: button.dataset.id,
        unread: button.dataset.nextUnread === 'true'
      });
      state.feed = response.feed;
      state.settings = response.settings;
      render();
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'error';
      render();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      setOpen(false);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }

    if (changes.maximum_feed?.newValue) {
      state.feed = changes.maximum_feed.newValue;
    }

    if (changes.maximum_settings?.newValue) {
      state.settings = {
        hasToken: Boolean(changes.maximum_settings.newValue.apiToken),
        lastTokenUpdatedAt: changes.maximum_settings.newValue.lastTokenUpdatedAt
      };
    }

    if (changes.maximum_page_context?.newValue) {
      state.pageContext = changes.maximum_page_context.newValue;
    }

    render();
  });

  runtimeMessage({
    type: 'maximum:update-page-context',
    payload: {
      currentTitle: document.title || 'Acessórias',
      currentUrl: window.location.href,
      inferredUser: currentUser
    }
  }).catch(() => null);

  hydrate();
})();
