/**
 * Ankita PubSub Dashboard - Enhanced Frontend Application
 */

class PubSubDashboard {
  constructor() {
    this.ws = null;
    this.apiKey = null;
    this.apiKeys = null;
    this.isConnected = false;
    this.autoScroll = true;
    this.autoRefresh = true;
    this.messages = [];
    this.allMessages = [];
    this.maxMessages = 500;
    this.topics = [];
    this.subscribers = [];
    this.consumerGroups = [];
    this.dlqMessages = [];
    this.publishHistory = [];
    this.currentView = 'overview';
    this.startTime = Date.now();

    // Charts
    this.throughputChart = null;
    this.topicsChart = null;
    this.msgRateChart = null;
    this.msgRateData = [];

    // Metrics history for trends
    this.metricsHistory = [];

    this.init();
  }

  async init() {
    // Get demo API keys
    await this.fetchApiKeys();

    // Connect WebSocket
    this.connect();

    // Setup event listeners
    this.setupEventListeners();

    // Setup navigation
    this.setupNavigation();

    // Initialize charts
    this.initCharts();

    // Start uptime counter
    this.startUptimeCounter();

    // Load saved settings
    this.loadSettings();
  }

  async fetchApiKeys() {
    try {
      const response = await fetch('/api/keys/demo');
      const keys = await response.json();
      this.apiKeys = keys;
      this.apiKey = keys.admin;
      console.log('API keys loaded');
    } catch (error) {
      console.error('Failed to fetch API keys:', error);
    }
  }

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    this.updateConnectionStatus('connecting');
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.updateConnectionStatus('connected');

      // Authenticate
      this.send({ type: 'auth', payload: this.apiKey });
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.updateConnectionStatus('disconnected');
      this.isConnected = false;

