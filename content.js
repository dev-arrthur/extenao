(() => {
  if (window.maximumNotificacoesInjected) {
    return;
  }
  window.maximumNotificacoesInjected = true;

  const STORAGE_KEY = 'maximum-notificacoes-state';
  const root = document.createElement('div');
  root.id = 'maximum-notificacoes-root';

  const inferUserName = () => {
    const metaUser = document.querySelector('meta[name="author"], meta[name="user"], meta[property="profile:username"]');
    if (metaUser?.content) {
      return metaUser.content.trim();
    }

    const candidates = [
      document.body?.dataset?.user,
      document.body?.dataset?.username,
      document.documentElement?.lang ? `usuário ${document.documentElement.lang.toUpperCase()}` : '',
      document.title.split('|')[0],
      document.title.split('-')[0],
      'usuário atual'
    ].map((value) => String(value || '').trim()).filter(Boolean);

    return candidates[0] || 'usuário atual';
  };

  const userName = inferUserName();
  const now = new Date();

  const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  const daysAgo = (days, hour) => {
    const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };

  const baseNotifications = [
    {
      id: 'notif-1',
      type: 'comment',
      title: 'Novo comentário em uma tarefa acompanhada',
      message: `A equipe adicionou um comentário em uma atividade ligada a ${userName} e marcou os próximos passos para revisão ainda hoje.`,
      context: 'Projeto / Sprint principal',
      author: 'Equipe de Produto',
      createdAt: hoursAgo(1),
      unread: true
    },
    {
      id: 'notif-2',
      type: 'mention',
      title: 'Você foi mencionado em uma discussão',
      message: `Um colaborador marcou ${userName} pedindo validação sobre uma mudança que impacta entregas e histórico recente.`,
      context: 'Discussão / Aprovação',
      author: 'Marina Costa',
      createdAt: hoursAgo(5),
      unread: true
    },
    {
      id: 'notif-3',
      type: 'update',
      title: 'Alteração detectada em item relacionado ao usuário',
      message: `Foi registrada uma atualização em um conteúdo que possui vínculo direto com ${userName}, incluindo data, status e responsável.`,
      context: 'Atualização / Relacionamentos',
      author: 'Sistema Maximum',
      createdAt: daysAgo(1, 10),
      unread: false
    },
    {
      id: 'notif-4',
      type: 'comment',
      title: 'Comentaram novamente em um registro seu',
      message: `Houve uma nova interação em um item criado por ${userName}, com observações adicionais e ajuste do prazo previsto.`,
      context: 'Comentário / Histórico',
      author: 'Rafael Lima',
      createdAt: daysAgo(3, 16),
      unread: false
    },
    {
      id: 'notif-5',
      type: 'update',
      title: 'Mudança consolidada em processo monitorado',
      message: `O sistema consolidou mudanças recentes em tudo o que está relacionado a ${userName}, permitindo uma revisão rápida das últimas alterações.`,
      context: 'Resumo / Consolidação',
      author: 'Sistema Maximum',
      createdAt: daysAgo(8, 9),
      unread: true
    }
  ];

  const loadState = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  };

  const saveState = (state) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  };

  const persistedState = loadState();

  const state = {
    open: false,
    search: '',
    unreadOnly: false,
    dateFilter: 'all',
    sortDirection: 'desc',
    notifications: baseNotifications.map((notification) => ({
      ...notification,
      unread: persistedState[notification.id] ?? notification.unread
    }))
  };

  const getDateFilterPredicate = (filterValue) => {
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    switch (filterValue) {
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

  const formatDate = (value) => new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));

  const formatHourOnly = (value) => new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));

  const badgeClassByType = {
    comment: 'maximum-notificacoes-badge--comment',
    mention: 'maximum-notificacoes-badge--mention',
    update: 'maximum-notificacoes-badge--update'
  };

  const badgeLabelByType = {
    comment: 'Comentário',
    mention: 'Menção',
    update: 'Alteração'
  };

  const elements = {
    toggle: null,
    badge: null,
    overlay: null,
    panel: null,
    list: null,
    footer: null,
    unreadCheckbox: null,
    dateFilter: null,
    sortDirection: null,
    search: null,
    statTotal: null,
    statUnread: null,
    statComments: null
  };

  const getFilteredNotifications = () => {
    const query = state.search.trim().toLowerCase();
    const datePredicate = getDateFilterPredicate(state.dateFilter);

    return state.notifications
      .filter((item) => !state.unreadOnly || item.unread)
      .filter((item) => datePredicate(new Date(item.createdAt)))
      .filter((item) => {
        if (!query) {
          return true;
        }

        return [item.title, item.message, item.context, item.author, badgeLabelByType[item.type]]
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        const timeA = new Date(a.createdAt).getTime();
        const timeB = new Date(b.createdAt).getTime();
        return state.sortDirection === 'asc' ? timeA - timeB : timeB - timeA;
      });
  };

  const getUnreadCount = () => state.notifications.filter((item) => item.unread).length;

  const toggleReadState = (notificationId) => {
    state.notifications = state.notifications.map((item) => item.id === notificationId
      ? { ...item, unread: !item.unread }
      : item);

    const nextPersisted = state.notifications.reduce((acc, item) => {
      acc[item.id] = item.unread;
      return acc;
    }, {});

    saveState(nextPersisted);
    render();
  };

  const renderList = () => {
    const notifications = getFilteredNotifications();

    if (!elements.list || !elements.footer) {
      return;
    }

    if (notifications.length === 0) {
      elements.list.innerHTML = `
        <div class="maximum-notificacoes-empty">
          <strong>Nenhuma notificação encontrada.</strong>
          <p>Ajuste os filtros para visualizar alterações, comentários e menções relacionadas ao usuário.</p>
        </div>
      `;
      elements.footer.textContent = '0 resultados exibidos';
      return;
    }

    elements.list.innerHTML = notifications.map((item) => `
      <article class="maximum-notificacoes-item" data-unread="${item.unread}">
        <span class="maximum-notificacoes-dot" aria-hidden="true"></span>
        <div>
          <div class="maximum-notificacoes-item-head">
            <span class="maximum-notificacoes-badge ${badgeClassByType[item.type]}">${badgeLabelByType[item.type]}</span>
            <span class="maximum-notificacoes-time">${formatDate(item.createdAt)}</span>
          </div>
          <h3 class="maximum-notificacoes-item-title">${item.title}</h3>
          <p class="maximum-notificacoes-item-message">${item.message}</p>
          <div class="maximum-notificacoes-meta">
            <span><strong>Origem:</strong> ${item.context}</span>
            <span><strong>Autor:</strong> ${item.author}</span>
          </div>
        </div>
        <div class="maximum-notificacoes-item-actions">
          <span class="maximum-notificacoes-time">${formatHourOnly(item.createdAt)}</span>
          <button class="maximum-notificacoes-action-btn" data-action="toggle-read" data-id="${item.id}">
            ${item.unread ? 'Marcar como lida' : 'Marcar como não lida'}
          </button>
        </div>
      </article>
    `).join('');

    const unreadCount = notifications.filter((item) => item.unread).length;
    elements.footer.textContent = `${notifications.length} resultados exibidos • ${unreadCount} não lidas nesta visualização`;
  };

  const renderStats = () => {
    const total = state.notifications.length;
    const unread = getUnreadCount();
    const commentsAndMentions = state.notifications.filter((item) => item.type !== 'update').length;

    if (elements.badge) {
      elements.badge.textContent = unread;
    }
    if (elements.statTotal) {
      elements.statTotal.textContent = total;
    }
    if (elements.statUnread) {
      elements.statUnread.textContent = unread;
    }
    if (elements.statComments) {
      elements.statComments.textContent = commentsAndMentions;
    }
  };

  const render = () => {
    if (!elements.overlay || !elements.panel) {
      return;
    }

    elements.overlay.dataset.open = String(state.open);
    elements.panel.dataset.open = String(state.open);
    elements.unreadCheckbox.checked = state.unreadOnly;
    elements.dateFilter.value = state.dateFilter;
    elements.sortDirection.value = state.sortDirection;
    elements.search.value = state.search;

    renderStats();
    renderList();
  };

  root.innerHTML = `
    <button class="maximum-notificacoes-toggle" type="button" aria-label="Abrir painel de notificações">
      <span>🔔</span>
      <span class="maximum-notificacoes-toggle-badge">0</span>
    </button>
    <div class="maximum-notificacoes-overlay" data-open="false"></div>
    <aside class="maximum-notificacoes-panel" data-open="false" aria-label="Painel de notificações">
      <header class="maximum-notificacoes-header">
        <div class="maximum-notificacoes-header-top">
          <div>
            <h1 class="maximum-notificacoes-title">maximumNotificações</h1>
            <p class="maximum-notificacoes-subtitle">Divisor</p>
          </div>
          <button class="maximum-notificacoes-close" type="button">Fechar ✕</button>
        </div>
        <p class="maximum-notificacoes-description">
          Mostra as notificações de atualizações de tudo que está relacionado àquele usuário ou que comentarem nele,
          reunindo alterações, menções e comentários em um painel lateral completo.
        </p>
        <section class="maximum-notificacoes-summary" aria-label="Resumo das notificações">
          <div class="maximum-notificacoes-stat">
            <span class="maximum-notificacoes-stat-label">Total de alterações</span>
            <strong class="maximum-notificacoes-stat-value" data-stat="total">0</strong>
          </div>
          <div class="maximum-notificacoes-stat">
            <span class="maximum-notificacoes-stat-label">Não lidas</span>
            <strong class="maximum-notificacoes-stat-value" data-stat="unread">0</strong>
          </div>
          <div class="maximum-notificacoes-stat">
            <span class="maximum-notificacoes-stat-label">Comentários e menções</span>
            <strong class="maximum-notificacoes-stat-value" data-stat="comments">0</strong>
          </div>
        </section>
      </header>
      <section class="maximum-notificacoes-toolbar" aria-label="Filtros">
        <div class="maximum-notificacoes-search">
          <label for="maximum-notificacoes-search">Buscar</label>
          <input id="maximum-notificacoes-search" class="maximum-notificacoes-input" type="search" placeholder="Buscar por título, autor ou contexto" />
        </div>
        <div class="maximum-notificacoes-field">
          <label for="maximum-notificacoes-date">Filtrar por data</label>
          <select id="maximum-notificacoes-date" class="maximum-notificacoes-select">
            <option value="all">Todas as datas</option>
            <option value="today">Hoje</option>
            <option value="week">Últimos 7 dias</option>
            <option value="month">Este mês</option>
          </select>
        </div>
        <div class="maximum-notificacoes-field">
          <label for="maximum-notificacoes-sort">Ordenar por hora</label>
          <select id="maximum-notificacoes-sort" class="maximum-notificacoes-select">
            <option value="desc">Mais recente primeiro</option>
            <option value="asc">Hora crescente</option>
          </select>
        </div>
        <label class="maximum-notificacoes-checkbox">
          <input id="maximum-notificacoes-unread" type="checkbox" />
          Somente não lidas
        </label>
      </section>
      <section class="maximum-notificacoes-content">
        <div class="maximum-notificacoes-list"></div>
        <div class="maximum-notificacoes-footer"></div>
      </section>
    </aside>
  `;

  document.documentElement.appendChild(root);

  elements.toggle = root.querySelector('.maximum-notificacoes-toggle');
  elements.badge = root.querySelector('.maximum-notificacoes-toggle-badge');
  elements.overlay = root.querySelector('.maximum-notificacoes-overlay');
  elements.panel = root.querySelector('.maximum-notificacoes-panel');
  elements.list = root.querySelector('.maximum-notificacoes-list');
  elements.footer = root.querySelector('.maximum-notificacoes-footer');
  elements.unreadCheckbox = root.querySelector('#maximum-notificacoes-unread');
  elements.dateFilter = root.querySelector('#maximum-notificacoes-date');
  elements.sortDirection = root.querySelector('#maximum-notificacoes-sort');
  elements.search = root.querySelector('#maximum-notificacoes-search');
  elements.statTotal = root.querySelector('[data-stat="total"]');
  elements.statUnread = root.querySelector('[data-stat="unread"]');
  elements.statComments = root.querySelector('[data-stat="comments"]');

  const setOpen = (value) => {
    state.open = value;
    render();
  };

  elements.toggle.addEventListener('click', () => setOpen(!state.open));
  root.querySelector('.maximum-notificacoes-close').addEventListener('click', () => setOpen(false));
  elements.overlay.addEventListener('click', () => setOpen(false));

  elements.unreadCheckbox.addEventListener('change', (event) => {
    state.unreadOnly = event.target.checked;
    render();
  });

  elements.dateFilter.addEventListener('change', (event) => {
    state.dateFilter = event.target.value;
    render();
  });

  elements.sortDirection.addEventListener('change', (event) => {
    state.sortDirection = event.target.value;
    render();
  });

  elements.search.addEventListener('input', (event) => {
    state.search = event.target.value;
    render();
  });

  elements.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="toggle-read"]');
    if (!button) {
      return;
    }

    toggleReadState(button.dataset.id);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.open) {
      setOpen(false);
    }
  });

  render();
})();
