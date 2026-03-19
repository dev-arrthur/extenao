const API_BASE = 'https://api.acessorias.com';
const STORAGE_KEYS = {
  settings: 'maximum_settings',
  feed: 'maximum_feed',
  pageContext: 'maximum_page_context'
};
const POLL_ALARM = 'maximum-poll-alarm';
const POLL_INTERVAL_MINUTES = 3;
const COMPANY_SCAN_INTERVAL_MINUTES = 60;
const MAX_NOTIFICATIONS = 250;
const PAGE_LIMITS = {
  requests: 4,
  processes: 4,
  deliveries: 4,
  companies: 4
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await syncFeed('install');
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await syncFeed('startup');
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) {
    await syncFeed('alarm');
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case 'maximum:get-state':
      return getClientState();
    case 'maximum:save-token':
      return saveToken(message.token);
    case 'maximum:clear-token':
      return clearToken();
    case 'maximum:refresh':
      return refreshNow();
    case 'maximum:mark-read':
      return setNotificationReadState(message.notificationId, message.unread);
    case 'maximum:mark-all-read':
      return markAllRead();
    case 'maximum:update-page-context':
      return updatePageContext(message.payload || {});
    default:
      return getClientState();
  }
}

async function ensureAlarm() {
  const existingAlarm = await chrome.alarms.get(POLL_ALARM);
  if (!existingAlarm) {
    chrome.alarms.create(POLL_ALARM, {
      periodInMinutes: POLL_INTERVAL_MINUTES
    });
  }
}

function toIso(value) {
  if (!value) {
    return null;
  }

  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const dateTimeMatch = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dateTimeMatch) {
    const [, day, month, year, hour = '00', minute = '00', second = '00'] = dateTimeMatch;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).toISOString();
  }

  const dateMatch = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dateMatch) {
    const [, year, month, day, hour = '00', minute = '00', second = '00'] = dateMatch;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).toISOString();
  }

  return null;
}

function formatApiDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatApiDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${formatApiDate(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

function uniqueBy(items, makeKey) {
  const map = new Map();
  for (const item of items) {
    map.set(makeKey(item), item);
  }
  return Array.from(map.values());
}

function summarizeFeed(notifications) {
  return notifications.reduce((acc, notification) => {
    acc.total += 1;
    if (notification.unread) {
      acc.unread += 1;
    }
    acc.bySource[notification.source] = (acc.bySource[notification.source] || 0) + 1;
    return acc;
  }, {
    total: 0,
    unread: 0,
    bySource: {
      obligations: 0,
      processes: 0,
      requests: 0,
      companies: 0
    }
  });
}

async function getStoredState() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    settings: stored[STORAGE_KEYS.settings] || {
      apiToken: '',
      lastTokenUpdatedAt: null
    },
    feed: stored[STORAGE_KEYS.feed] || {
      status: 'needs_token',
      notifications: [],
      errorMessage: '',
      tokenMissing: true,
      syncing: false,
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      stats: summarizeFeed([]),
      companySnapshot: {},
      lastCompaniesSyncAt: null
    },
    pageContext: stored[STORAGE_KEYS.pageContext] || {}
  };
}

async function persistFeed(feed) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.feed]: {
      ...feed,
      stats: summarizeFeed(feed.notifications || [])
    }
  });
}

async function getClientState() {
  const { settings, feed, pageContext } = await getStoredState();
  return {
    settings: {
      hasToken: Boolean(settings.apiToken),
      lastTokenUpdatedAt: settings.lastTokenUpdatedAt
    },
    feed,
    pageContext
  };
}

async function saveToken(token) {
  const normalizedToken = String(token || '').trim();
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: {
      apiToken: normalizedToken,
      lastTokenUpdatedAt: normalizedToken ? new Date().toISOString() : null
    }
  });
  await syncFeed('token-updated', { forceFullSync: true });
  return getClientState();
}

async function clearToken() {
  const { feed } = await getStoredState();
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: {
      apiToken: '',
      lastTokenUpdatedAt: null
    }
  });
  await persistFeed({
    ...feed,
    status: 'needs_token',
    tokenMissing: true,
    syncing: false,
    errorMessage: '',
    notifications: [],
    stats: summarizeFeed([])
  });
  return getClientState();
}

