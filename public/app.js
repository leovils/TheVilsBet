// Mapeamento de bandeiras
const flagMap = {
  "Mexico": "🇲🇽",
  "South Africa": "🇿🇦",
  "South Korea": "🇰🇷",
  "Czech Republic": "🇨🇿",
  "Canada": "🇨🇦",
  "Bosnia & Herzegovina": "🇧🇦",
  "Qatar": "🇶🇦",
  "Switzerland": "🇨🇭",
  "Brazil": "🇧🇷",
  "Morocco": "🇲🇦",
  "Haiti": "🇭🇹",
  "Scotland": "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "USA": "🇺🇸",
  "Paraguay": "🇵🇾",
  "Australia": "🇦🇺",
  "Turkey": "🇹🇷",
  "Germany": "🇩🇪",
  "Curaçao": "🇨🇼",
  "Ivory Coast": "🇨🇮",
  "Ecuador": "🇪🇨",
  "Netherlands": "🇳🇱",
  "Japan": "🇯🇵",
  "Sweden": "🇸🇪",
  "Tunisia": "🇹🇳",
  "Belgium": "🇧🇪",
  "Egypt": "🇪🇬",
  "Iran": "🇮🇷",
  "New Zealand": "🇳🇿",
  "Spain": "🇪🇸",
  "Cape Verde": "🇨🇻",
  "Saudi Arabia": "🇸🇦",
  "Uruguay": "🇺🇾",
  "France": "🇫🇷",
  "Senegal": "🇸🇳",
  "Iraq": "🇮🇶",
  "Norway": "🇳🇴",
  "Argentina": "🇦🇷",
  "Algeria": "🇩🇿",
  "Austria": "🇦🇹",
  "Jordan": "🇯🇴",
  "Portugal": "🇵🇹",
  "DR Congo": "🇨🇩",
  "Uzbekistan": "🇺🇿",
  "Colombia": "🇨🇴",
  "England": "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "Croatia": "🇭🇷",
  "Ghana": "🇬🇭",
  "Panama": "🇵🇦"
};

function getFlag(team) {
  return flagMap[team] || "🏳️";
}

// Estado do App
let currentUser = localStorage.getItem('thevilsbet_user') || null;
let currentPIN = localStorage.getItem('thevilsbet_pin') || null;
let activeAuthTab = 'login';

let leaderboard = [];
let allMatches = [];
let activeGroupFilter = 'all';
let activeStatusFilter = 'all';
let activeSearchQuery = '';

let adminAuthenticated = false;
let adminPIN = '';

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  if (currentUser && currentPIN) {
    showDashboard();
    loadData();
  } else {
    showAuth();
  }
}

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('user-status').innerHTML = '';
}

function showDashboard() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
}

function switchAuthTab(tab) {
  activeAuthTab = tab;
  document.getElementById('tab-btn-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-btn-register').classList.toggle('active', tab === 'register');
  
  const submitBtn = document.getElementById('auth-submit-btn');
  submitBtn.innerText = tab === 'login' ? 'Entrar' : 'Cadastrar e Entrar';
  
  const helper = document.querySelector('.input-helper');
  helper.innerText = tab === 'login' ? 'Insira seu PIN de 4 dígitos cadastrado.' : 'Escolha um PIN de 4 dígitos para proteger seus palpites.';
}

async function handleAuth(event) {
  event.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const pin = document.getElementById('auth-pin').value.trim();
  const errorDiv = document.getElementById('auth-error');

  errorDiv.classList.add('hidden');

  if (!username || pin.length !== 4 || isNaN(pin)) {
    errorDiv.innerText = 'Preencha o nome e um PIN numérico de 4 dígitos.';
    errorDiv.classList.remove('hidden');
    return;
  }

  const url = activeAuthTab === 'login' ? '/api/login' : '/api/register';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, pin })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erro na autenticação');
    }

    // Login com sucesso
    currentUser = data.username;
    currentPIN = pin;
    localStorage.setItem('thevilsbet_user', currentUser);
    localStorage.setItem('thevilsbet_pin', currentPIN);

    showDashboard();
    loadData();
    
    // Limpar form
    document.getElementById('auth-username').value = '';
    document.getElementById('auth-pin').value = '';
  } catch (error) {
    errorDiv.innerText = error.message;
    errorDiv.classList.remove('hidden');
  }
}