      // Reconnect after 3 seconds
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.updateConnectionStatus('disconnected');
    };
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'auth':
        if (data.payload?.success) {
          this.isConnected = true;
          console.log('Authenticated as:', data.payload.clientId);

          // Subscribe to all topics for monitoring
          this.send({ type: 'subscribe', payload: ['#'] });

          // Request initial metrics
          this.send({ type: 'metrics' });

          // Request API keys
          this.send({ type: 'apikeys:list' });

          // Request consumer groups
          this.send({ type: 'consumergroups:list' });
        }
        break;

      case 'metrics':
        this.updateMetrics(data.payload);
        break;

      case 'message':
        this.addMessage(data.payload);
        break;

      case 'publish':
        if (data.payload?.success !== false) {
          this.showToast('Message published successfully', 'success');
          this.addToPublishHistory(data.payload);
        }
        break;

      case 'error':
        console.error('Server error:', data.error);
        this.showToast(data.error, 'error');
        break;

      case 'reply':
        this.handleReply(data);
        break;

      case 'apikeys:list':
        this.renderApiKeysList(data.payload);
        break;

      case 'consumergroups:list':
        this.consumerGroups = data.payload || [];
        this.renderConsumerGroups();
        break;

      case 'dlq:list':
        this.dlqMessages = data.payload || [];
        this.renderDLQ();
        break;
    }
  }

  updateConnectionStatus(status) {
    const indicator = document.getElementById('connectionIndicator');
    const dot = indicator.querySelector('.connection-dot');
    const text = indicator.querySelector('.connection-text');

    indicator.className = 'connection-indicator ' + status;

    switch (status) {
      case 'connected':
        text.textContent = 'Connected';
        break;
      case 'disconnected':
        text.textContent = 'Disconnected';
        break;
      case 'connecting':
        text.textContent = 'Connecting...';
        break;
    }
  }

  updateMetrics(data) {
    const { metrics, topics, subscribers } = data;

    // Store topics and subscribers
    this.topics = topics || [];
    this.subscribers = subscribers || [];

    // Update sidebar badges
    document.getElementById('topicsBadge').textContent = metrics.totalTopics;
    document.getElementById('subscribersBadge').textContent = metrics.activeConnections;
    document.getElementById('messagesBadge').textContent = this.formatNumber(metrics.totalMessages);
    document.getElementById('dlqBadge').textContent = metrics.deadLetterCount;

    // Update header stats
    document.getElementById('headerMsgRate').textContent = metrics.messagesPerSecond.toFixed(1);

    // Update overview stats
    document.getElementById('statTotalMessages').textContent = this.formatNumber(metrics.totalMessages);
    document.getElementById('statMsgPerSec').textContent = metrics.messagesPerSecond.toFixed(1);
    document.getElementById('statTopics').textContent = metrics.totalTopics;
    document.getElementById('statConnections').textContent = metrics.activeConnections;
    document.getElementById('statQueued').textContent = metrics.queuedMessages;
    document.getElementById('statDLQ').textContent = metrics.deadLetterCount;

    // Store metrics for trend calculation
    this.metricsHistory.push({ ...metrics, timestamp: Date.now() });
    if (this.metricsHistory.length > 60) this.metricsHistory.shift();

    // Calculate trends
    this.updateTrends(metrics);

    // Update charts
    this.updateCharts(metrics, topics);

    // Update top topics list
    this.updateTopTopics(topics);

    // Update topic filter dropdown
    this.updateTopicFilter(topics);

    // Update views
    this.updateTopicsView(topics);
    this.updateSubscribersView(subscribers);

    // Update DLQ count
    document.getElementById('dlqCount').textContent = metrics.deadLetterCount;
  }

  updateTrends(metrics) {
    if (this.metricsHistory.length < 2) return;

    const prev = this.metricsHistory[0];
    const current = metrics;

    const diff = current.totalMessages - prev.totalMessages;
    const percentChange = prev.totalMessages > 0 ? ((diff / prev.totalMessages) * 100).toFixed(1) : 0;

    const trendEl = document.getElementById('statMessagesTrend');
    if (trendEl) {
      trendEl.textContent = (diff >= 0 ? '+' : '') + percentChange + '%';
      trendEl.parentElement.className = 'stat-trend ' + (diff >= 0 ? 'up' : 'down');
    }
  }

  initCharts() {
    // Throughput Chart
    const throughputCtx = document.getElementById('throughputChart')?.getContext('2d');
    if (throughputCtx) {
      this.throughputChart = new Chart(throughputCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Published',
              data: [],
              borderColor: '#0071D9',
              backgroundColor: 'rgba(0, 113, 217, 0.1)',
              fill: true,
              tension: 0.4
            },
            {
              label: 'Delivered',
              data: [],
              borderColor: '#10b981',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              fill: true,
              tension: 0.4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            x: {
              display: true,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: 'rgba(255,255,255,0.5)' }
            },
            y: {
              display: true,
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: { color: 'rgba(255,255,255,0.5)' },
              beginAtZero: true
            }
          }
        }
      });
    }

    // Topics Distribution Chart
    const topicsCtx = document.getElementById('topicsChart')?.getContext('2d');
    if (topicsCtx) {
      this.topicsChart = new Chart(topicsCtx, {
        type: 'doughnut',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: [
              '#0071D9',
              '#10b981',
              '#f59e0b',
              '#8b5cf6',
              '#ec4899',
              '#06b6d4',
              '#f97316',
              '#84cc16'
            ],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'right',
              labels: {
                color: 'rgba(255,255,255,0.7)',
                usePointStyle: true,
                padding: 15
              }
            }
          }
        }
      });
    }

    // Mini message rate chart
    const msgRateCtx = document.getElementById('msgRateChart')?.getContext('2d');
    if (msgRateCtx) {
      this.msgRateChart = new Chart(msgRateCtx, {
        type: 'line',
        data: {
          labels: Array(20).fill(''),
          datasets: [{
            data: Array(20).fill(0),
            borderColor: '#10b981',
            borderWidth: 2,
            fill: false,
            tension: 0.4,
            pointRadius: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            y: { display: false, beginAtZero: true }
          }
        }
      });
    }
  }

  updateCharts(metrics, topics) {
    // Update throughput chart
    if (this.throughputChart) {
      const now = new Date().toLocaleTimeString();
      this.throughputChart.data.labels.push(now);
      this.throughputChart.data.datasets[0].data.push(metrics.messagesPerSecond);
      this.throughputChart.data.datasets[1].data.push(metrics.messagesPerSecond * 0.95); // Simulate delivered

      // Keep last 20 data points
      if (this.throughputChart.data.labels.length > 20) {
        this.throughputChart.data.labels.shift();
        this.throughputChart.data.datasets[0].data.shift();
        this.throughputChart.data.datasets[1].data.shift();
      }

      this.throughputChart.update('none');
    }

    // Update topics chart
    if (this.topicsChart && topics?.length > 0) {
      const topTopics = topics.slice(0, 8);
      this.topicsChart.data.labels = topTopics.map(t => t.name);
      this.topicsChart.data.datasets[0].data = topTopics.map(t => t.messageCount);
      this.topicsChart.update('none');
    }

    // Update mini rate chart
    if (this.msgRateChart) {
      this.msgRateData.push(metrics.messagesPerSecond);
      if (this.msgRateData.length > 20) this.msgRateData.shift();

      this.msgRateChart.data.datasets[0].data = [...this.msgRateData];
      while (this.msgRateChart.data.datasets[0].data.length < 20) {
        this.msgRateChart.data.datasets[0].data.unshift(0);
      }
      this.msgRateChart.update('none');
    }
  }

  updateTopTopics(topics) {
    const container = document.getElementById('topTopicsList');
    if (!container) return;

    if (!topics || topics.length === 0) {
      container.innerHTML = '<div class="empty-state small">No topics yet</div>';
      return;
    }

    const sortedTopics = [...topics].sort((a, b) => b.messageCount - a.messageCount).slice(0, 5);
    const maxCount = sortedTopics[0]?.messageCount || 1;

    container.innerHTML = sortedTopics.map(topic => {
      const percentage = (topic.messageCount / maxCount) * 100;
      return `
        <div class="top-topic-item">
          <div class="top-topic-header">
            <span class="top-topic-name">${topic.name}</span>
            <span class="top-topic-count">${this.formatNumber(topic.messageCount)}</span>
          </div>
          <div class="top-topic-bar">
            <div class="top-topic-bar-fill" style="width: ${percentage}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  updateTopicFilter(topics) {
    const select = document.getElementById('topicFilter');
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = '<option value="">All Topics</option>' +
      (topics || []).map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    select.value = currentValue;
  }

  addMessage(message) {
    this.messages.unshift(message);
    this.allMessages.unshift(message);

    // Limit messages
    if (this.messages.length > this.maxMessages) {
      this.messages.pop();
    }
    if (this.allMessages.length > 10000) {
      this.allMessages.pop();
    }

    // Update live feed if on overview
    if (this.currentView === 'overview') {
      this.renderLiveFeed();
    }

    // Update messages table if on messages view
    if (this.currentView === 'messages') {
      this.renderMessagesTable();
    }
  }

  renderLiveFeed() {
    const container = document.getElementById('liveFeed');
    if (!container) return;

    if (this.messages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <p>Waiting for messages...</p>
        </div>
      `;
      return;
    }

    const visibleMessages = this.messages.slice(0, 50);
    container.innerHTML = visibleMessages.map(msg => `
      <div class="feed-message" data-id="${msg.id}">
        <div class="feed-message-header">
          <span class="feed-message-topic">${msg.topic}</span>
          <span class="feed-message-time">${this.formatTime(msg.timestamp)}</span>
        </div>
        <div class="feed-message-payload">${this.truncatePayload(msg.payload)}</div>
      </div>
    `).join('');

    if (this.autoScroll) {
      container.scrollTop = 0;
    }
  }

  renderMessagesTable() {
    const tbody = document.getElementById('messagesTableBody');
    if (!tbody) return;

    const filter = document.getElementById('topicFilter')?.value || '';
    const search = document.getElementById('messageSearch')?.value?.toLowerCase() || '';

    let filtered = this.allMessages;

    if (filter) {
      filtered = filtered.filter(m => m.topic === filter);
    }

    if (search) {
      filtered = filtered.filter(m =>
        m.topic.toLowerCase().includes(search) ||
        m.publisherId?.toLowerCase().includes(search) ||
        JSON.stringify(m.payload).toLowerCase().includes(search)
      );
    }

    const page = 1;
    const perPage = 50;
    const start = (page - 1) * perPage;
    const paged = filtered.slice(start, start + perPage);

    if (paged.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-cell">No messages found</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = paged.map(msg => `
      <tr class="message-row" data-id="${msg.id}">
        <td class="timestamp-cell">${this.formatDateTime(msg.timestamp)}</td>
        <td><span class="topic-badge">${msg.topic}</span></td>
        <td class="publisher-cell">${msg.publisherId || 'Unknown'}</td>
        <td class="payload-cell">${this.truncatePayload(msg.payload, 60)}</td>
        <td class="actions-cell">
          <button class="btn btn-sm btn-ghost view-message-btn" data-id="${msg.id}">View</button>
        </td>
      </tr>
    `).join('');

    // Attach click handlers
    tbody.querySelectorAll('.view-message-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const msg = this.allMessages.find(m => m.id === id);
        if (msg) this.showMessageDetail(msg);
      });
    });
  }

  updateTopicsView(topics) {
    const grid = document.getElementById('topicsGrid');
    if (!grid) return;

    if (!topics || topics.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <p>No topics created yet</p>
          <button class="btn btn-primary" onclick="dashboard.openCreateTopicModal()">Create First Topic</button>
        </div>
      `;
      return;
    }

    const search = document.getElementById('topicSearch')?.value?.toLowerCase() || '';
    const filtered = topics.filter(t => t.name.toLowerCase().includes(search));

    grid.innerHTML = filtered.map(topic => `
      <div class="topic-card" data-topic="${topic.name}">
        <div class="topic-card-header">
          <span class="topic-card-name">${topic.name}</span>
          <span class="topic-card-status active">Active</span>
        </div>
        <div class="topic-card-stats">
          <div class="topic-card-stat">
            <span class="topic-card-stat-value">${this.formatNumber(topic.messageCount)}</span>
            <span class="topic-card-stat-label">Messages</span>
          </div>
          <div class="topic-card-stat">
            <span class="topic-card-stat-value">${topic.subscriberCount}</span>
            <span class="topic-card-stat-label">Subscribers</span>
          </div>
        </div>
        <div class="topic-card-actions">
          <button class="btn btn-sm btn-ghost" onclick="dashboard.publishToTopic('${topic.name}')">Publish</button>
          <button class="btn btn-sm btn-ghost" onclick="dashboard.viewTopicMessages('${topic.name}')">Messages</button>
        </div>
      </div>
    `).join('');
  }

  updateSubscribersView(subscribers) {
    const grid = document.getElementById('subscribersGrid');
    if (!grid) return;

    if (!subscribers || subscribers.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
          </svg>
          <p>No subscribers connected</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = subscribers.map(sub => `
      <div class="subscriber-card ${sub.isOnline ? 'online' : 'offline'}">
        <div class="subscriber-card-header">
          <div class="subscriber-info">
            <span class="subscriber-id">${sub.clientId || sub.id.substring(0, 12)}</span>
            <span class="subscriber-status ${sub.isOnline ? 'online' : 'offline'}">
              ${sub.isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <div class="subscriber-avatar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
        </div>
        <div class="subscriber-topics">
          <span class="subscriber-topics-label">Topics:</span>
          <div class="subscriber-topics-list">
            ${(sub.topics || []).map(t => `<span class="mini-badge">${t}</span>`).join('') || '<span class="text-muted">None</span>'}
          </div>
        </div>
        <div class="subscriber-meta">
          <span>Queued: ${sub.queueSize || 0}</span>
        </div>
      </div>
    `).join('');
  }

  renderConsumerGroups() {
    const grid = document.getElementById('consumerGroupsGrid');
    if (!grid) return;

    if (!this.consumerGroups || this.consumerGroups.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="6"/>
            <circle cx="12" cy="12" r="2"/>
          </svg>
          <p>No consumer groups configured</p>
          <button class="btn btn-primary" onclick="dashboard.openCreateGroupModal()">Create Consumer Group</button>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.consumerGroups.map(group => `
      <div class="consumer-group-card">
        <div class="cg-header">
          <span class="cg-name">${group.name}</span>
          <span class="cg-strategy">${group.strategy}</span>
        </div>
        <div class="cg-topic">Topic: ${group.topic}</div>
        <div class="cg-stats">
          <div class="cg-stat">
            <span class="cg-stat-value">${group.memberCount || 0}</span>
            <span class="cg-stat-label">Members</span>
          </div>
          <div class="cg-stat">
            <span class="cg-stat-value">${group.lag || 0}</span>
            <span class="cg-stat-label">Lag</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  renderDLQ() {
    const container = document.getElementById('dlqList');
    if (!container) return;

    if (!this.dlqMessages || this.dlqMessages.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
          </svg>
          <p>No failed messages - everything is healthy!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.dlqMessages.map(msg => `
      <div class="dlq-item">
        <div class="dlq-item-header">
          <span class="dlq-item-topic">${msg.originalTopic}</span>
          <span class="dlq-item-time">${this.formatDateTime(msg.failedAt)}</span>
        </div>
        <div class="dlq-item-error">${msg.reason}</div>
        <div class="dlq-item-payload">${this.truncatePayload(msg.message?.payload, 100)}</div>
        <div class="dlq-item-actions">
          <button class="btn btn-sm" onclick="dashboard.retryDLQ('${msg.id}')">Retry</button>
          <button class="btn btn-sm btn-ghost" onclick="dashboard.deleteDLQ('${msg.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  renderApiKeysList(keys) {
    const container = document.getElementById('apiKeysList');
    if (!container) return;

    if (!keys || keys.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No API keys configured</p>
        </div>
      `;
      return;
    }

    container.innerHTML = keys.map(key => `
      <div class="api-key-card">
        <div class="api-key-header">
          <span class="api-key-name">${key.name}</span>
          <span class="api-key-role ${key.role}">${key.role}</span>
        </div>
        <div class="api-key-value">
          <code>${key.key.substring(0, 20)}${'*'.repeat(12)}</code>
          <button class="btn btn-sm btn-icon copy-btn" onclick="dashboard.copyToClipboard('${key.key}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
          </button>
        </div>
        <div class="api-key-meta">
          <span>Permissions: ${(key.permissions || []).join(', ')}</span>
          <span>Rate Limit: ${key.rateLimit}/min</span>
        </div>
      </div>
    `).join('');
  }

  addToPublishHistory(msg) {
    this.publishHistory.unshift({
      topic: msg.topic || 'Unknown',
      timestamp: Date.now(),
      success: true
    });
    if (this.publishHistory.length > 10) this.publishHistory.pop();
    this.renderPublishHistory();
  }

  renderPublishHistory() {
    const container = document.getElementById('publishHistory');
    if (!container) return;

    if (this.publishHistory.length === 0) {
      container.innerHTML = '<div class="empty-state small">No recent publishes</div>';
      return;
    }

    container.innerHTML = this.publishHistory.map(item => `
      <div class="publish-history-item">
        <span class="ph-topic">${item.topic}</span>
        <span class="ph-time">${this.formatTime(item.timestamp)}</span>
        <span class="ph-status ${item.success ? 'success' : 'failed'}">${item.success ? 'Sent' : 'Failed'}</span>
      </div>
    `).join('');
  }

  showMessageDetail(msg) {
    const modal = document.getElementById('messageDetailModal');
    const content = document.getElementById('messageDetailContent');

    content.innerHTML = `
      <div class="message-detail-section">
        <label>Message ID</label>
        <code>${msg.id}</code>
      </div>
      <div class="message-detail-section">
        <label>Topic</label>
        <span class="topic-badge">${msg.topic}</span>
      </div>
      <div class="message-detail-section">
        <label>Timestamp</label>
        <span>${this.formatDateTime(msg.timestamp)}</span>
      </div>
      <div class="message-detail-section">
        <label>Publisher</label>
        <span>${msg.publisherId || 'Unknown'}</span>
      </div>
      <div class="message-detail-section">
        <label>Payload</label>
        <pre class="json-viewer">${JSON.stringify(msg.payload, null, 2)}</pre>
      </div>
      ${msg.headers ? `
        <div class="message-detail-section">
          <label>Headers</label>
          <pre class="json-viewer">${JSON.stringify(msg.headers, null, 2)}</pre>
        </div>
      ` : ''}
    `;

    // Store current message for republish
    this.currentDetailMessage = msg;

    modal.classList.add('open');
  }

  // Navigation
  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const view = item.dataset.view;
        this.navigateTo(view);
      });
    });
  }

  navigateTo(view) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    // Update views
    document.querySelectorAll('.view').forEach(v => {
      v.classList.remove('active');
    });
    const viewEl = document.getElementById(`view-${view}`);
    if (viewEl) viewEl.classList.add('active');

    // Update page title
    const titles = {
      'overview': 'Overview',
      'topics': 'Topics',
      'messages': 'Messages',
      'subscribers': 'Subscribers',
      'consumer-groups': 'Consumer Groups',
      'dlq': 'Dead Letter Queue',
      'publish': 'Publish Message',
      'api-keys': 'API Keys',
      'settings': 'Settings'
    };
    document.getElementById('pageTitle').textContent = titles[view] || 'Dashboard';

    // Update breadcrumb
    document.getElementById('breadcrumb').innerHTML = `
      <span>Dashboard</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      <span>${titles[view] || view}</span>
    `;

    this.currentView = view;

    // Refresh view-specific data
    if (view === 'messages') {
      this.renderMessagesTable();
    } else if (view === 'dlq') {
      this.send({ type: 'dlq:list' });
    }
  }

  // Event Listeners
  setupEventListeners() {
    // Theme toggle
    document.getElementById('themeToggle')?.addEventListener('click', () => {
      document.body.classList.toggle('dark-mode');
      this.saveSettings();
    });

    document.getElementById('darkModeToggle')?.addEventListener('change', (e) => {
      document.body.classList.toggle('dark-mode', e.target.checked);
      this.saveSettings();
    });

    // Auto scroll toggle
    document.getElementById('autoScrollCheck')?.addEventListener('change', (e) => {
      this.autoScroll = e.target.checked;
    });

    // Clear feed
    document.getElementById('clearFeedBtn')?.addEventListener('click', () => {
      this.messages = [];
      this.renderLiveFeed();
    });

    // Refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      this.send({ type: 'metrics' });
      this.showToast('Data refreshed', 'success');
    });

    // New topic buttons
    document.getElementById('newTopicBtn')?.addEventListener('click', () => this.openCreateTopicModal());
    document.getElementById('createTopicBtn2')?.addEventListener('click', () => this.openCreateTopicModal());

    // Create topic form
    document.getElementById('createTopicForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.createTopic();
    });

    // Modal close handlers
    document.querySelectorAll('.modal-close, .modal-cancel, .modal-backdrop').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
      });
    });

    // Publish form
    document.getElementById('publishForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.publishMessage();
    });

    // JSON validation
    document.getElementById('pubPayload')?.addEventListener('input', (e) => {
      this.validateJSON(e.target.value);
    });

    // Topic search
    document.getElementById('topicSearch')?.addEventListener('input', () => {
      this.updateTopicsView(this.topics);
    });

    // Message search and filters
    document.getElementById('messageSearch')?.addEventListener('input', () => {
      this.renderMessagesTable();
    });
    document.getElementById('topicFilter')?.addEventListener('change', () => {
      this.renderMessagesTable();
    });

    // Copy message button
    document.getElementById('copyMessageBtn')?.addEventListener('click', () => {
      if (this.currentDetailMessage) {
        this.copyToClipboard(JSON.stringify(this.currentDetailMessage, null, 2));
      }
    });

    // Republish button
    document.getElementById('republishBtn')?.addEventListener('click', () => {
      if (this.currentDetailMessage) {
        document.getElementById('pubTopic').value = this.currentDetailMessage.topic;
        document.getElementById('pubPayload').value = JSON.stringify(this.currentDetailMessage.payload, null, 2);
        document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
        this.navigateTo('publish');
      }
    });

    // Retry all DLQ
    document.getElementById('retryAllDlqBtn')?.addEventListener('click', () => {
      this.send({ type: 'dlq:retry-all' });
      this.showToast('Retrying all failed messages...', 'info');
    });

    // Auto refresh toggle
    document.getElementById('autoRefreshToggle')?.addEventListener('change', (e) => {
      this.autoRefresh = e.target.checked;
      this.saveSettings();
    });
  }

  openCreateTopicModal() {
    document.getElementById('createTopicModal').classList.add('open');
  }

  openCreateGroupModal() {
    // Would open a consumer group creation modal
    this.showToast('Consumer group creation coming soon', 'info');
  }

  createTopic() {
    const name = document.getElementById('newTopicName').value;
    const desc = document.getElementById('newTopicDesc')?.value;
    const queueSize = parseInt(document.getElementById('newTopicQueueSize')?.value) || 1000;
    const retention = parseInt(document.getElementById('newTopicRetention')?.value) || 24;

    this.send({
      type: 'topic:create',
      topic: name,
      payload: {
        description: desc,
        maxQueueSize: queueSize,
        retentionHours: retention
      }
    });

    document.getElementById('createTopicModal').classList.remove('open');
    document.getElementById('createTopicForm').reset();
    this.showToast(`Topic "${name}" created`, 'success');
  }

  publishMessage() {
    const topic = document.getElementById('pubTopic').value;
    const payloadStr = document.getElementById('pubPayload').value;
    const headersStr = document.getElementById('pubHeaders')?.value;
    const ttl = parseInt(document.getElementById('pubTTL')?.value) || undefined;

    let payload;
    try {
      payload = payloadStr ? JSON.parse(payloadStr) : {};
    } catch {
      payload = payloadStr;
    }

    let headers;
    if (headersStr) {
      try {
        headers = JSON.parse(headersStr);
      } catch {
        // Ignore invalid headers
      }
    }

    this.send({
      type: 'publish',
      topic,
      payload,
      headers,
      ttl
    });
  }

  publishToTopic(topic) {
    document.getElementById('pubTopic').value = topic;
    this.navigateTo('publish');
  }

  viewTopicMessages(topic) {
    document.getElementById('topicFilter').value = topic;
    this.navigateTo('messages');
    this.renderMessagesTable();
  }

  validateJSON(str) {
    const validation = document.getElementById('jsonValidation');
    if (!validation) return;

    if (!str.trim()) {
      validation.innerHTML = '';
      return;
    }

    try {
      JSON.parse(str);
      validation.innerHTML = '<span class="valid">Valid JSON</span>';
    } catch (e) {
      validation.innerHTML = `<span class="invalid">Invalid JSON: ${e.message}</span>`;
    }
  }

  retryDLQ(id) {
    this.send({ type: 'dlq:retry', payload: { id } });
    this.showToast('Retrying message...', 'info');
  }

  deleteDLQ(id) {
    this.send({ type: 'dlq:delete', payload: { id } });
    this.dlqMessages = this.dlqMessages.filter(m => m.id !== id);
    this.renderDLQ();
    this.showToast('Message deleted', 'success');
  }

  // Utilities
  formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  }

  formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
  }

  formatDateTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }

  truncatePayload(payload, maxLen = 50) {
    const str = typeof payload === 'object' ? JSON.stringify(payload) : String(payload);
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
  }

  copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      this.showToast('Copied to clipboard', 'success');
    }).catch(() => {
      this.showToast('Failed to copy', 'error');
    });
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span class="toast-message">${message}</span>
      <button class="toast-close">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.remove();
    });

    container.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  startUptimeCounter() {
    setInterval(() => {
      const elapsed = Date.now() - this.startTime;
      const hours = Math.floor(elapsed / 3600000);
      const minutes = Math.floor((elapsed % 3600000) / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);

      const uptime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      const el = document.getElementById('headerUptime');
      if (el) el.textContent = uptime;
    }, 1000);
  }

  loadSettings() {
    try {
      const settings = JSON.parse(localStorage.getItem('ankita-pubsub-settings') || '{}');

      if (settings.darkMode !== undefined) {
        document.body.classList.toggle('dark-mode', settings.darkMode);
        const toggle = document.getElementById('darkModeToggle');
        if (toggle) toggle.checked = settings.darkMode;
      }

      if (settings.autoRefresh !== undefined) {
        this.autoRefresh = settings.autoRefresh;
        const toggle = document.getElementById('autoRefreshToggle');
        if (toggle) toggle.checked = settings.autoRefresh;
      }
    } catch (e) {
      // Ignore errors
    }
  }

  saveSettings() {
    const settings = {
      darkMode: document.body.classList.contains('dark-mode'),
      autoRefresh: this.autoRefresh
    };
    localStorage.setItem('ankita-pubsub-settings', JSON.stringify(settings));
  }

  handleReply(data) {
    this.showToast('Reply received', 'success');
    console.log('Reply:', data.payload);
  }
}

// Initialize dashboard
const dashboard = new PubSubDashboard();