async function refreshNow() {
  await syncFeed('manual-refresh', { forceFullSync: true });
  return getClientState();
}

async function updatePageContext(payload) {
  const nextContext = {
    currentTitle: payload.currentTitle || '',
    currentUrl: payload.currentUrl || '',
    inferredUser: payload.inferredUser || '',
    updatedAt: new Date().toISOString()
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.pageContext]: nextContext
  });

  return { pageContext: nextContext };
}

async function setNotificationReadState(notificationId, unread) {
  const { feed } = await getStoredState();
  const notifications = (feed.notifications || []).map((item) => item.id === notificationId
    ? { ...item, unread: Boolean(unread) }
    : item);

  await persistFeed({
    ...feed,
    notifications
  });

  return getClientState();
}

async function markAllRead() {
  const { feed } = await getStoredState();
  const notifications = (feed.notifications || []).map((item) => ({
    ...item,
    unread: false
  }));

  await persistFeed({
    ...feed,
    notifications
  });

  return getClientState();
}

async function fetchJson(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`API ${response.status}: ${responseText.slice(0, 180) || 'Falha ao consultar a API.'}`);
  }

  return response.json();
}

async function fetchPaged(getPath, token, maxPages) {
  const allItems = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchJson(getPath(page), token);
    const items = Array.isArray(data) ? data : [];
    if (!items.length) {
      break;
    }

    allItems.push(...items);
  }

  return allItems;
}

function buildRequestNotifications(requests, lastSuccessfulSyncAt) {
  const cutoff = new Date(lastSuccessfulSyncAt || Date.now() - 24 * 60 * 60 * 1000).getTime();

  return requests
    .filter((request) => {
      const changedAt = toIso(request.SolDHUAt || request.SolDHAbertura);
      return changedAt && new Date(changedAt).getTime() > cutoff;
    })
    .map((request) => {
      const latestInteraction = Array.isArray(request.SolInteracoes)
        ? request.SolInteracoes.flat().filter(Boolean).sort((a, b) => new Date(toIso(b.CmtDH) || 0) - new Date(toIso(a.CmtDH) || 0))[0]
        : null;
      const createdAt = toIso(request.SolDHUAt || latestInteraction?.CmtDH || request.SolDHAbertura) || new Date().toISOString();
      const status = request.SolStatus || 'Sem status';
      const assignees = [
        ...(request.SolOfficeResp || []),
        ...(request.SolEmpResp || [])
      ].filter(Boolean).join(', ');

      return {
        id: `request:${request.SolID}:${request.SolDHUAt || request.SolDHAbertura}`,
        source: 'requests',
        category: latestInteraction ? 'comment' : 'update',
        title: `Solicitação atualizada: ${request.SolAssunto || `#${request.SolID}`}`,
        message: latestInteraction?.CmtText || `Status ${status}${assignees ? ` • responsáveis: ${assignees}` : ''}`,
        context: `${request.EmpNome || 'Empresa não identificada'} • ${request.DptoNome || 'Sem departamento'}`,
        author: latestInteraction?.CmtUsuario || request.SolUsuario || 'Sistema Acessórias',
        createdAt,
        unread: true,
        meta: {
          status,
          sourceId: request.SolID,
          company: request.EmpNome || '',
          department: request.DptoNome || ''
        }
      };
    });
}