function logout() {
  currentUser = null;
  currentPIN = null;
  localStorage.removeItem('thevilsbet_user');
  localStorage.removeItem('thevilsbet_pin');
  adminAuthenticated = false;
  adminPIN = '';
  document.getElementById('admin-panel').classList.add('hidden');
  document.getElementById('admin-auth-card').classList.remove('hidden');
  document.getElementById('admin-pin-input').value = '';
  showAuth();
}

async function loadData() {
  try {
    const res = await fetch(`/api/data?username=${encodeURIComponent(currentUser)}`);
    const data = await res.json();
    
    leaderboard = data.leaderboard;
    allMatches = data.matches;

    updateUserStatus();
    renderLeaderboard();
    renderGroupTabs();
    renderMatches();
    if (adminAuthenticated) {
      renderAdminMatches();
    }
  } catch (e) {
    console.error('Erro ao carregar dados:', e);
  }
}

function updateUserStatus() {
  const container = document.getElementById('user-status');
  if (!currentUser) return;

  const myRankingInfo = leaderboard.find(x => x.username === currentUser);
  const coins = myRankingInfo ? myRankingInfo.score : 0;
  const myIndex = leaderboard.findIndex(x => x.username === currentUser);
  const rank = myIndex !== -1 ? myIndex + 1 : '-';

  container.innerHTML = `
    <div class="user-badge">
      <span class="user-name">👤 ${currentUser}</span>
      <span class="user-coins">🪙 ${coins} TheVils</span>
      <span class="badge badge-gold">#${rank}º Lugar</span>
    </div>
    <button class="btn btn-secondary" onclick="logout()" style="padding: 8px 16px; font-size: 0.9rem;">Sair</button>
  `;
}

// Gerenciador de Abas
function openTab(tabId) {
  const tabs = document.querySelectorAll('.tab-content');
  tabs.forEach(tab => tab.classList.add('hidden'));

  const tabLinks = document.querySelectorAll('.tab-link');
  tabLinks.forEach(link => link.classList.remove('active'));

  document.getElementById(tabId).classList.remove('hidden');
  
  // Achar o botão clicado e marcar como ativo
  const btnText = {
    'tab-leaderboard': 'Classificação',
    'tab-matches': 'Jogos e Palpites',
    'tab-rules': 'Regras',
    'tab-admin': 'Admin'
  }[tabId];

  Array.from(tabLinks).find(link => link.innerText.includes(btnText)).classList.add('active');
}

