(() => {
  const $ = id => document.getElementById(id);
  const state = {
    base: '',
    token: '',
    overview: null,
    music: null,
    guilds: [],
    system: null,
    events: [],
    filter: 'all',
    refreshTimer: null
  };

  function baseUrl(value) {
    const url = String(value || '').trim();
    return url ? url.replace(/\/+$/, '') : location.origin;
  }

  function bytes(value) {
    const n = Number(value) || 0;
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
    if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
    return `${Math.round(n / 1024)} KB`;
  }

  function duration(seconds) {
    let total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    total %= 86400;
    const hours = Math.floor(total / 3600);
    total %= 3600;
    const minutes = Math.floor(total / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function clock(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  }

  function ago(timestamp) {
    const diff = Math.max(0, Date.now() - Number(timestamp || 0));
    if (diff < 60000) return 'now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return `${Math.floor(diff / 86400000)}d`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function eventMessage(event) {
    if (event.type === 'command') {
      return `/${event.command || 'command'} · ${event.username || 'user'}${event.guildName ? ` · ${event.guildName}` : ''}`;
    }
    if (event.type === 'music') {
      if (event.action === 'play') return `Playing ${event.song || 'track'}${event.guildName ? ` · ${event.guildName}` : ''}`;
      if (event.action === 'queued') return `Queued ${event.song || 'track'}`;
      return `Music ${event.action || 'update'}`;
    }
    if (event.type === 'voice') {
      return event.to
        ? `Selina moved to ${event.to}${event.guildName ? ` · ${event.guildName}` : ''}`
        : `Selina left voice${event.guildName ? ` · ${event.guildName}` : ''}`;
    }
    if (event.type === 'log') {
      return `${event.context ? `${event.context}: ` : ''}${event.message || event.level || 'Log'}`;
    }
    if (event.type === 'guild') {
      return `${event.action === 'joined' ? 'Joined' : 'Left'} ${event.guildName || 'server'}`;
    }
    if (event.type === 'security') {
      return event.action === 'dashboard-auth-success'
        ? 'Dashboard authenticated'
        : 'Dashboard auth attempt failed';
    }
    return event.action || event.type || 'Update';
  }

  async function api(path) {
    const response = await fetch(`${state.base}${path}`, {
      headers: { Authorization: `Bearer ${state.token}` }
    });

    if (response.status === 401) {
      disconnect(true);
      throw new Error('Session expired');
    }

    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.json();
  }

  async function authenticate(key) {
    const response = await fetch(`${state.base}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });

    if (!response.ok) throw new Error('Could not authenticate');
    return response.json();
  }

  async function connect() {
    $('connectError').textContent = '';
    $('connectButton').disabled = true;

    try {
      state.base = baseUrl($('backendUrl').value);
      const auth = await authenticate($('ownerKey').value);
      state.token = auth.token;

      localStorage.setItem('selinaDashboardBase', state.base);
      localStorage.setItem('selinaDashboardToken', state.token);

      $('connectScreen').classList.add('hidden');
      $('app').classList.remove('hidden');

      await refreshAll();
      setLive(true);
      state.refreshTimer = setInterval(refreshAll, 5000);
      state.activityTimer = setInterval(refreshActivity, 2000);
    } catch (error) {
      $('connectError').textContent = error.message || 'Connection failed';
    } finally {
      $('connectButton').disabled = false;
    }
  }

  async function resumeSession() {
    const savedBase = localStorage.getItem('selinaDashboardBase');
    const savedToken = localStorage.getItem('selinaDashboardToken');
    if (!savedBase || !savedToken) return false;

    state.base = savedBase;
    state.token = savedToken;

    try {
      await api('/api/overview');
      $('connectScreen').classList.add('hidden');
      $('app').classList.remove('hidden');
      await refreshAll();
      setLive(true);
      state.refreshTimer = setInterval(refreshAll, 5000);
      state.activityTimer = setInterval(refreshActivity, 2000);
      return true;
    } catch {
      localStorage.removeItem('selinaDashboardToken');
      return false;
    }
  }

  function disconnect(showConnect = true) {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    if (state.activityTimer) clearInterval(state.activityTimer);

    state.refreshTimer = null;
    state.activityTimer = null;
    state.token = '';
    localStorage.removeItem('selinaDashboardToken');

    if (showConnect) {
      $('app').classList.add('hidden');
      $('connectScreen').classList.remove('hidden');
      $('ownerKey').value = '';
    }
  }

  async function refreshActivity() {
    try {
      const logs = await api('/api/logs?limit=120');
      state.events = logs.events || state.events;
      renderActivity();
      setLive(true);
    } catch {
      setLive(false);
    }
  }


  function setLive(live) {
    $('liveDot').classList.toggle('live', live);
    $('connectionText').textContent = live ? 'Live' : 'Reconnecting';
  }

  async function refreshAll() {
    try {
      const [overview, music, guilds, system, logs] = await Promise.all([
        api('/api/overview'),
        api('/api/music'),
        api('/api/guilds'),
        api('/api/system'),
        api('/api/logs?limit=120')
      ]);

      state.overview = overview;
      state.music = music;
      state.guilds = guilds.guilds || [];
      state.system = system;
      state.events = logs.events || state.events;
      render();
    } catch (error) {
      console.warn('[Dashboard]', error);
    }
  }

  function render() {
    const o = state.overview;
    if (!o) return;

    $('botName').textContent = o.bot.username || 'Selina';
    $('botState').textContent = o.bot.ready ? 'Online' : 'Offline';
    $('botAvatar').src = o.bot.avatar || '';
    $('botAvatar').style.visibility = o.bot.avatar ? 'visible' : 'hidden';

    $('metricUptime').textContent = duration(o.bot.uptime);
    $('metricPing').textContent = o.bot.ping == null ? '—' : `${Math.round(o.bot.ping)}ms`;
    $('metricGuilds').textContent = o.discord.guilds.toLocaleString();
    $('metricMemory').textContent = bytes(o.process.rss);

    $('runtimeNode').textContent = o.process.node;
    $('runtimeCommands').textContent = o.discord.commands.toLocaleString();
    $('runtimeUsers').textContent = o.discord.cachedUsers.toLocaleString();
    $('runtimeMusic').textContent = o.music.engine || 'Ready';

    renderNowPlaying();
    renderMusicQueues();
    renderGuilds();
    renderSystem();
    renderActivity();
  }

  function renderNowPlaying() {
    const queue = state.music?.queues?.[0];
    const box = $('nowPlaying');

    if (!queue) {
      box.classList.add('empty');
      $('musicBadge').textContent = 'Idle';
      $('musicTitle').textContent = 'Nothing playing';
      $('musicServer').textContent = 'Selina is idle';
      $('musicArtwork').removeAttribute('src');
      $('musicProgress').style.width = '0%';
      $('musicCurrent').textContent = '0:00';
      $('musicDuration').textContent = '0:00';
      return;
    }

    box.classList.remove('empty');
    $('musicBadge').textContent = queue.paused ? 'Paused' : 'Playing';
    $('musicTitle').textContent = queue.song.name;
    $('musicServer').textContent = `${queue.guildName}${queue.voiceChannel ? ` · ${queue.voiceChannel}` : ''}`;

    if (queue.song.thumbnail) $('musicArtwork').src = queue.song.thumbnail;

    const total = Number(queue.song.duration) || 0;
    const current = Number(queue.currentTime) || 0;

    $('musicProgress').style.width = total
      ? `${Math.min(100, (current / total) * 100)}%`
      : '0%';

    $('musicCurrent').textContent = clock(current);
    $('musicDuration').textContent = queue.song.formattedDuration || clock(total);
  }

  function renderMusicQueues() {
    const queues = state.music?.queues || [];

    $('musicQueues').innerHTML = queues.length
      ? queues.map(queue => `
          <article class="data-card">
            <div class="card-top">
              <img src="${queue.song.thumbnail || ''}" alt="" />
              <div>
                <h3>${escapeHtml(queue.song.name)}</h3>
                <p>${escapeHtml(queue.guildName)}${queue.voiceChannel ? ` · ${escapeHtml(queue.voiceChannel)}` : ''}</p>
              </div>
            </div>
            <div class="data-stats">
              <div><span>Status</span><strong>${queue.paused ? 'Paused' : 'Playing'}</strong></div>
              <div><span>Volume</span><strong>${queue.volume}%</strong></div>
              <div><span>Queue</span><strong>${queue.queueSize}</strong></div>
            </div>
          </article>
        `).join('')
      : `<article class="data-card"><h3>No active music</h3><p>Selina has no active queue right now.</p></article>`;
  }

  function renderGuilds() {
    $('guildGrid').innerHTML = state.guilds.map(guild => `
      <article class="data-card">
        <div class="card-top">
          <img src="${guild.icon || ''}" alt="" />
          <div>
            <h3>${escapeHtml(guild.name)}</h3>
            <p>${guild.members.toLocaleString()} members</p>
          </div>
        </div>
        <div class="data-stats">
          <div><span>Members</span><strong>${guild.members.toLocaleString()}</strong></div>
          <div><span>Channels</span><strong>${guild.channels}</strong></div>
          <div><span>Roles</span><strong>${guild.roles}</strong></div>
        </div>
      </article>
    `).join('');
  }

  function renderSystem() {
    const s = state.system;
    if (!s) return;

    $('sysNode').textContent = s.node;
    $('sysPlatform').textContent = s.platform;
    $('sysArch').textContent = s.arch;
    $('sysRam').textContent = bytes(s.memory.processRss);
    $('sysDisk').textContent = s.disk ? bytes(s.disk.free) : '—';
  }

  function activityHtml(events) {
    if (!events.length) {
      return `<div class="activity-item"><span class="dot"></span><span class="activity-type">Quiet</span><span class="activity-message">No recent activity yet.</span></div>`;
    }

    return events.map(event => `
      <div class="activity-item" data-type="${escapeHtml(event.type)}">
        <span class="dot"></span>
        <span class="activity-type">${escapeHtml(event.type)}</span>
        <span class="activity-message">${escapeHtml(eventMessage(event))}</span>
        <span class="activity-time">${ago(event.at)}</span>
      </div>
    `).join('');
  }

  function renderActivity() {
    const recent = [...state.events].reverse();
    $('overviewActivity').innerHTML = activityHtml(recent.slice(0, 8));

    const filtered = state.filter === 'all'
      ? recent
      : recent.filter(event => event.type === state.filter);

    $('fullActivity').innerHTML = activityHtml(filtered.slice(0, 180));
  }

  function switchView(view) {
    document.querySelectorAll('.nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.view === view);
    });

    document.querySelectorAll('.view').forEach(section => {
      section.classList.toggle('active', section.id === `view-${view}`);
    });

    const titles = {
      overview: 'Overview',
      music: 'Music',
      servers: 'Servers',
      activity: 'Activity',
      system: 'System'
    };

    $('pageTitle').textContent = titles[view] || 'Selina';
  }

  document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => switchView(button.dataset.view));
  });

  document.querySelectorAll('.filter').forEach(button => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll('.filter').forEach(item => {
        item.classList.toggle('active', item === button);
      });
      renderActivity();
    });
  });

  $('connectButton').addEventListener('click', connect);
  $('ownerKey').addEventListener('keydown', event => {
    if (event.key === 'Enter') connect();
  });
  $('disconnectButton').addEventListener('click', () => disconnect(true));

  const savedBase = localStorage.getItem('selinaDashboardBase');
  if (savedBase && savedBase !== location.origin) {
    $('backendUrl').value = savedBase;
  }

  resumeSession();
})();