function buildProcessNotifications(processes, lastSuccessfulSyncAt) {
  const cutoff = new Date(lastSuccessfulSyncAt || Date.now() - 24 * 60 * 60 * 1000).getTime();

  return processes
    .filter((process) => {
      const changedAt = toIso(process.DtLastDH);
      return changedAt && new Date(changedAt).getTime() > cutoff;
    })
    .map((process) => ({
      id: `process:${process.ProcID}:${process.DtLastDH}`,
      source: 'processes',
      category: 'process',
      title: `Processo alterado: ${process.ProcTitulo || process.ProcNome || `#${process.ProcID}`}`,
      message: `${process.ProcStatus || 'Sem status'} • ${process.ProcPorcentagem || 'Sem progresso'} • gestor ${process.ProcGestor || 'não informado'}`,
      context: `${process.EmpNome || 'Empresa não identificada'} • ${process.ProcDepartamento || 'Sem departamento'}`,
      author: process.ProcCriador || process.ProcGestor || 'Sistema Acessórias',
      createdAt: toIso(process.DtLastDH) || new Date().toISOString(),
      unread: true,
      meta: {
        status: process.ProcStatus || '',
        progress: process.ProcPorcentagem || '',
        sourceId: process.ProcID,
        company: process.EmpNome || ''
      }
    }));
}

function buildDeliveryNotifications(deliveryGroups, lastSuccessfulSyncAt) {
  const cutoff = new Date(lastSuccessfulSyncAt || Date.now() - 24 * 60 * 60 * 1000).getTime();

  return deliveryGroups.flatMap((company) => (company.Entregas || [])
    .filter((delivery) => {
      const changedAt = toIso(delivery.EntLastDH || delivery.EntDtEntrega || delivery.EntDtPrazo);
      return changedAt && new Date(changedAt).getTime() > cutoff;
    })
    .map((delivery) => ({
      id: `delivery:${company.Identificador}:${delivery.Config?.EntID || delivery.Nome}:${delivery.EntLastDH || delivery.EntDtPrazo}`,
      source: 'obligations',
      category: 'obligation',
      title: `Obrigação/entrega alterada: ${delivery.Nome}`,
      message: `${delivery.Status || 'Sem status'} • prazo ${delivery.EntDtPrazo || 'não informado'}${delivery.EntDtEntrega && delivery.EntDtEntrega !== '0000-00-00' ? ` • entrega ${delivery.EntDtEntrega}` : ''}`,
      context: `${company.Razao || company.Fantasia || company.Identificador} • ${delivery.Config?.DptoNome || 'Sem departamento'}`,
      author: delivery.Config?.RespEntrega || delivery.Config?.RespPrazo || 'Sistema Acessórias',
      createdAt: toIso(delivery.EntLastDH || delivery.EntDtEntrega || delivery.EntDtPrazo) || new Date().toISOString(),
      unread: true,
      meta: {
        status: delivery.Status || '',
        deadline: delivery.EntDtPrazo || '',
        sourceId: delivery.Config?.EntID || delivery.Nome,
        company: company.Razao || company.Fantasia || ''
      }
    })));
}

function hashObligationStatus(obligation) {
  return [
    obligation.Status,
    obligation.Entregues,
    obligation.Atrasadas,
    obligation.Proximos30D,
    obligation['Futuras30+']
  ].join('|');
}

function buildCompanyNotifications(companies, previousSnapshot, shouldCreateNotifications) {
  const nextSnapshot = {};
  const notifications = [];

  for (const company of companies) {
    const companyKey = company.Identificador || company.ID || company.Razao;
    const obligations = Array.isArray(company.Obrigacoes) ? company.Obrigacoes : [];
    nextSnapshot[companyKey] = {};

    for (const obligation of obligations) {
      const obligationKey = obligation.Nome;
      const nextHash = hashObligationStatus(obligation);
      nextSnapshot[companyKey][obligationKey] = nextHash;
      const previousHash = previousSnapshot?.[companyKey]?.[obligationKey];

      if (shouldCreateNotifications && previousHash && previousHash !== nextHash) {
        notifications.push({
          id: `company:${companyKey}:${obligationKey}:${nextHash}:${Date.now()}`,
          source: 'companies',
          category: 'summary',
          title: `Mudança em obrigação consolidada: ${obligation.Nome}`,
          message: `Status ${obligation.Status || 'sem status'} • atrasadas ${obligation.Atrasadas || '0'} • próximas 30d ${obligation.Proximos30D || '0'}`,
          context: `${company.Razao || company.Fantasia || company.Identificador} • visão consolidada das obrigações`,
          author: 'Sistema Acessórias',
          createdAt: new Date().toISOString(),
          unread: true,
          meta: {
            status: obligation.Status || '',
            company: company.Razao || company.Fantasia || '',
            sourceId: obligation.Nome
          }
        });
      }
    }
  }

  return {
    notifications,
    snapshot: nextSnapshot
  };
}