// Renderização: Tabela de Classificação
function renderLeaderboard() {
  const body = document.getElementById('leaderboard-body');
  body.innerHTML = '';

  if (leaderboard.length === 0) {
    body.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhum participante cadastrado ainda.</td></tr>`;
    return;
  }

  leaderboard.forEach((user, idx) => {
    const position = idx + 1;
    let rankBadgeClass = 'rank-other';
    if (position === 1) rankBadgeClass = 'rank-1';
    else if (position === 2) rankBadgeClass = 'rank-2';
    else if (position === 3) rankBadgeClass = 'rank-3';

    const row = document.createElement('tr');
    if (user.username === currentUser) {
      row.style.backgroundColor = 'rgba(0, 210, 255, 0.05)';
      row.style.borderLeft = '3px solid var(--neon-blue)';
    }

    row.innerHTML = `
      <td>
        <span class="rank-badge ${rankBadgeClass}">${position}</span>
      </td>
      <td>
        <span style="font-weight: 700;">${user.username} ${user.username === currentUser ? ' (Você)' : ''}</span>
      </td>
      <td style="text-align: center; color: var(--gold); font-weight: 700;">${user.exactScores}</td>
      <td style="text-align: center; color: var(--text-main); font-weight: 600;">${user.outcomeScores}</td>
      <td style="text-align: right; color: var(--gold); font-size: 1.1rem; font-weight: 800;">🪙 ${user.score}</td>
    `;
    body.appendChild(row);
  });
}

// Renderização: Filtros de Grupos (A-L)
function renderGroupTabs() {
  const container = document.getElementById('group-filter-tabs');
  // Limpar os botões de grupos dinâmicos, mantendo o "Todos"
  container.innerHTML = `<button class="group-tab-btn ${activeGroupFilter === 'all' ? 'active' : ''}" onclick="filterByGroup('all')">Todos</button>`;
  
  const groups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  groups.forEach(g => {
    const groupName = `Group ${g}`;
    const btn = document.createElement('button');
    btn.className = `group-tab-btn ${activeGroupFilter === groupName ? 'active' : ''}`;
    btn.innerText = `Grupo ${g}`;
    btn.onclick = () => filterByGroup(groupName);
    container.appendChild(btn);
  });
}

// Filtros de Jogos
function filterMatches() {
  activeSearchQuery = document.getElementById('match-search').value.trim().toLowerCase();
  activeStatusFilter = document.getElementById('match-filter-status').value;
  renderMatches();
}

function filterByGroup(group) {
  activeGroupFilter = group;
  const btns = document.querySelectorAll('.group-tab-btn');
  btns.forEach(btn => {
    const isTarget = (group === 'all' && btn.innerText === 'Todos') || 
                     (group !== 'all' && btn.innerText === `Grupo ${group.split(' ')[1]}`);
    btn.classList.toggle('active', isTarget);
  });
  renderMatches();
}

// Renderização: Cards de Jogos
function renderMatches() {
  const grid = document.getElementById('matches-grid');
  grid.innerHTML = '';

  const filtered = allMatches.filter(match => {
    // 1. Filtro por grupo
    if (activeGroupFilter !== 'all' && match.group !== activeGroupFilter) return false;

    // 2. Filtro por pesquisa textual (times ou estádio)
    if (activeSearchQuery) {
      const t1 = match.team1.toLowerCase();
      const t2 = match.team2.toLowerCase();
      const st = match.stadium.toLowerCase();
      if (!t1.includes(activeSearchQuery) && !t2.includes(activeSearchQuery) && !st.includes(activeSearchQuery)) {
        return false;
      }
    }

    // 3. Filtro por status
    if (activeStatusFilter === 'open') {
      return !match.isLocked;
    } else if (activeStatusFilter === 'locked') {
      return match.isLocked;
    } else if (activeStatusFilter === 'completed') {
      return match.status === 'completed';
    } else if (activeStatusFilter === 'my_bets') {
      return match.myPrediction !== null && 
             match.myPrediction.score1 !== null && 
             match.myPrediction.score2 !== null;
    }

    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">Nenhum jogo encontrado para os filtros selecionados.</div>`;
    return;
  }

  filtered.forEach(match => {
    const card = document.createElement('div');
    card.className = `match-card ${match.status === 'completed' ? 'completed' : ''}`;
    
    // Formatar data do jogo
    // match.date = "2026-06-11", match.time = "13:00 UTC-6"
    const dateParts = match.date.split('-');
    const formattedDate = `${dateParts[2]}/${dateParts[1]}`;
    const formattedTime = match.time.split(' ')[0];

    // Lógica de cálculo de pontuação própria obtida neste jogo
    let pointsBadgeHtml = '';
    if (match.status === 'completed' && match.myPrediction) {
      const p1 = match.myPrediction.score1;
      const p2 = match.myPrediction.score2;
      const a1 = match.score1;
      const a2 = match.score2;

      if (p1 !== null && p2 !== null) {
        if (p1 === a1 && p2 === a2) {
          pointsBadgeHtml = `<span class="badge badge-gold">🎯 +10 Moedas (Placar Exato!)</span>`;
        } else if (
          (a1 > a2 && p1 > p2) ||
          (a1 < a2 && p1 < p2) ||
          (a1 === a2 && p1 === p2)
        ) {
          pointsBadgeHtml = `<span class="badge badge-silver">⚖️ +5 Moedas (Acertou Resultado)</span>`;
        } else {
          pointsBadgeHtml = `<span class="badge badge-red">❌ +0 Moedas (Errou)</span>`;
        }
      }
    }

    // Configuração dos inputs
    const p1Val = match.myPrediction && match.myPrediction.score1 !== null ? match.myPrediction.score1 : '';
    const p2Val = match.myPrediction && match.myPrediction.score2 !== null ? match.myPrediction.score2 : '';
    const disabledAttr = match.isLocked ? 'disabled' : '';

    // Palpites da galera (se trancado)
    let othersHtml = '';
    if (match.isLocked && match.allPredictions && match.allPredictions.length > 0) {
      const listItems = match.allPredictions
        .filter(p => p.username !== currentUser)
        .map(p => `
          <span class="pred-bubble">
            <span class="pred-user">${p.username}:</span> 
            <span class="pred-val">${p.score1}x${p.score2}</span>
          </span>
        `).join('');

      if (listItems) {
        othersHtml = `
          <div class="other-predictions">
            <div class="other-predictions-title" onclick="togglePredictionsCollapse(${match.id})">
              <span>Palpites da Família</span>
              <span>▼</span>
            </div>
            <div id="preds-list-${match.id}" class="predictions-list">
              ${listItems}
            </div>
          </div>
        `;
      }
    }

    card.innerHTML = `
      <div class="match-card-header">
        <span>${match.group || 'Fase de Grupos'}</span>
        <span class="match-info-date">📅 ${formattedDate} às ${formattedTime}</span>
      </div>
      
      <div class="match-card-body">
        <div class="team-column">
          <span class="team-flag">${getFlag(match.team1)}</span>
          <span class="team-name" title="${match.team1}">${match.team1}</span>
        </div>
        
        <div class="score-column">
          <input type="number" min="0" class="score-input" value="${p1Val}" ${disabledAttr} 
            id="pred1-${match.id}" placeholder="-" onblur="autoSavePrediction(${match.id})">
          <span class="score-divider">x</span>
          <input type="number" min="0" class="score-input" value="${p2Val}" ${disabledAttr} 
            id="pred2-${match.id}" placeholder="-" onblur="autoSavePrediction(${match.id})">
        </div>
        
        <div class="team-column">
          <span class="team-flag">${getFlag(match.team2)}</span>
          <span class="team-name" title="${match.team2}">${match.team2}</span>
        </div>
      </div>

      ${match.status === 'completed' ? `
      <div class="actual-score-box">
        <div class="actual-score-label">Resultado Oficial</div>
        <div class="actual-score-value">${match.score1} - ${match.score2}</div>
      </div>
      ` : ''}

      <div class="match-card-footer">
        <span class="match-status-text" id="status-msg-${match.id}">
          ${match.status === 'completed' 
            ? '🔒 Jogo Encerrado' 
            : match.isLocked 
              ? '<span class="pulse-icon"></span> Em andamento / Ao vivo' 
              : '🔓 Apostas abertas até 15min antes'}
        </span>
        ${pointsBadgeHtml}
        ${othersHtml}
      </div>
    `;
    grid.appendChild(card);
  });
}

