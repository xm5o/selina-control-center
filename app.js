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

  async function startDiscordLogin() {
    $('connectError').textContent = '';

    try {
      state.base = baseUrl(
        $('backendUrl').value
      );

      localStorage.setItem(
        'selinaDashboardBase',
        state.base
      );

      const response = await fetch(
        `${state.base}/api/oauth/start`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: '{}'
        }
      );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload.error ||
          'Discord login is not configured'
        );
      }

      sessionStorage.setItem(
        'selinaOAuthState',
        payload.state
      );

      location.href =
        payload.authorizeUrl;
    } catch (error) {
      $('connectError').textContent =
        error.message ||
        'Discord login failed';
    }
  }

  async function finishDiscordLogin() {
    const params =
      new URLSearchParams(
        location.search
      );

    const code =
      params.get('code');

    const stateParam =
      params.get('state');

    if (!code || !stateParam) {
      return false;
    }

    const savedState =
      sessionStorage.getItem(
        'selinaOAuthState'
      );

    if (
      !savedState ||
      savedState !== stateParam
    ) {
      history.replaceState(
        {},
        document.title,
        location.pathname
      );

      $('connectError').textContent =
        'Discord login state did not match. Try again.';

      return true;
    }

    const savedBase =
      localStorage.getItem(
        'selinaDashboardBase'
      );

    if (!savedBase) {
      $('connectError').textContent =
        'Backend URL was lost. Enter it again.';

      return true;
    }

    state.base = savedBase;

    try {
      const response = await fetch(
        `${state.base}/api/oauth/exchange`,
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            code,
            state: stateParam
          })
        }
      );

      const payload =
        await response.json();

      if (!response.ok) {
        throw new Error(
          payload.error ||
          'Discord login failed'
        );
      }

      state.token =
        payload.token;

      localStorage.setItem(
        'selinaDashboardToken',
        state.token
      );

      sessionStorage.removeItem(
        'selinaOAuthState'
      );

      history.replaceState(
        {},
        document.title,
        location.pathname
      );

      $('connectScreen')
        .classList.add('hidden');

      $('app')
        .classList.remove('hidden');

      await refreshAll();
      setLive(true);

      state.refreshTimer =
        setInterval(
          refreshAll,
          5000
        );

      state.activityTimer =
        setInterval(
          refreshActivity,
          2000
        );

      return true;
    } catch (error) {
      history.replaceState(
        {},
        document.title,
        location.pathname
      );

      $('connectError').textContent =
        error.message ||
        'Discord login failed';

      return true;
    }
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

  async function refreshActivity(){try{const x=await api('/api/logs?limit=160');state.events=x.events||[];renderActivity();setLive(true)}catch{setLive(false)}}
  function setLive(x){$('liveDot').classList.toggle('live',x);$('connectionText').textContent=x?'Live':'Reconnecting'}
  async function refreshAll(){try{const [overview,music,guilds,system,logs,commands,diagnostics]=await Promise.all([api('/api/overview'),api('/api/music'),api('/api/guilds'),api('/api/system'),api('/api/logs?limit=160'),api('/api/analytics/commands'),api('/api/diagnostics')]);Object.assign(state,{overview,music,guilds:guilds.guilds||[],system,events:logs.events||[],commands,diagnostics});render();setLive(true)}catch(e){console.warn('[Dashboard]',e);setLive(false)}}
  function render(){const o=state.overview;if(!o)return;$('botName').textContent=o.bot.username||'Selina';$('botState').textContent=o.bot.ready?'Online':'Offline';$('botAvatar').src=o.bot.avatar||'';$('metricUptime').textContent=duration(o.bot.uptime);$('metricPing').textContent=o.bot.ping==null?'—':`${Math.round(o.bot.ping)}ms`;$('metricGuilds').textContent=o.discord.guilds;$('metricMemory').textContent=bytes(o.process.rss);$('runtimeNode').textContent=o.process.node;$('runtimeCommands').textContent=o.discord.commands;$('runtimeUsers').textContent=o.discord.cachedUsers;$('runtimeMusic').textContent=o.music.engine||'Ready';renderMusic();renderGuilds();renderSystem();renderActivity();renderCommands();renderDiagnostics()}
  function renderMusic(){const qs=state.music?.queues||[],q=qs[0];if(!q){$('musicBadge').textContent='Idle';$('musicTitle').textContent='Nothing playing';$('musicServer').textContent='Selina is idle';$('musicArtwork').removeAttribute('src');$('musicProgress').style.width='0%';$('musicCurrent').textContent='0:00';$('musicDuration').textContent='0:00'}else{$('musicBadge').textContent=q.paused?'Paused':'Playing';$('musicTitle').textContent=q.song.name;$('musicServer').textContent=`${q.guildName}${q.voiceChannel?' · '+q.voiceChannel:''}`;$('musicArtwork').src=q.song.thumbnail||'';const t=+q.song.duration||0,c=+q.currentTime||0;$('musicProgress').style.width=t?`${Math.min(100,c/t*100)}%`:'0%';$('musicCurrent').textContent=clock(c);$('musicDuration').textContent=q.song.formattedDuration||clock(t)}$('musicQueues').innerHTML=qs.length?qs.map(q=>`<article class="card"><div class="cardtop"><img src="${escapeHtml(q.song.thumbnail||'')}"><div><h3>${escapeHtml(q.song.name)}</h3><p>${escapeHtml(q.guildName)}</p></div></div><div class="stats"><div><span>Status</span><b>${q.paused?'Paused':'Playing'}</b></div><div><span>Volume</span><b>${q.volume}%</b></div><div><span>Queue</span><b>${q.queueSize}</b></div></div></article>`).join(''):'<article class="card"><h3>No active queues</h3><p>Selina is idle.</p></article>'}
  function renderGuilds(){$('guildGrid').innerHTML=state.guilds.map(g=>`<article class="card" data-guild="${g.id}"><div class="cardtop"><img src="${escapeHtml(g.icon||'')}"><div><h3>${escapeHtml(g.name)}</h3><p>${g.members.toLocaleString()} members</p></div></div><div class="stats"><div><span>Members</span><b>${g.members}</b></div><div><span>Channels</span><b>${g.channels}</b></div><div><span>Roles</span><b>${g.roles}</b></div></div></article>`).join('');document.querySelectorAll('[data-guild]').forEach(e=>e.onclick=()=>openGuild(e.dataset.guild))}
  async function openGuild(id){const b=$('guildDetail');b.innerHTML='<article class="panel server-detail">Loading…</article>';try{const g=await api(`/api/guilds/${id}`);b.innerHTML=`<article class="panel server-detail"><div class="head"><div><p class="eyebrow">SERVER DETAIL</p><h3>${escapeHtml(g.name)}</h3></div><span class="pill">${g.members} members</span></div><div class="columns"><div><p class="eyebrow">CHANNELS · ${g.channels.length}</p><div class="list">${g.channels.map(c=>`<div># ${escapeHtml(c.name)}</div>`).join('')}</div></div><div><p class="eyebrow">ROLES · ${g.roles.length}</p><div class="list">${g.roles.map(r=>`<div>${escapeHtml(r.name)}${r.managed?' · managed':''}</div>`).join('')}</div></div></div></article>`}catch(e){b.innerHTML=`<article class="panel">${escapeHtml(e.message)}</article>`}}
  function renderCommands(){const c=state.commands||{commands:[],totalTracked:0,last24h:0,uniqueCommands:0};$('commandSummary').innerHTML=`<article><span>Tracked uses</span><b>${c.totalTracked}</b><small>Current process</small></article><article><span>Last 24h</span><b>${c.last24h}</b><small>Command events</small></article><article><span>Unique</span><b>${c.uniqueCommands}</b><small>Commands used</small></article>`;$('commandTable').innerHTML='<div class="tr"><span>Command</span><span>Uses</span><span>Users</span><span class="optional">Servers</span><span class="optional">Last</span></div>'+c.commands.map(x=>`<div class="tr"><b>/${escapeHtml(x.command)}</b><span>${x.uses}</span><span>${x.uniqueUsers}</span><span class="optional">${x.uniqueGuilds}</span><span class="optional">${x.lastUsedAt?ago(x.lastUsedAt):'—'}</span></div>`).join('')}
  function renderDiagnostics(){const d=state.diagnostics||{errors:[],warnings:[],counts:{errors:0,warnings:0,logs:0}};$('diagnosticSummary').innerHTML=`<article><span>Errors</span><b>${d.counts.errors}</b><small>Captured</small></article><article><span>Warnings</span><b>${d.counts.warnings}</b><small>Captured</small></article><article><span>Logs</span><b>${d.counts.logs}</b><small>Buffer</small></article>`;const r=[...d.errors.map(x=>({...x,k:'error'})),...d.warnings.map(x=>({...x,k:'warn'}))].sort((a,b)=>(b.at||0)-(a.at||0));$('diagnosticList').innerHTML=r.length?r.map(x=>`<div class="event diag-${x.k}"><i></i><span class="type">${x.k}</span><span>${escapeHtml((x.context?x.context+': ':'')+(x.message||''))}</span><time>${ago(x.at)}</time></div>`).join(''):'<div class="event"><i></i><span class="type">Clean</span><span>No warnings or errors captured.</span></div>'}
  function renderSystem(){const s=state.system;if(!s)return;$('sysNode').textContent=s.node;$('sysPlatform').textContent=s.platform;$('sysArch').textContent=s.arch;$('sysRam').textContent=bytes(s.memory.processRss);$('sysDisk').textContent=s.disk?bytes(s.disk.free):'—'}
  function activityHtml(es){return es.length?es.map(e=>`<div class="event"><i></i><span class="type">${escapeHtml(e.type)}</span><span>${escapeHtml(eventMessage(e))}</span><time>${ago(e.at)}</time></div>`).join(''):'<div class="event"><i></i><span class="type">Quiet</span><span>No recent activity.</span></div>'}
  function renderActivity(){const a=[...state.events].reverse();$('overviewActivity').innerHTML=activityHtml(a.slice(0,8));const f=state.filter==='all'?a:a.filter(e=>e.type===state.filter);$('fullActivity').innerHTML=activityHtml(f.slice(0,180))}
  function switchView(v){document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===v));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${v}`));$('pageTitle').textContent=({overview:'Overview',servers:'Servers',commands:'Commands',activity:'Activity',music:'Music',diagnostics:'Diagnostics',system:'Runtime'})[v]||'Selina'}
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>switchView(b.dataset.view));document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderActivity()});
  $('discordLoginButton').addEventListener('click',startDiscordLogin);$('connectButton').addEventListener('click',connect);$('ownerKey').addEventListener('keydown',e=>{if(e.key==='Enter')connect()});$('disconnectButton').addEventListener('click',()=>disconnect(true));
  const savedBase=localStorage.getItem('selinaDashboardBase');if(savedBase&&savedBase!==location.origin)$('backendUrl').value=savedBase;
  (async()=>{const handled=await finishDiscordLogin();if(!handled)await resumeSession()})();
})();