async function syncFeed(reason, options = {}) {
  const { settings, feed } = await getStoredState();

  if (!settings.apiToken) {
    await persistFeed({
      ...feed,
      status: 'needs_token',
      tokenMissing: true,
      syncing: false,
      errorMessage: '',
      notifications: []
    });
    return;
  }

  await persistFeed({
    ...feed,
    syncing: true,
    tokenMissing: false,
    status: 'syncing',
    errorMessage: ''
  });

  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const lastSuccessfulSyncAt = options.forceFullSync ? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString() : (feed.lastSuccessfulSyncAt || new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
    const lastSyncDateTime = formatApiDateTime(new Date(lastSuccessfulSyncAt));
    const shouldRefreshCompanies = !feed.lastCompaniesSyncAt
      || (new Date(now).getTime() - new Date(feed.lastCompaniesSyncAt).getTime()) >= COMPANY_SCAN_INTERVAL_MINUTES * 60 * 1000
      || options.forceFullSync;

    const [requests, processes, deliveries, companies] = await Promise.all([
      fetchPaged((page) => `/requests/ListAll?SolUltAtIni=${formatApiDate(yesterday)}&SolUltAtFim=${formatApiDate(now)}&Pagina=${page}`, settings.apiToken, PAGE_LIMITS.requests),
      fetchPaged((page) => `/processes/ListAll?DtLastDH=${encodeURIComponent(lastSyncDateTime)}&Pagina=${page}`, settings.apiToken, PAGE_LIMITS.processes),
      fetchPaged((page) => `/deliveries/ListAll?DtInitial=${formatApiDate(yesterday)}&DtFinal=${formatApiDate(now)}&DtLastDH=${encodeURIComponent(lastSyncDateTime)}&situation=pending,read,delivered&Pagina=${page}`, settings.apiToken, PAGE_LIMITS.deliveries),
      shouldRefreshCompanies
        ? fetchPaged((page) => `/companies/ListAll?obligations=&departments=&Pagina=${page}`, settings.apiToken, PAGE_LIMITS.companies)
        : Promise.resolve([])
    ]);

    const companyDiff = buildCompanyNotifications(companies, feed.companySnapshot || {}, shouldRefreshCompanies && Boolean(feed.lastCompaniesSyncAt));

    const incomingNotifications = uniqueBy([
      ...buildDeliveryNotifications(deliveries, lastSuccessfulSyncAt),
      ...buildProcessNotifications(processes, lastSuccessfulSyncAt),
      ...buildRequestNotifications(requests, lastSuccessfulSyncAt),
      ...companyDiff.notifications
    ], (item) => item.id);

    const existingUnreadMap = new Map((feed.notifications || []).map((item) => [item.id, item.unread]));
    const merged = uniqueBy([
      ...incomingNotifications.map((item) => ({
        ...item,
        unread: existingUnreadMap.has(item.id) ? existingUnreadMap.get(item.id) : item.unread
      })),
      ...(feed.notifications || [])
    ], (item) => item.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, MAX_NOTIFICATIONS);

    await persistFeed({
      ...feed,
      syncing: false,
      tokenMissing: false,
      status: incomingNotifications.length ? 'updated' : 'idle',
      errorMessage: '',
      notifications: merged,
      companySnapshot: shouldRefreshCompanies ? companyDiff.snapshot : (feed.companySnapshot || {}),
      lastCompaniesSyncAt: shouldRefreshCompanies ? now.toISOString() : feed.lastCompaniesSyncAt,
      lastSyncAt: now.toISOString(),
      lastSuccessfulSyncAt: now.toISOString(),
      syncReason: reason
    });
  } catch (error) {
    await persistFeed({
      ...feed,
      syncing: false,
      tokenMissing: false,
      status: 'error',
      errorMessage: error.message,
      lastSyncAt: new Date().toISOString()
    });
  }
}