// Salvar palpite automaticamente no desfocar do input
async function autoSavePrediction(matchId) {
  const val1 = document.getElementById(`pred1-${matchId}`).value;
  const val2 = document.getElementById(`pred2-${matchId}`).value;
  const statusMsg = document.getElementById(`status-msg-${matchId}`);

  if (val1 === '' || val2 === '') return; // Só envia se ambos estiverem preenchidos

  const score1 = parseInt(val1, 10);
  const score2 = parseInt(val2, 10);

  try {
    statusMsg.innerHTML = '⏳ Salvando...';
    statusMsg.style.color = 'var(--neon-blue)';

    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser,
        pin: currentPIN,
        matchId: matchId,
        score1,
        score2
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar palpite');

    statusMsg.innerHTML = '✅ Palpite salvo!';
    statusMsg.style.color = 'var(--neon-green-glow)';

    // Atualizar dados em cache local
    const match = allMatches.find(m => m.id === matchId);
    if (match) {
      match.myPrediction = { score1, score2 };
    }
    
    // Recarregar os dados gerais em background após 1 segundo para atualizar ranking se necessário
    setTimeout(loadData, 1500);

  } catch (error) {
    statusMsg.innerHTML = `❌ ${error.message}`;
    statusMsg.style.color = 'var(--red)';
  }
}

