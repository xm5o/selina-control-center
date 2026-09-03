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
    analyticsDays: 30,
    summary: null,
    daily: null,
    health: null,
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

  async function apiPost(path, body = {}) {
    const response = await fetch(`${state.base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      disconnect(true);
      throw new Error('Session expired');
    }
    if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
    return payload;
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

      if (!/^https:\/\//i.test(state.base)) {
        throw new Error('Use the new https://*.trycloudflare.com backend URL.');
      }

      localStorage.setItem(
        'selinaDashboardBase',
        state.base
      );

      // A new Quick Tunnel means old OAuth state/session data is useless.
      sessionStorage.removeItem('selinaOAuthState');
      localStorage.removeItem('selinaDashboardToken');

      let configResponse;
      try {
        configResponse = await fetch(
          `${state.base}/api/oauth/config`,
          { cache: 'no-store' }
        );
      } catch {
        throw new Error(
          'Cannot reach the Selina backend. Check that the new Cloudflare URL is correct and the tunnel is still running.'
        );
      }

      const config = await configResponse.json().catch(() => ({}));

      if (!configResponse.ok) {
        throw new Error(
          config.error ||
          `Backend returned HTTP ${configResponse.status}`
        );
      }

      if (!config.enabled) {
        throw new Error(
          'Discord OAuth is not configured on the backend.'
        );
      }

      const response = await fetch(
        `${state.base}/api/oauth/start`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: '{}'
        }
      );

      const payload =
        await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload.error ||
          `Discord login start failed (${response.status})`
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
      let response;
      try {
        response = await fetch(
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
      } catch {
        throw new Error(
          'Lost connection to the Cloudflare backend during Discord login. Copy the latest tunnel URL and try again.'
        );
      }

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
  async function refreshAll(){try{const days=state.analyticsDays||30;const [overview,music,guilds,system,logs,commands,diagnostics,summary,daily,health,capabilities,audit,levelSummary,voiceSessions]=await Promise.all([api('/api/overview'),api('/api/music'),api('/api/guilds'),api('/api/system'),api('/api/logs?limit=160'),api(`/api/analytics/commands?days=${days}`),api(`/api/diagnostics?days=${days}`),api(`/api/analytics/summary?days=${days}`),api(`/api/analytics/daily?days=${days}`),api(`/api/analytics/health?days=${Math.min(days,30)}`),api('/api/controls/capabilities'),api('/api/audit?limit=60'),api('/api/levels/summary'),api('/api/levels/voice-sessions')]);Object.assign(state,{overview,music,guilds:guilds.guilds||[],system,events:logs.events||[],commands,diagnostics,summary,daily,health,capabilities,audit,levelSummary,voiceSessions});render();setLive(true)}catch(e){console.warn('[Dashboard]',e);setLive(false)}}
  function render(){const o=state.overview;if(!o)return;$('botName').textContent=o.bot.username||'Selina';$('botState').textContent=o.bot.ready?'Online':'Offline';$('botAvatar').src=o.bot.avatar||'';$('metricUptime').textContent=duration(o.bot.uptime);$('metricPing').textContent=o.bot.ping==null?'—':`${Math.round(o.bot.ping)}ms`;$('metricGuilds').textContent=o.discord.guilds;$('metricMemory').textContent=bytes(o.process.rss);$('runtimeNode').textContent=o.process.node;$('runtimeCommands').textContent=o.discord.commands;$('runtimeUsers').textContent=o.discord.cachedUsers;$('runtimeMusic').textContent=o.music.engine||'Ready';renderMusic();renderGuilds();renderSystem();renderActivity();renderCommands();renderDiagnostics();renderHistory();renderTrends();renderControls();renderLevels()}
  function renderMusic(){const qs=state.music?.queues||[],q=qs[0];if(!q){$('musicBadge').textContent='Idle';$('musicTitle').textContent='Nothing playing';$('musicServer').textContent='Selina is idle';$('musicArtwork').removeAttribute('src');$('musicProgress').style.width='0%';$('musicCurrent').textContent='0:00';$('musicDuration').textContent='0:00'}else{$('musicBadge').textContent=q.paused?'Paused':'Playing';$('musicTitle').textContent=q.song.name;$('musicServer').textContent=`${q.guildName}${q.voiceChannel?' · '+q.voiceChannel:''}`;$('musicArtwork').src=q.song.thumbnail||'';const t=+q.song.duration||0,c=+q.currentTime||0;$('musicProgress').style.width=t?`${Math.min(100,c/t*100)}%`:'0%';$('musicCurrent').textContent=clock(c);$('musicDuration').textContent=q.song.formattedDuration||clock(t)}$('musicQueues').innerHTML=qs.length?qs.map(q=>`<article class="card"><div class="cardtop"><img src="${escapeHtml(q.song.thumbnail||'')}"><div><h3>${escapeHtml(q.song.name)}</h3><p>${escapeHtml(q.guildName)}</p></div></div><div class="stats"><div><span>Status</span><b>${q.paused?'Paused':'Playing'}</b></div><div><span>Volume</span><b>${q.volume}%</b></div><div><span>Queue</span><b>${q.queueSize}</b></div></div></article>`).join(''):'<article class="card"><h3>No active queues</h3><p>Selina is idle.</p></article>'}
  function renderGuilds(){$('guildGrid').innerHTML=state.guilds.map(g=>`<article class="card" data-guild="${g.id}"><div class="cardtop"><img src="${escapeHtml(g.icon||'')}"><div><h3>${escapeHtml(g.name)}</h3><p>${g.members.toLocaleString()} members</p></div></div><div class="stats"><div><span>Members</span><b>${g.members}</b></div><div><span>Channels</span><b>${g.channels}</b></div><div><span>Roles</span><b>${g.roles}</b></div></div></article>`).join('');document.querySelectorAll('[data-guild]').forEach(e=>e.onclick=()=>openGuild(e.dataset.guild))}
  async function openGuild(id){const b=$('guildDetail');state.managedGuild=id;b.innerHTML='<article class="panel server-detail">Loading server manager…</article>';try{const [g,a,m]=await Promise.all([api(`/api/guilds/${id}`),api(`/api/guilds/${id}/analytics?days=${state.analyticsDays||30}`),api(`/api/server-manager/${id}`)]);state.serverManager=m;const top=(a.commands||[]).map(x=>`<span class="chip">/${escapeHtml(x.command)} · ${x.uses}</span>`).join('')||'<span class="chip">No command history</span>';b.innerHTML=`<article class="panel server-detail"><div class="manager-banner"><div><p class="eyebrow">SERVER MANAGEMENT</p><h3>${escapeHtml(g.name)}</h3></div><div class="capabilities"><span class="chip">${g.members} members</span><span class="chip">${m.botPermissions.manageRoles?'Roles ✓':'Roles limited'}</span><span class="chip">${m.botPermissions.manageChannels?'Channels ✓':'Channels limited'}</span></div></div><div class="history-grid"><div><span>Events</span><b>${a.totals?.events||0}</b></div><div><span>Commands</span><b>${a.totals?.commands||0}</b></div><div><span>Music</span><b>${a.totals?.music||0}</b></div><div><span>Active users</span><b>${a.totals?.activeUsers||0}</b></div><div><span>Last active</span><b>${a.totals?.lastActivityAt?ago(a.totals.lastActivityAt):'—'}</b></div></div><p class="eyebrow" style="margin-top:18px">TOP COMMANDS</p><div class="chips">${top}</div><div id="serverManagerPanel" class="server-manager"></div></article>`;renderServerManager()}catch(e){b.innerHTML=`<article class="panel">${escapeHtml(e.message)}</article>`}}

  function humanFeature(k){return ({aiChat:'AI Chat',levels:'Levels',welcome:'Welcome',autoreply:'Auto Reply',aiModeration:'AI Moderation'})[k]||k}
  function renderServerManager(){const m=state.serverManager,box=$('serverManagerPanel');if(!m||!box)return;const c=m.config||{},textChannels=(m.channels||[]).filter(x=>x.textBased),editableRoles=(m.roles||[]).filter(r=>r.editable&&!r.managed);box.innerHTML=`<div class="manager-grid"><section class="manager-section"><h4>Selina Configuration</h4><p class="muted">Real config v2 settings for this server.</p><div class="toggle-list">${(m.configCapabilities.features||[]).map(f=>`<div class="toggle-row"><span>${escapeHtml(humanFeature(f))}</span><button class="switch ${c.features?.[f]!==false?'on':''}" data-feature="${f}"><i></i></button></div>`).join('')}</div><div class="setting-row"><label>Language</label><select id="managerLanguage" class="manager-select"><option value="en" ${c.language==='en'?'selected':''}>English</option><option value="ar" ${c.language==='ar'?'selected':''}>العربية</option></select></div>${['modLogs','welcome','fortniteStatus'].map(k=>`<div class="setting-row"><label>${k==='modLogs'?'Moderation logs':k==='welcome'?'Welcome channel':'Fortnite status channel'}</label><select class="manager-select" data-configchannel="${k}"><option value="">Not configured</option>${textChannels.map(ch=>`<option value="${ch.id}" ${c.channels?.[k]===ch.id?'selected':''}># ${escapeHtml(ch.name)}</option>`).join('')}</select></div>`).join('')}</section><section class="manager-section"><h4>Member Manager</h4><p class="muted">Search cached/server members, edit nicknames and manageable roles.</p><div class="member-search"><input id="managerMemberSearch" class="manager-input" placeholder="Name, username or Discord ID"><button id="managerMemberSearchBtn">Search</button></div><div id="managerMembers" class="member-list"><p class="muted">Search for a member.</p></div></section><section class="manager-section"><h4>Channel Manager</h4><p class="muted">Slowmode and send-message locks for text channels.</p><div class="channel-manager">${textChannels.slice(0,60).map(ch=>`<div class="channel-manage-row"><div class="line"><b># ${escapeHtml(ch.name)}</b><small>${ch.slowmode||0}s slowmode</small></div><div class="channel-actions"><input type="number" min="0" max="21600" value="${ch.slowmode||0}" data-slowinput="${ch.id}"><button class="mini-btn" data-slow="${ch.id}">Set slowmode</button><button class="mini-btn" data-lock="${ch.id}|1">Lock</button><button class="mini-btn" data-lock="${ch.id}|0">Unlock</button></div></div>`).join('')||'<p class="muted">No text channels cached.</p>'}</div></section><section class="manager-section"><h4>Moderation Activity</h4><p class="muted">Recent moderation commands and dashboard server actions.</p><div class="feed mod-feed">${(m.recentModeration||[]).length?(m.recentModeration||[]).map(e=>`<div class="event"><i></i><span class="type">${escapeHtml(e.command||e.controlAction||e.type)}</span><span>${escapeHtml(eventMessage(e))}</span><time>${ago(e.at)}</time></div>`).join(''):'<div class="event"><i></i><span class="type">Quiet</span><span>No recent moderation activity.</span></div>'}</div></section></div>`;document.querySelectorAll('[data-feature]').forEach(btn=>btn.onclick=()=>toggleServerFeature(btn.dataset.feature,c.features?.[btn.dataset.feature]===false));$('managerLanguage').onchange=()=>updateServerLanguage($('managerLanguage').value);document.querySelectorAll('[data-configchannel]').forEach(s=>s.onchange=()=>updateServerChannel(s.dataset.configchannel,s.value||null));$('managerMemberSearchBtn').onclick=searchManagedMembers;$('managerMemberSearch').onkeydown=e=>{if(e.key==='Enter')searchManagedMembers()};document.querySelectorAll('[data-slow]').forEach(btn=>btn.onclick=()=>updateChannelSlowmode(btn.dataset.slow));document.querySelectorAll('[data-lock]').forEach(btn=>btn.onclick=()=>{const [ch,v]=btn.dataset.lock.split('|');updateChannelLock(ch,v==='1')})}

  async function refreshManagedGuild(){if(!state.managedGuild)return;state.serverManager=await api(`/api/server-manager/${state.managedGuild}`);renderServerManager()}
  async function toggleServerFeature(feature,enabled){if(!await confirmAction(`${enabled?'Enable':'Disable'} ${humanFeature(feature)}?`,`This changes Selina's configuration for ${state.serverManager?.name||'this server'}.`))return;try{await apiPost(`/api/server-manager/${state.managedGuild}/config/feature`,{feature,enabled,confirm:true});toast(`${humanFeature(feature)} ${enabled?'enabled':'disabled'}`);await refreshManagedGuild()}catch(e){toast(e.message,true)}}
  async function updateServerLanguage(language){if(!await confirmAction('Change server language?',`Selina will use ${language==='ar'?'Arabic':'English'} for this server.`)){renderServerManager();return}try{await apiPost(`/api/server-manager/${state.managedGuild}/config/language`,{language,confirm:true});toast('Server language updated');await refreshManagedGuild()}catch(e){toast(e.message,true)}}
  async function updateServerChannel(key,channelId){if(!await confirmAction('Update configured channel?','This changes where the selected Selina system sends messages.')){renderServerManager();return}try{await apiPost(`/api/server-manager/${state.managedGuild}/config/channel`,{key,channelId,confirm:true});toast('Configured channel updated');await refreshManagedGuild()}catch(e){toast(e.message,true)}}
  async function searchManagedMembers(){const box=$('managerMembers'),q=$('managerMemberSearch').value.trim();box.innerHTML='<p class="muted">Searching…</p>';try{const r=await api(`/api/server-manager/${state.managedGuild}/members?q=${encodeURIComponent(q)}`);renderManagedMembers(r.users||[])}catch(e){box.innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`}}
  function renderManagedMembers(users){const box=$('managerMembers'),roles=(state.serverManager?.roles||[]).filter(r=>r.editable&&!r.managed);box.innerHTML=users.length?users.map(u=>`<div class="member-card"><div class="member-head"><img src="${escapeHtml(u.avatar||'')}"><div><b>${escapeHtml(u.displayName)}</b><small>@${escapeHtml(u.username)}${u.bot?' · bot':''}</small></div><span class="pill">${u.roles.length} roles</span></div><div class="member-actions"><input data-nickinput="${u.id}" placeholder="Nickname (blank clears)" value="${escapeHtml(u.displayName===u.globalName||u.displayName===u.username?'':u.displayName)}"><button class="mini-btn" data-nick="${u.id}">Save nickname</button></div><div class="member-actions"><select data-role="${u.id}"><option value="">Choose manageable role</option>${roles.map(r=>`<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('')}</select><div><button class="mini-btn" data-roleadd="${u.id}">Add</button> <button class="mini-btn" data-roleremove="${u.id}">Remove</button></div></div></div>`).join(''):'<p class="muted">No members found.</p>';document.querySelectorAll('[data-nick]').forEach(btn=>btn.onclick=()=>saveMemberNickname(btn.dataset.nick));document.querySelectorAll('[data-roleadd]').forEach(btn=>btn.onclick=()=>changeMemberRole(btn.dataset.roleadd,'add'));document.querySelectorAll('[data-roleremove]').forEach(btn=>btn.onclick=()=>changeMemberRole(btn.dataset.roleremove,'remove'))}
  async function saveMemberNickname(userId){const input=document.querySelector(`[data-nickinput="${userId}"]`),nickname=input?.value||'';if(!await confirmAction('Change nickname?',nickname?`Set the member nickname to "${nickname}"?`:'Clear this member nickname?'))return;try{await apiPost(`/api/server-manager/${state.managedGuild}/members/${userId}/nickname`,{nickname,confirm:true});toast('Nickname updated');await searchManagedMembers()}catch(e){toast(e.message,true)}}
  async function changeMemberRole(userId,operation){const select=document.querySelector(`[data-role="${userId}"]`),roleId=select?.value;if(!roleId){toast('Choose a role first',true);return}const role=state.serverManager?.roles?.find(r=>r.id===roleId);if(!await confirmAction(`${operation==='add'?'Add':'Remove'} role?`,`${operation==='add'?'Add':'Remove'} ${role?.name||'this role'} ${operation==='add'?'to':'from'} this member?`))return;try{await apiPost(`/api/server-manager/${state.managedGuild}/members/${userId}/role`,{roleId,operation,confirm:true});toast(`Role ${operation==='add'?'added':'removed'}`);await searchManagedMembers()}catch(e){toast(e.message,true)}}
  async function updateChannelSlowmode(channelId){const input=document.querySelector(`[data-slowinput="${channelId}"]`),seconds=Number(input?.value||0);if(!await confirmAction('Change slowmode?',`Set this channel slowmode to ${seconds} seconds?`))return;try{await apiPost(`/api/server-manager/${state.managedGuild}/channels/${channelId}/slowmode`,{seconds,confirm:true});toast('Slowmode updated');await refreshManagedGuild()}catch(e){toast(e.message,true)}}
  async function updateChannelLock(channelId,locked){if(!await confirmAction(`${locked?'Lock':'Unlock'} channel?`,locked?'Members affected by @everyone will be prevented from sending messages.':'Restore inherited Send Messages permission for @everyone?'))return;try{await apiPost(`/api/server-manager/${state.managedGuild}/channels/${channelId}/lock`,{locked,confirm:true});toast(locked?'Channel locked':'Channel unlocked');await refreshManagedGuild()}catch(e){toast(e.message,true)}}

  function renderCommands(){const c=state.commands||{commands:[],totalTracked:0,last24h:0,uniqueCommands:0};$('commandSummary').innerHTML=`<article><span>Tracked uses</span><b>${c.totalTracked}</b><small>Current process</small></article><article><span>Last 24h</span><b>${c.last24h}</b><small>Command events</small></article><article><span>Unique</span><b>${c.uniqueCommands}</b><small>Commands used</small></article>`;$('commandTable').innerHTML='<div class="tr"><span>Command</span><span>Uses</span><span>Users</span><span class="optional">Servers</span><span class="optional">Last</span></div>'+c.commands.map(x=>`<div class="tr clickrow" data-command="${escapeHtml(x.command)}"><b>/${escapeHtml(x.command)}</b><span>${x.uses}</span><span>${x.uniqueUsers}</span><span class="optional">${x.uniqueGuilds}</span><span class="optional">${x.lastUsedAt?ago(x.lastUsedAt):'—'}</span></div>`).join('')}
  async function openCommand(command){let box=$('commandDetail');if(!box){box=document.createElement('article');box.id='commandDetail';box.className='panel command-detail';$('commandTable').parentElement.after(box)}box.textContent='Loading command…';try{const d=await api(`/api/analytics/commands/${encodeURIComponent(command)}?days=${state.analyticsDays||30}`);box.innerHTML=`<div class="head"><div><p class="eyebrow">COMMAND DETAIL</p><h3>/${escapeHtml(command)}</h3></div><span class="pill">${d.totals?.uses||0} uses</span></div><div class="history-grid"><div><span>Uses</span><b>${d.totals?.uses||0}</b></div><div><span>Users</span><b>${d.totals?.uniqueUsers||0}</b></div><div><span>Servers</span><b>${d.totals?.uniqueGuilds||0}</b></div><div><span>Last used</span><b>${d.totals?.lastUsedAt?ago(d.totals.lastUsedAt):'—'}</b></div></div><p class="eyebrow" style="margin-top:16px">TOP SERVERS</p><div class="chips">${(d.guilds||[]).map(x=>`<span class="chip">${escapeHtml(x.guildName||x.guildId)} · ${x.uses}</span>`).join('')||'<span class="chip">No data</span>'}</div>`}catch(e){box.textContent=e.message}}
  function renderDiagnostics(){const d=state.diagnostics||{errors:[],warnings:[],counts:{errors:0,warnings:0,logs:0}};$('diagnosticSummary').innerHTML=`<article><span>Errors</span><b>${d.counts.errors}</b><small>Captured</small></article><article><span>Warnings</span><b>${d.counts.warnings}</b><small>Captured</small></article><article><span>Logs</span><b>${d.counts.logs}</b><small>Buffer</small></article>`;const r=[...d.errors.map(x=>({...x,k:'error'})),...d.warnings.map(x=>({...x,k:'warn'}))].sort((a,b)=>(b.at||0)-(a.at||0));$('diagnosticList').innerHTML=r.length?r.map(x=>`<div class="event diag-${x.k}"><i></i><span class="type">${x.k}</span><span>${escapeHtml((x.context?x.context+': ':'')+(x.message||''))}</span><time>${ago(x.at)}</time></div>`).join(''):'<div class="event"><i></i><span class="type">Clean</span><span>No warnings or errors captured.</span></div>'}
  function renderSystem(){const s=state.system;if(!s)return;$('sysNode').textContent=s.node;$('sysPlatform').textContent=s.platform;$('sysArch').textContent=s.arch;$('sysRam').textContent=bytes(s.memory.processRss);$('sysDisk').textContent=s.disk?bytes(s.disk.free):'—'}
  function activityHtml(es){return es.length?es.map(e=>`<div class="event"><i></i><span class="type">${escapeHtml(e.type)}</span><span>${escapeHtml(eventMessage(e))}</span><time>${ago(e.at)}</time></div>`).join(''):'<div class="event"><i></i><span class="type">Quiet</span><span>No recent activity.</span></div>'}
  function renderActivity(){const a=[...state.events].reverse();$('overviewActivity').innerHTML=activityHtml(a.slice(0,8));const f=state.filter==='all'?a:a.filter(e=>e.type===state.filter);$('fullActivity').innerHTML=activityHtml(f.slice(0,180))}
  function renderHistory(){const s=state.summary||{};const box=$('historySummary');if(!box)return;box.innerHTML=`<div><span>Commands</span><b>${s.commands||0}</b></div><div><span>Active users</span><b>${s.activeUsers||0}</b></div><div><span>Active servers</span><b>${s.activeGuilds||0}</b></div><div><span>Music events</span><b>${s.music||0}</b></div><div><span>Errors</span><b>${s.errors||0}</b></div>`}
  function renderTrends(){const s=state.summary||{};$('trendSummary').innerHTML=`<article><span>Commands</span><b>${s.commands||0}</b><small>${state.analyticsDays} days</small></article><article><span>Active users</span><b>${s.activeUsers||0}</b><small>Unique command users</small></article><article><span>Errors</span><b>${s.errors||0}</b><small>Persistent count</small></article>`;const rows=state.daily?.daily||[],max=Math.max(1,...rows.map(x=>x.commands||0));$('dailyChart').innerHTML=rows.length?rows.map(x=>`<div class="chart-day" title="${x.day}: ${x.commands} commands"><i style="height:${Math.max(2,(x.commands/max)*145)}px"></i><small>${x.day.slice(5)}</small></div>`).join(''):'<p class="muted">No historical data yet.</p>';const hs=state.health?.samples||[];if(!hs.length){$('healthSummary').innerHTML='<div><span>Samples</span><b>0</b></div>';return}const avgPing=Math.round(hs.reduce((a,x)=>a+(Number(x.ping)||0),0)/hs.length),last=hs[hs.length-1],peak=Math.max(...hs.map(x=>Number(x.rss)||0));$('healthSummary').innerHTML=`<div><span>Samples</span><b>${hs.length}</b></div><div><span>Avg ping</span><b>${avgPing}ms</b></div><div><span>Current RAM</span><b>${bytes(last.rss)}</b></div><div><span>Peak RAM</span><b>${bytes(peak)}</b></div><div><span>Disk free</span><b>${bytes(last.diskFree)}</b></div>`}
  async function searchUsers(){const q=$('userSearch').value.trim(),box=$('userResults');if(!q){box.innerHTML='';return}box.innerHTML='<article class="card">Searching…</article>';try{const r=await api(`/api/users/search?q=${encodeURIComponent(q)}`);box.innerHTML=r.users.length?r.users.map(u=>`<article class="card" data-user="${u.id}"><div class="cardtop"><img src="${escapeHtml(u.avatar||'')}"><div><h3>${escapeHtml(u.globalName||u.username)}</h3><p>@${escapeHtml(u.username)} · ${u.guilds.length} mutual server${u.guilds.length===1?'':'s'}</p></div></div></article>`).join(''):'<article class="card"><h3>No cached users found</h3><p>Try a Discord ID or another name.</p></article>';document.querySelectorAll('[data-user]').forEach(e=>e.onclick=()=>openUser(e.dataset.user))}catch(e){box.innerHTML=`<article class="card">${escapeHtml(e.message)}</article>`}}
  async function openUser(id){const b=$('userDetail');b.innerHTML='<article class="panel">Loading user…</article>';try{const [d,l]=await Promise.all([api(`/api/users/${id}?days=${state.analyticsDays||30}`),api(`/api/levels/users/${id}`)]),u=d.user,a=d.analytics,t=a.totals||{};b.innerHTML=`<article class="panel"><div class="profile"><img src="${escapeHtml(u.avatar||'')}"><div><b>${escapeHtml(u.globalName||u.username)}</b><span>@${escapeHtml(u.username)} · ${escapeHtml(u.id)}</span></div></div><div class="history-grid" style="margin-top:18px"><div><span>Commands</span><b>${t.commands||0}</b></div><div><span>Unique commands</span><b>${t.uniqueCommands||0}</b></div><div><span>Mutual servers</span><b>${d.mutualGuilds.length}</b></div><div><span>Last seen</span><b>${t.lastSeenAt?ago(t.lastSeenAt):'—'}</b></div></div><p class="eyebrow" style="margin-top:18px">TOP COMMANDS</p><div class="chips">${(a.commands||[]).map(x=>`<span class="chip">/${escapeHtml(x.command)} · ${x.uses}</span>`).join('')||'<span class="chip">No tracked commands</span>'}</div><p class="eyebrow" style="margin-top:18px">MUTUAL SERVERS</p><div class="chips">${d.mutualGuilds.map(g=>`<span class="chip">${escapeHtml(g.name)}</span>`).join('')||'<span class="chip">None cached</span>'}</div><div class="profile-levels"><p class="eyebrow">LEVEL PROFILES</p>${(l.rows||[]).map(r=>`<div class="profile-level-card"><div class="headrow"><b>${escapeHtml(r.guildName)} · Level ${r.level}</b><span>${r.totalXp.toLocaleString()} XP</span></div><small>${r.xp.toLocaleString()} / ${r.requiredXp.toLocaleString()} XP · ${r.messages.toLocaleString()} messages · ${formatVoice(r.voiceSeconds)}</small><div class="xpbar"><i style="width:${Math.max(0,Math.min(100,r.progress))}%"></i></div><div class="achievement-grid">${r.unlocked.map(a=>`<span class="achievement" title="${escapeHtml(a.description)}">${a.icon} ${escapeHtml(a.name)}</span>`).join('')||'<span class="muted">No achievements unlocked</span>'}</div></div>`).join('')||'<p class="muted">No leveling profile yet.</p>'}</div></article>`}catch(e){b.innerHTML=`<article class="panel">${escapeHtml(e.message)}</article>`}}
  function toast(message,bad=false){const b=$('controlToast');b.textContent=message;b.classList.remove('hidden','bad');if(bad)b.classList.add('bad');clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>b.classList.add('hidden'),2800)}
  function confirmAction(title,message){return new Promise(resolve=>{const wrap=document.createElement('div');wrap.className='confirmback';wrap.innerHTML=`<div class="confirmbox"><p class="eyebrow">CONFIRM ACTION</p><h3>${escapeHtml(title)}</h3><p class="muted">${escapeHtml(message)}</p><div class="confirmbuttons"><button class="no">Cancel</button><button class="yes">Confirm</button></div></div>`;document.body.appendChild(wrap);wrap.querySelector('.no').onclick=()=>{wrap.remove();resolve(false)};wrap.querySelector('.yes').onclick=()=>{wrap.remove();resolve(true)}})}
  async function musicAction(guildId,action,value,confirm=false){try{if(confirm&&!await confirmAction('Stop music?','This will stop playback and clear the active queue.'))return;await apiPost(`/api/controls/music/${guildId}`,{action,value,confirm});toast(`Music: ${action}`);await refreshAll()}catch(e){toast(e.message,true)}}
  function renderControls(){const c=state.capabilities||{},qs=c.music?.queues||[];$('musicControls').innerHTML=qs.length?qs.map(q=>`<div class="controlqueue"><div class="top"><b>${escapeHtml(q.guildName)}</b><span class="pill">${q.paused?'Paused':'Playing'}</span></div><div class="controlbuttons"><button data-music="${q.guildId}|${q.paused?'resume':'pause'}">${q.paused?'Resume':'Pause'}</button><button data-music="${q.guildId}|skip">Skip</button><button data-music="${q.guildId}|loop|${(q.repeatMode+1)%3}">Loop: ${['Off','Song','Queue'][q.repeatMode]||'Off'}</button><button class="red" data-music="${q.guildId}|stop|confirm">Stop</button></div><div class="volume"><input type="range" min="0" max="150" value="${q.volume}" data-volume="${q.guildId}"><span>${q.volume}%</span></div></div>`).join(''):'<p class="muted">No active music queues.</p>';document.querySelectorAll('[data-music]').forEach(b=>b.onclick=()=>{const [g,a,v]=b.dataset.music.split('|');musicAction(g,a,v==='confirm'?undefined:v,v==='confirm')});document.querySelectorAll('[data-volume]').forEach(r=>{r.oninput=()=>r.nextElementSibling.textContent=`${r.value}%`;r.onchange=()=>musicAction(r.dataset.volume,'volume',r.value)});const audit=state.audit?.events||[];$('auditList').innerHTML=audit.length?audit.map(e=>`<div class="event"><i></i><span class="type">ACTION</span><span>${escapeHtml(e.controlAction||e.action||'Dashboard action')}${e.guildName?' · '+escapeHtml(e.guildName):''}</span><time>${ago(e.at)}</time></div>`).join(''):'<div class="event"><i></i><span class="type">AUDIT</span><span>No dashboard control actions yet.</span></div>'}
  async function updatePresence(){try{await apiPost('/api/controls/presence',{status:$('presenceStatus').value,text:$('presenceText').value,type:Number($('presenceType').value)});toast('Presence updated');await refreshAll()}catch(e){toast(e.message,true)}}
  async function reloadCommands(){if(!await confirmAction('Reload commands?','Selina will reload commands without restarting if this build supports it.'))return;try{await apiPost('/api/controls/reload-commands',{confirm:true});toast('Commands reloaded')}catch(e){toast(e.message,true)}}
  async function restartSelina(){if(!await confirmAction('Restart Selina?','The bot will briefly go offline. Your FPS.ms startup configuration should start it again.'))return;try{await apiPost('/api/controls/restart',{confirm:true});toast('Restart requested')}catch(e){toast(e.message,true)}}
  function formatVoice(sec){sec=Math.max(0,Number(sec)||0);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?`${h}h ${m}m`:m?`${m}m`:`${Math.floor(sec)}s`}
  async function loadLevelGuild(){const id=$('levelGuild').value;if(!id)return;try{const [board,config,sessions]=await Promise.all([api(`/api/levels/leaderboard/${id}?sort=${state.levelSort||'xp'}&limit=25`),api(`/api/levels/config/${id}`),api(`/api/levels/voice-sessions?guildId=${id}`)]);state.levelBoard=board;state.levelConfig=config;state.levelGuildSessions=sessions;renderLevelGuild()}catch(e){$('levelLeaderboard').innerHTML=`<p class="muted">${escapeHtml(e.message)}</p>`}}
  function renderLevels(){const s=state.levelSummary||{};$('levelSummary').innerHTML=`<article><span>Tracked members</span><b>${(s.users||0).toLocaleString()}</b><small>Level database</small></article><article><span>Total XP</span><b>${(s.totalXp||0).toLocaleString()}</b><small>All servers</small></article><article><span>Messages</span><b>${(s.messages||0).toLocaleString()}</b><small>XP-counted</small></article><article><span>Voice time</span><b>${formatVoice(s.voiceSeconds||0)}</b><small>${s.activeVoice||0} live sessions</small></article>`;const select=$('levelGuild'),before=select.value;select.innerHTML=(state.guilds||[]).map(g=>`<option value="${g.id}">${escapeHtml(g.name)}</option>`).join('');if(before&&state.guilds.some(g=>g.id===before))select.value=before;if(!state.levelBoard||state.levelBoard.guildId!==select.value)loadLevelGuild();else renderLevelGuild()}
  function renderLevelGuild(){const board=state.levelBoard?.users||[],sort=state.levelSort||'xp';$('levelBoardTitle').textContent=state.levelBoard?.guildName||'Top members';$('levelLeaderboard').innerHTML=board.length?board.map(u=>{const score=sort==='messages'?`${u.messages.toLocaleString()} msg`:sort==='voice'?formatVoice(u.voiceSeconds):`Lv ${u.level} · ${u.totalXp.toLocaleString()} XP`;return `<div class="levelrow" data-leveluser="${u.userId}"><span class="rank">#${u.rank}</span><img src="${escapeHtml(u.avatar||'')}"><div><b>${escapeHtml(u.displayName)}</b><small>@${escapeHtml(u.username)}</small></div><span class="score">${score}</span></div>`}).join(''):'<p class="muted">No level data for this server yet.</p>';document.querySelectorAll('[data-leveluser]').forEach(e=>e.onclick=()=>{switchView('users');openUser(e.dataset.leveluser)});const ss=state.levelGuildSessions?.sessions||[];$('voiceSessionCount').textContent=`${ss.length} active`;$('voiceSessions').innerHTML=ss.length?ss.map(v=>`<div class="levelrow"><span class="rank">●</span><img src="${escapeHtml(v.avatar||'')}"><div><b>${escapeHtml(v.displayName)}</b><small>${escapeHtml(v.channelName)}</small></div><span class="score">${formatVoice(v.sessionSeconds)}</span></div>`).join(''):'<p class="muted">Nobody is being tracked in voice right now.</p>';const c=state.levelConfig?.config;if(!c){$('levelConfig').innerHTML='<div><span>Status</span><b>Not configured</b></div>';return}$('levelConfig').innerHTML=`<div><span>Leveling</span><b>${c.leveling_enabled?'Enabled':'Disabled'}</b></div><div><span>Voice XP</span><b>${c.voice_xp_enabled?'Enabled':'Disabled'}</b></div><div><span>Message XP</span><b>${c.xp_min||15}–${c.xp_max||25}</b></div><div><span>Cooldown</span><b>${Math.round((c.xp_cooldown||60000)/1000)}s</b></div><div><span>Level factor</span><b>${c.level_factor||100}</b></div><div><span>Voice award</span><b>${c.voice_xp_amount||10} XP</b></div><div><span>Voice interval</span><b>${Math.round((c.voice_xp_interval||60000)/1000)}s</b></div><div><span>Booster</span><b>${c.booster_multiplier||1.5}×</b></div>`}
  async function loadCenter(view){try{if(view==='commandcenter'){state.cc=await api(`/api/centers/commands?days=${state.analyticsDays||30}`);renderCommandCenter()}if(view==='aicenter'){state.aiCenter=await api(`/api/centers/ai?days=${state.analyticsDays||30}`);renderAiCenter()}if(view==='modcenter'){state.modCenter=await api('/api/centers/moderation');renderModCenter()}if(view==='musicpro'){state.musicPro=await api('/api/centers/music');renderMusicPro()}if(view==='console'&&!state.consolePaused){await loadConsole()}}catch(e){toast(e.message,true)}}
  function feedHtml(events,empty='No activity yet.'){return events?.length?events.map(e=>`<div class="event"><i></i><span class="type">${escapeHtml(e.command||e.action||e.level||e.type||'EVENT')}</span><span>${escapeHtml(eventMessage(e))}</span><time>${ago(e.at)}</time></div>`).join(''):`<div class="event"><i></i><span class="type">QUIET</span><span>${empty}</span></div>`}
  function renderCommandCenter(){const d=state.cc||{},uses=(d.commands||[]).reduce((s,x)=>s+(x.uses||0),0);$('ccMetrics').innerHTML=`<article><span>Loaded</span><b>${(d.loaded||[]).length}</b><small>Slash commands</small></article><article><span>Uses</span><b>${uses.toLocaleString()}</b><small>${d.days||30}-day analytics</small></article><article><span>Recent</span><b>${(d.recent||[]).length}</b><small>Telemetry window</small></article><article><span>Errors</span><b>${(d.errors||[]).length}</b><small>Recent runtime</small></article>`;$('ccUsage').innerHTML=(d.commands||[]).slice(0,30).map((x,i)=>`<div class="table-row"><span>#${i+1}</span><b>/${escapeHtml(x.command)}</b><span>${x.uses||0} uses</span></div>`).join('')||'<p class="muted">No command analytics yet.</p>';$('ccRecent').innerHTML=feedHtml(d.recent,'No commands executed recently.');$('ccLoaded').innerHTML=(d.loaded||[]).map(c=>`<div class="command-card"><b>/${escapeHtml(c.name)}</b><small>${escapeHtml(c.description||'No description')}</small></div>`).join('')}
  function renderAiCenter(){const d=state.aiCenter||{};$('aiMetrics').innerHTML=`<article><span>Requests</span><b>${d.requests||0}</b><small>${d.days||30}-day window</small></article><article><span>Errors</span><b>${d.errors||0}</b><small>AI-related telemetry</small></article><article><span>Success</span><b>${d.successRate??100}%</b><small>Approx. telemetry rate</small></article>`;$('aiRecent').innerHTML=feedHtml(d.recent,'No AI command activity in the current telemetry window.');$('aiErrors').innerHTML=feedHtml(d.recentErrors,'No recent AI errors.');$('aiNote').textContent=d.note||''}
  function renderModCenter(){const d=state.modCenter||{};$('modMetrics').innerHTML=`<article><span>Recent actions</span><b>${d.total||0}</b><small>Current telemetry window</small></article><article><span>Action types</span><b>${(d.actions||[]).length}</b><small>Moderation commands</small></article>`;$('modActions').innerHTML=(d.actions||[]).map((x,i)=>`<div class="table-row"><span>#${i+1}</span><b>/${escapeHtml(x.command)}</b><span>${x.uses} actions</span></div>`).join('')||'<p class="muted">No moderation activity yet.</p>';$('modRecent').innerHTML=feedHtml(d.recent,'No recent moderation commands.')}
  function renderMusicPro(){const d=state.musicPro||{},songs=(d.queues||[]).reduce((s,q)=>s+(q.songs||[]).length,0);$('musicProMetrics').innerHTML=`<article><span>Active queues</span><b>${(d.queues||[]).length}</b><small>Right now</small></article><article><span>Queued tracks</span><b>${songs}</b><small>Across servers</small></article><article><span>Music events</span><b>${(d.events||[]).length}</b><small>Telemetry window</small></article>`;$('musicProQueues').innerHTML=(d.queues||[]).map(q=>`<article class="queue-pro"><div class="head"><div><p class="eyebrow">${q.paused?'PAUSED':'PLAYING'}</p><h3>${escapeHtml(q.guildName)}</h3></div><span class="pill">${q.volume}% · Loop ${q.repeatMode}</span></div>${(q.songs||[]).map((s,i)=>`<div class="queue-song"><span>${i+1}</span><b>${escapeHtml(s.name)}</b><span>${escapeHtml(String(s.duration||''))}</span></div>`).join('')||'<p class="muted">Queue metadata unavailable.</p>'}</article>`).join('')||'<article class="panel"><p class="muted">No active music queues.</p></article>';$('musicProEvents').innerHTML=feedHtml(d.events,'No recent music telemetry.')}
  async function loadConsole(){const q=encodeURIComponent($('consoleSearch')?.value||''),level=encodeURIComponent($('consoleLevel')?.value||'');const d=await api(`/api/centers/console?limit=300&q=${q}&level=${level}`);state.consoleData=d;renderConsole()}
  function renderConsole(){const events=state.consoleData?.events||[];$('consoleOutput').innerHTML=events.length?events.map(e=>{const lvl=String(e.level||e.type||'event').toLowerCase(),msg=eventMessage(e)||JSON.stringify(e);return `<div class="console-line ${lvl.includes('error')?'error':lvl.includes('warn')?'warn':''}"><time>${new Date(e.at||Date.now()).toLocaleTimeString()}</time><span class="lvl">${escapeHtml(lvl)}</span><span>${escapeHtml(msg)}</span></div>`}).join(''):'<div class="console-line"><span></span><span class="lvl">quiet</span><span>No matching telemetry.</span></div>'}
  function switchView(v){document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b.dataset.view===v));document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id===`view-${v}`));$('pageTitle').textContent=({overview:'Overview',servers:'Server Manager',users:'Users',levels:'Levels & Voice',commands:'Commands',activity:'Activity',music:'Music',controls:'Controls',trends:'Trends',diagnostics:'Diagnostics',system:'Runtime'})[v]||'Selina'}
  document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>switchView(b.dataset.view));document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x===b));renderActivity()});
  $('savePresence').addEventListener('click',updatePresence);$('reloadCommands').addEventListener('click',reloadCommands);$('restartSelina').addEventListener('click',restartSelina);
  $('levelGuild').addEventListener('change',loadLevelGuild);document.querySelectorAll('[data-levelsort]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-levelsort]').forEach(x=>x.classList.remove('active'));b.classList.add('active');state.levelSort=b.dataset.levelsort;loadLevelGuild()});
  $('consoleRefresh').addEventListener('click',()=>loadConsole().catch(e=>toast(e.message,true)));$('consoleSearch').addEventListener('keydown',e=>{if(e.key==='Enter')loadConsole().catch(x=>toast(x.message,true))});$('consoleLevel').addEventListener('change',()=>loadConsole().catch(e=>toast(e.message,true)));$('consolePause').addEventListener('click',()=>{state.consolePaused=!state.consolePaused;$('consolePause').textContent=state.consolePaused?'Resume':'Pause';if(!state.consolePaused)loadConsole().catch(()=>{})});
  $('userSearchButton').addEventListener('click',searchUsers);$('userSearch').addEventListener('keydown',e=>{if(e.key==='Enter')searchUsers()});document.querySelectorAll('.rangebtn').forEach(b=>b.onclick=async()=>{state.analyticsDays=Number(b.dataset.days)||30;document.querySelectorAll('.rangebtn').forEach(x=>x.classList.toggle('active',x===b));await refreshAll()});
  $('discordLoginButton').addEventListener('click',startDiscordLogin);$('connectButton').addEventListener('click',connect);$('ownerKey').addEventListener('keydown',e=>{if(e.key==='Enter')connect()});$('disconnectButton').addEventListener('click',()=>disconnect(true));
  const savedBase=localStorage.getItem('selinaDashboardBase');if(savedBase&&savedBase!==location.origin)$('backendUrl').value=savedBase;
  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
  (async()=>{const handled=await finishDiscordLogin();if(!handled)await resumeSession()})();
})();
