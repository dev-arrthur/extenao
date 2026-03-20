(() => {
  if (window.maximumNotificacoesInjected) {
    return;
  }
  window.maximumNotificacoesInjected = true;

  const root = document.createElement('div');
  root.id = 'maximum-notificacoes-root';

  const state = {
    open: false,
    settingsOpen: false,
    loading: true,
    search: '',
    unreadOnly: false,
    dateFilter: 'all',
    sortDirection: 'desc',
    tokenValue: '',
    feed: {
      status: 'inactive',
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
      return 'Ainda sem sincronização';
    }

    const diffInMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
    if (diffInMinutes < 1) {
      return 'Sincronizado agora';
    }
    if (diffInMinutes < 60) {
      return `Sincronizado há ${diffInMinutes} min`;
    }

    return `Sincronizado há ${Math.round(diffInMinutes / 60)} h`;
  };

  const sourceLabel = {
    requests: 'Solicitações',
    processes: 'Processos',
    obligations: 'Obrigações',
    companies: 'Consolidação'
  };

  const categoryLabel = {
    update: 'Atualização',
    comment: 'Comentário',
    process: 'Processo',
    obligation: 'Obrigação',
    summary: 'Resumo'
  };

  const elements = {
    toggle: null,
    toggleBadge: null,
    overlay: null,
    panel: null,
    closeButton: null,
    statusText: null,
    statusPill: null,
    settingsButton: null,
    pageLabel: null,
    syncLabel: null,
    total: null,
    requests: null,
    processes: null,
    obligations: null,
    searchInput: null,
    dateSelect: null,
    sortSelect: null,
    unreadCheckbox: null,
    list: null,
    footer: null,
    alert: null,
    settingsBackdrop: null,
    settingsModal: null,
    settingsClose: null,
    tokenInput: null,
    saveToken: null,
    clearToken: null,
    refreshButton: null,
    markAllRead: null,
    modalSyncInfo: null
  };

  const getConnectionState = () => {
    if (state.settings.hasToken && !state.feed.errorMessage) {
      return {
        text: 'OK',
        tone: 'ok'
      };
    }

    return {
      text: 'Inativo',
      tone: 'inactive'
    };
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

  const renderAlert = () => {
    if (!elements.alert) {
      return;
    }

    if (state.feed.errorMessage) {
      elements.alert.innerHTML = `
        <div class="maximum-alert maximum-alert--error">
          <strong>Falha ao consultar a API</strong>
          <p>${state.feed.errorMessage}</p>
        </div>
      `;
      return;
    }

    if (!state.settings.hasToken || state.feed.tokenMissing) {
      elements.alert.innerHTML = `
        <div class="maximum-alert maximum-alert--warning">
          <strong>API inativa</strong>
          <p>Clique na engrenagem para informar a chave da API. Enquanto ela não for informada, os dados não aparecem.</p>
        </div>
      `;
      return;
    }

    elements.alert.innerHTML = '';
  };

  const renderStats = () => {
    const stats = state.feed.stats || { total: 0, unread: 0, bySource: {} };
    const connection = getConnectionState();

    elements.toggleBadge.textContent = stats.unread || 0;
    elements.requests.textContent = stats.bySource?.requests || 0;
    elements.processes.textContent = stats.bySource?.processes || 0;
    elements.obligations.textContent = stats.bySource?.obligations || 0;
    elements.total.textContent = stats.total || 0;
    elements.statusText.textContent = connection.text;
    elements.statusPill.dataset.tone = connection.tone;
    elements.pageLabel.textContent = state.pageContext?.currentTitle
      ? `Página: ${state.pageContext.currentTitle}`
      : 'Página: app.acessorias.com';
    elements.syncLabel.textContent = state.feed.syncing
      ? 'Sincronizando agora...'
      : formatRelativeSync(state.feed.lastSuccessfulSyncAt);
    elements.modalSyncInfo.textContent = state.feed.lastSuccessfulSyncAt
      ? `Última atualização real: ${formatDateTime(state.feed.lastSuccessfulSyncAt)}`
      : 'Ainda não houve leitura válida da API.';

    root.dataset.hasUnread = String((stats.unread || 0) > 0);
    root.dataset.syncing = String(Boolean(state.feed.syncing));
  };

  const renderList = () => {
    const notifications = getFilteredNotifications();

    if (!state.settings.hasToken || state.feed.tokenMissing) {
      elements.list.innerHTML = `
        <div class="maximum-empty-state">
          <div class="maximum-empty-icon">⚙</div>
          <h3>Configure a API pela engrenagem</h3>
          <p>Abra a engrenagem ao lado do status, cole a chave da API e salve para ativar as notificações.</p>
        </div>
      `;
      elements.footer.textContent = 'Sem dados enquanto a integração estiver inativa.';
      return;
    }

    if (!notifications.length) {
      elements.list.innerHTML = `
        <div class="maximum-empty-state">
          <div class="maximum-empty-icon">✨</div>
          <h3>Nada novo no filtro atual</h3>
          <p>Você pode atualizar manualmente pela engrenagem ou alterar os filtros acima.</p>
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

  const renderModal = () => {
    elements.settingsBackdrop.dataset.open = String(state.settingsOpen);
    elements.settingsModal.dataset.open = String(state.settingsOpen);
    elements.tokenInput.value = state.tokenValue;
    elements.clearToken.disabled = !state.settings.hasToken;
    elements.markAllRead.disabled = !(state.feed.stats?.unread > 0);
  };

  const render = () => {
    elements.overlay.dataset.open = String(state.open);
    elements.panel.dataset.open = String(state.open);
    elements.searchInput.value = state.search;
    elements.dateSelect.value = state.dateFilter;
    elements.sortSelect.value = state.sortDirection;
    elements.unreadCheckbox.checked = state.unreadOnly;
    renderStats();
    renderAlert();
    renderList();
    renderModal();
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
      state.feed.status = 'inactive';
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
      <header class="maximum-header-shell">
        <div class="maximum-header-row">
          <div class="maximum-brand-block">
            <h1 class="maximum-brand-title">
              <span class="maximum-brand-title--black">maximum</span><span class="maximum-brand-title--gradient">Notificações</span>
            </h1>
            <span class="maximum-page-label"></span>
          </div>
          <div class="maximum-header-actions">
            <div class="maximum-status-pill" data-tone="inactive">
              <span>Status:</span>
              <strong class="maximum-status-text">Inativo</strong>
            </div>
            <button type="button" class="maximum-icon-button" aria-label="Configurar chave da API">⚙</button>
            <button type="button" class="maximum-close-button">Fechar</button>
          </div>
        </div>
        <div class="maximum-header-divider"></div>
        <div class="maximum-kpis-grid">
          <article class="maximum-kpi-card">
            <span>Solicitações</span>
            <strong data-kpi="requests">0</strong>
          </article>
          <article class="maximum-kpi-card">
            <span>Processos</span>
            <strong data-kpi="processes">0</strong>
          </article>
          <article class="maximum-kpi-card">
            <span>Obrigações</span>
            <strong data-kpi="obligations">0</strong>
          </article>
          <article class="maximum-kpi-card">
            <span>Total</span>
            <strong data-kpi="total">0</strong>
          </article>
        </div>
        <div class="maximum-sync-row">
          <span class="maximum-sync-label">Ainda sem sincronização</span>
        </div>
      </header>

      <section class="maximum-toolbar">
        <div class="maximum-input-group maximum-input-group--wide">
          <label for="maximum-search">Barra de Busca</label>
          <input id="maximum-search" type="search" placeholder="Busque por empresa, processo, obrigação ou solicitação" />
        </div>
        <div class="maximum-input-group">
          <label for="maximum-date">Filtrar</label>
          <select id="maximum-date">
            <option value="all">Todas</option>
            <option value="today">Hoje</option>
            <option value="week">Últimos 7 dias</option>
            <option value="month">Este mês</option>
          </select>
        </div>
        <div class="maximum-input-group">
          <label for="maximum-sort">Ordenar</label>
          <select id="maximum-sort">
            <option value="desc">Mais recente</option>
            <option value="asc">Hora crescente</option>
          </select>
        </div>
        <label class="maximum-inline-checkbox">
          <input id="maximum-unread-only" type="checkbox" />
          Somente não lidas
        </label>
      </section>

      <section class="maximum-alert-slot"></section>

      <section class="maximum-content">
        <div class="maximum-notification-list"></div>
        <div class="maximum-content-footer"></div>
      </section>
    </aside>

    <div class="maximum-settings-backdrop" data-open="false"></div>
    <section class="maximum-settings-modal" data-open="false" aria-label="Modal de chave da API">
      <div class="maximum-settings-modal__header">
        <div>
          <h2>Configurar chave da API</h2>
          <p>Informe o token gerado no Acessórias pela engrenagem do canto superior direito.</p>
        </div>
        <button type="button" class="maximum-icon-button maximum-icon-button--close" aria-label="Fechar modal">✕</button>
      </div>
      <div class="maximum-settings-modal__body">
        <div class="maximum-input-group">
          <label for="maximum-token-input">Chave API</label>
          <input id="maximum-token-input" type="password" placeholder="Cole aqui a chave da API" autocomplete="off" />
        </div>
        <p class="maximum-modal-sync-info"></p>
      </div>
      <div class="maximum-settings-modal__actions">
        <button type="button" class="maximum-primary-button" data-action="save-token">Salvar chave</button>
        <button type="button" class="maximum-secondary-button" data-action="refresh">Atualizar agora</button>
        <button type="button" class="maximum-secondary-button" data-action="clear-token">Limpar chave</button>
        <button type="button" class="maximum-secondary-button" data-action="mark-all-read">Marcar tudo como lido</button>
      </div>
    </section>
  `;

  document.documentElement.appendChild(root);

  elements.toggle = root.querySelector('.maximum-toggle-button');
  elements.toggleBadge = root.querySelector('.maximum-toggle-badge');
  elements.overlay = root.querySelector('.maximum-overlay');
  elements.panel = root.querySelector('.maximum-panel');
  elements.closeButton = root.querySelector('.maximum-close-button');
  elements.statusText = root.querySelector('.maximum-status-text');
  elements.statusPill = root.querySelector('.maximum-status-pill');
  elements.settingsButton = root.querySelector('.maximum-icon-button');
  elements.pageLabel = root.querySelector('.maximum-page-label');
  elements.syncLabel = root.querySelector('.maximum-sync-label');
  elements.requests = root.querySelector('[data-kpi="requests"]');
  elements.processes = root.querySelector('[data-kpi="processes"]');
  elements.obligations = root.querySelector('[data-kpi="obligations"]');
  elements.total = root.querySelector('[data-kpi="total"]');
  elements.searchInput = root.querySelector('#maximum-search');
  elements.dateSelect = root.querySelector('#maximum-date');
  elements.sortSelect = root.querySelector('#maximum-sort');
  elements.unreadCheckbox = root.querySelector('#maximum-unread-only');
  elements.list = root.querySelector('.maximum-notification-list');
  elements.footer = root.querySelector('.maximum-content-footer');
  elements.alert = root.querySelector('.maximum-alert-slot');
  elements.settingsBackdrop = root.querySelector('.maximum-settings-backdrop');
  elements.settingsModal = root.querySelector('.maximum-settings-modal');
  elements.settingsClose = root.querySelector('.maximum-icon-button--close');
  elements.tokenInput = root.querySelector('#maximum-token-input');
  elements.saveToken = root.querySelector('[data-action="save-token"]');
  elements.clearToken = root.querySelector('[data-action="clear-token"]');
  elements.refreshButton = root.querySelector('[data-action="refresh"]');
  elements.markAllRead = root.querySelector('[data-action="mark-all-read"]');
  elements.modalSyncInfo = root.querySelector('.maximum-modal-sync-info');

  const setOpen = (value) => {
    state.open = value;
    render();
  };

  const setSettingsOpen = (value) => {
    state.settingsOpen = value;
    render();
  };

  elements.toggle.addEventListener('click', () => setOpen(!state.open));
  elements.overlay.addEventListener('click', () => setOpen(false));
  elements.closeButton.addEventListener('click', () => setOpen(false));
  elements.settingsButton.addEventListener('click', () => setSettingsOpen(true));
  elements.settingsBackdrop.addEventListener('click', () => setSettingsOpen(false));
  elements.settingsClose.addEventListener('click', () => setSettingsOpen(false));

  elements.saveToken.addEventListener('click', async () => {
    const token = elements.tokenInput.value.trim();
    state.tokenValue = token;
    elements.saveToken.disabled = true;

    try {
      const response = await runtimeMessage({ type: 'maximum:save-token', token });
      state.feed = response.feed;
      state.settings = response.settings;
      state.pageContext = response.pageContext || state.pageContext;
      setSettingsOpen(false);
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'inactive';
      render();
    } finally {
      elements.saveToken.disabled = false;
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
      state.feed.status = 'inactive';
      render();
    }
  });

  elements.clearToken.addEventListener('click', async () => {
    state.tokenValue = '';
    try {
      const response = await runtimeMessage({ type: 'maximum:clear-token' });
      state.feed = response.feed;
      state.settings = response.settings;
      render();
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'inactive';
      render();
    }
  });

  elements.markAllRead.addEventListener('click', async () => {
    try {
      const response = await runtimeMessage({ type: 'maximum:mark-all-read' });
      state.feed = response.feed;
      state.settings = response.settings;
      render();
    } catch (error) {
      state.feed.errorMessage = error.message;
      state.feed.status = 'inactive';
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
      state.feed.status = 'inactive';
      render();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.settingsOpen) {
      setSettingsOpen(false);
      return;
    }

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