function togglePredictionsCollapse(matchId) {
  const el = document.getElementById(`preds-list-${matchId}`);
  if (el) {
    el.classList.toggle('hidden');
  }
}

// ----------------- ADMIN LOGIC -----------------

function handleAdminAuth(event) {
  event.preventDefault();
  const pin = document.getElementById('admin-pin-input').value;
  const err = document.getElementById('admin-auth-error');
  err.classList.add('hidden');

  if (pin === '2026') {
    adminAuthenticated = true;
    adminPIN = pin;
    document.getElementById('admin-auth-card').classList.add('hidden');
    document.getElementById('admin-panel').classList.remove('hidden');
    renderAdminMatches();
  } else {
    err.innerText = 'Senha de administrador inválida.';
    err.classList.remove('hidden');
  }
}

async function syncMatchesWeb() {
  const btn = document.querySelector('.admin-actions button');
  const helper = document.querySelector('.action-helper');
  try {
    btn.disabled = true;
    btn.innerText = 'Sincronizando...';
    helper.innerText = 'Buscando atualizações de placares na web...';

    const res = await fetch('/api/admin/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPin: adminPIN })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    helper.innerText = 'Dados atualizados com sucesso!';
    btn.innerText = '🔄 Sincronizar Resultados da Web';
    btn.disabled = false;

    // Recarregar tudo
    loadData();
  } catch (e) {
    helper.innerText = `Erro: ${e.message}`;
    btn.innerText = '🔄 Sincronizar Resultados da Web';
    btn.disabled = false;
  }
}

function filterAdminMatches() {
  renderAdminMatches();
}

function renderAdminMatches() {
  const container = document.getElementById('admin-matches-list');
  container.innerHTML = '';

  const q = document.getElementById('admin-match-search').value.trim().toLowerCase();
  
  const filtered = allMatches.filter(m => {
    if (!q) return true;
    return m.team1.toLowerCase().includes(q) || m.team2.toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">Nenhum jogo encontrado.</div>`;
    return;
  }

  filtered.forEach(m => {
    const row = document.createElement('div');
    row.className = 'admin-match-row';

    const s1 = m.score1 !== null ? m.score1 : '';
    const s2 = m.score2 !== null ? m.score2 : '';

    row.innerHTML = `
      <div class="admin-match-info">
        <span class="admin-match-teams">${getFlag(m.team1)} ${m.team1} v ${m.team2} ${getFlag(m.team2)}</span>
        <span class="admin-match-meta">${m.group} | ${m.date} ${m.time}</span>
      </div>
      <div class="admin-match-inputs">
        <input type="number" min="0" style="width: 50px; text-align: center; padding: 5px; background: var(--bg-dark); border: 1px solid var(--border-color); color: white;" 
          value="${s1}" id="admin-s1-${m.id}" placeholder="-">
        <span style="color: var(--text-muted);">x</span>
        <input type="number" min="0" style="width: 50px; text-align: center; padding: 5px; background: var(--bg-dark); border: 1px solid var(--border-color); color: white;" 
          value="${s2}" id="admin-s2-${m.id}" placeholder="-">
        <button class="btn btn-secondary" onclick="updateAdminMatch(${m.id})" style="padding: 6px 12px; font-size: 0.85rem;">Gravar</button>
      </div>
    `;
    container.appendChild(row);
  });
}

async function updateAdminMatch(matchId) {
  const s1Val = document.getElementById(`admin-s1-${matchId}`).value;
  const s2Val = document.getElementById(`admin-s2-${matchId}`).value;

  const score1 = s1Val === '' ? null : parseInt(s1Val, 10);
  const score2 = s2Val === '' ? null : parseInt(s2Val, 10);

  try {
    const res = await fetch('/api/admin/update-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminPin: adminPIN,
        matchId,
        score1,
        score2
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Atualizado com sucesso
    loadData();
  } catch (error) {
    alert('Erro ao gravar: ' + error.message);
  }
}
