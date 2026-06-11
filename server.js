const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MATCHES_FILE = path.join(__dirname, '.data', 'matches.json');
const USERS_FILE = path.join(__dirname, '.data', 'users.json');

// Garantir inicialização dos arquivos
const dataDir = path.dirname(MATCHES_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(MATCHES_FILE)) {
  fs.writeFileSync(MATCHES_FILE, '[]', 'utf8');
}
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, '{}', 'utf8');
}

// Cache de sincronização automática (throttle de 5 minutos)
let lastSyncTime = 0;

function readMatches() {
  try {
    return JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
  } catch (e) {
    return [];
  }
}

function writeMatches(matches) {
  fs.writeFileSync(MATCHES_FILE, JSON.stringify(matches, null, 2), 'utf8');
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
}

// Auxiliar: Converte data/hora do jogo para objeto Date
function getMatchKickoffTime(match) {
  const parts = match.time.split(/\s+/);
  const timePart = parts[0]; // "13:00"
  const tzPart = parts[1] || 'UTC'; // "UTC-6"
  
  let offset = '+00:00';
  if (tzPart.startsWith('UTC')) {
    const rawOffset = tzPart.substring(3);
    if (rawOffset) {
      const sign = rawOffset.startsWith('+') ? '+' : '-';
      const val = Math.abs(parseInt(rawOffset, 10));
      offset = `${sign}${String(val).padStart(2, '0')}:00`;
    }
  }
  return new Date(`${match.date}T${timePart}:00${offset}`);
}

// Auxiliar: Verifica se a aposta está bloqueada (15 minutos antes do início)
function isMatchLocked(match) {
  const kickoff = getMatchKickoffTime(match);
  const now = new Date();
  // Bloqueia se faltar menos de 15 minutos (15 * 60 * 1000 ms)
  return now.getTime() >= (kickoff.getTime() - 15 * 60 * 1000);
}

// Auxiliar: Recalcula a pontuação de todos os usuários
function recalculateScores(matches, users) {
  const matchMap = new Map();
  matches.forEach(m => {
    if (m.score1 !== null && m.score2 !== null) {
      matchMap.set(m.id.toString(), {
        score1: parseInt(m.score1, 10),
        score2: parseInt(m.score2, 10)
      });
    }
  });

  for (let username in users) {
    let score = 0;
    let exactScores = 0;
    let outcomeScores = 0;
    const preds = users[username].predictions || {};

    for (let matchId in preds) {
      const actual = matchMap.get(matchId);
      if (!actual) continue;

      const pred = preds[matchId];
      if (pred.score1 === null || pred.score2 === null) continue;

      const p1 = parseInt(pred.score1, 10);
      const p2 = parseInt(pred.score2, 10);
      const a1 = actual.score1;
      const a2 = actual.score2;

      // 1. Placar Exato: 10 moedas
      if (p1 === a1 && p2 === a2) {
        score += 10;
        exactScores += 1;
      }
      // 2. Acerto do Vencedor ou Empate: 5 moedas
      else if (
        (a1 > a2 && p1 > p2) ||  // Vitória Mandante
        (a1 < a2 && p1 < p2) ||  // Vitória Visitante
        (a1 === a2 && p1 === p2) // Empate
      ) {
        score += 5;
        outcomeScores += 1;
      }
    }

    users[username].score = score;
    users[username].exactScores = exactScores;
    users[username].outcomeScores = outcomeScores;
  }
}

// Função para sincronizar dados do openfootball (web)
async function syncFromWeb() {
  try {
    const url = 'https://raw.githubusercontent.com/openfootball/worldcup/master/2026--usa/cup.txt';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Falha ao buscar cup.txt do GitHub');
    
    const content = await response.text();
    const lines = content.split(/\r?\n/);
    const matches = readMatches();
    let updated = false;

    // Criamos um mapa para busca rápida por times e data
    // O texto de openfootball pode ter diferenças sutis, então vamos normalizar
    const normalizeName = name => name.trim().toLowerCase()
      .replace(/korea\s+republic|south\s+korea/g, 'korea republic')
      .replace(/ir\s+iran|iran/g, 'ir iran')
      .replace(/cote\s+d\'ivoire|ivory\s+coast/g, 'ivory coast')
      .replace(/czechia|czech\s+republic/g, 'czechia');

    // Mapeamos os jogos locais existentes
    const localMatchMap = new Map();
    matches.forEach(m => {
      const key = `${normalizeName(m.team1)} v ${normalizeName(m.team2)}`;
      localMatchMap.set(key, m);
    });

    let currentGroup = null;
    let currentDate = null;

    const groupRegex = /^[^a-zA-Z0-9\s]?\s*(Group\s+[A-L])/i;
    const dateRegex = /^(Thu|Fri|Sat|Sun|Mon|Tue|Wed)\s+June\s+(\d+)/i;

    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const groupMatch = trimmed.match(groupRegex);
      if (groupMatch) {
        currentGroup = groupMatch[1];
        continue;
      }

      const dateMatch = trimmed.match(dateRegex);
      if (dateMatch) {
        const day = dateMatch[2].padStart(2, '0');
        currentDate = `2026-06-${day}`;
        continue;
      }

      if (trimmed.includes(' v ')) {
        // Formato esperado de linha com placar no cup.txt do openfootball:
        // ex: "  13:00 UTC-6     Mexico   2-1 South Africa  @ Estadio Azteca"
        // Ou se não aconteceu: "  13:00 UTC-6     Mexico   v South Africa  @ Estadio Azteca"
        let parts = trimmed.split('@');
        let matchPart = parts[0].trim();
        
        // Vamos verificar se a linha tem o resultado no formato X-Y
        // ex: "Mexico   2-1 South Africa"
        const scoreRegex = /^(.*)\s+(\d+)-(\d+)\s+(.*)$/;
        const scoreMatch = matchPart.match(scoreRegex);

        let team1 = '';
        let team2 = '';
        let s1 = null;
        let s2 = null;

        if (scoreMatch) {
          // O time1 pode ter o horário no início, vamos retirar
          let t1Part = scoreMatch[1].trim();
          t1Part = t1Part.replace(/^\d{2}:\d{2}\s+UTC[+-]\d+\s+/, '').trim();
          team1 = t1Part;
          s1 = parseInt(scoreMatch[2], 10);
          s2 = parseInt(scoreMatch[3], 10);
          team2 = scoreMatch[4].trim();
        } else {
          // Sem placar (apenas "v")
          const vSplit = matchPart.split(/\s+v\s+/);
          if (vSplit.length === 2) {
            let t1Part = vSplit[0].trim();
            t1Part = t1Part.replace(/^\d{2}:\d{2}\s+UTC[+-]\d+\s+/, '').trim();
            team1 = t1Part;
            team2 = vSplit[1].trim();
          }
        }

        if (team1 && team2) {
          const key = `${normalizeName(team1)} v ${normalizeName(team2)}`;
          const localMatch = localMatchMap.get(key);
          if (localMatch) {
            if (s1 !== null && s2 !== null) {
              if (localMatch.score1 !== s1 || localMatch.score2 !== s2) {
                localMatch.score1 = s1;
                localMatch.score2 = s2;
                localMatch.status = 'completed';
                updated = true;
              }
            }
          }
        }
      }
    }

    if (updated) {
      writeMatches(matches);
      const users = readUsers();
      recalculateScores(matches, users);
      writeUsers(users);
      console.log('Sincronização concluída: resultados atualizados.');
    } else {
      console.log('Sincronização concluída: nenhum resultado novo.');
    }
  } catch (error) {
    console.error('Erro na sincronização automática:', error.message);
  }
}

// ----------------- ROTAS DA API -----------------

// Rota de Cadastro
app.post('/api/register', (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin || pin.length !== 4 || isNaN(pin)) {
    return res.status(400).json({ error: 'Dados inválidos. Nome e PIN de 4 dígitos são necessários.' });
  }

  const users = readUsers();
  const lowerName = username.trim().toLowerCase();
  
  // Verificar duplicidade
  for (let key in users) {
    if (key.toLowerCase() === lowerName) {
      return res.status(400).json({ error: 'Este nome já está em uso.' });
    }
  }

  users[username.trim()] = {
    pin: pin,
    predictions: {},
    score: 0,
    exactScores: 0,
    outcomeScores: 0
  };

  writeUsers(users);
  res.json({ success: true, username: username.trim() });
});

// Rota de Login
app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ error: 'Nome e PIN são necessários.' });
  }

  const users = readUsers();
  const user = users[username.trim()];

  if (!user || user.pin !== pin) {
    return res.status(401).json({ error: 'Nome de usuário ou PIN incorreto.' });
  }

  res.json({ success: true, username: username.trim() });
});

// Obter dados do Painel (Jogos e Classificação)
app.get('/api/data', async (req, res) => {
  const { username } = req.query;
  
  // Tentar sincronização em segundo plano (cache 5 min)
  const now = Date.now();
  if (now - lastSyncTime > 5 * 60 * 1000) {
    lastSyncTime = now;
    // Sincroniza sem bloquear a resposta da API
    syncFromWeb();
  }

  const matches = readMatches();
  const users = readUsers();

  // 1. Gerar Classificação (Leaderboard)
  const leaderboard = Object.keys(users).map(name => ({
    username: name,
    score: users[name].score || 0,
    exactScores: users[name].exactScores || 0,
    outcomeScores: users[name].outcomeScores || 0
  })).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.exactScores !== a.exactScores) return b.exactScores - a.exactScores;
    return a.username.localeCompare(b.username);
  });

  // 2. Processar Jogos e Palpites
  const processedMatches = matches.map(match => {
    const isLocked = isMatchLocked(match);
    const predictions = [];

    // Pegar o palpite do usuário logado
    let myPrediction = null;
    if (username && users[username]) {
      myPrediction = users[username].predictions[match.id] || null;
    }

    // Se o jogo já começou (locked), expor os palpites dos demais participantes
    if (isLocked) {
      for (let name in users) {
        const p = users[name].predictions[match.id];
        if (p && p.score1 !== null && p.score2 !== null) {
          predictions.push({
            username: name,
            score1: p.score1,
            score2: p.score2
          });
        }
      }
    }

    return {
      ...match,
      isLocked,
      myPrediction,
      allPredictions: predictions
    };
  });

  res.json({
    leaderboard,
    matches: processedMatches
  });
});

// Enviar / Atualizar Palpites
app.post('/api/predictions', (req, res) => {
  const { username, pin, matchId, score1, score2 } = req.body;
  if (!username || !pin || !matchId) {
    return res.status(400).json({ error: 'Dados insuficientes.' });
  }

  const users = readUsers();
  const user = users[username];

  if (!user || user.pin !== pin) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const matches = readMatches();
  const match = matches.find(m => m.id === parseInt(matchId, 10));

  if (!match) {
    return res.status(404).json({ error: 'Partida não encontrada.' });
  }

  // Validar se o jogo está trancado
  if (isMatchLocked(match)) {
    return res.status(400).json({ error: 'Apostas encerradas para este jogo (limite de 15 minutos antes do início).' });
  }

  // Registrar palpite
  user.predictions[matchId] = {
    score1: score1 === '' || score1 === null ? null : parseInt(score1, 10),
    score2: score2 === '' || score2 === null ? null : parseInt(score2, 10)
  };

  writeUsers(users);
  res.json({ success: true });
});

// ----------------- ROTAS ADMIN -----------------

// Atualizar resultado manualmente
app.post('/api/admin/update-match', (req, res) => {
  const { adminPin, matchId, score1, score2 } = req.body;
  if (adminPin !== '2026') {
    return res.status(401).json({ error: 'Código administrativo incorreto.' });
  }

  const matches = readMatches();
  const match = matches.find(m => m.id === parseInt(matchId, 10));

  if (!match) {
    return res.status(404).json({ error: 'Partida não encontrada.' });
  }

  if (score1 === null || score2 === null || score1 === '' || score2 === '') {
    match.score1 = null;
    match.score2 = null;
    match.status = 'scheduled';
  } else {
    match.score1 = parseInt(score1, 10);
    match.score2 = parseInt(score2, 10);
    match.status = 'completed';
  }

  writeMatches(matches);

  const users = readUsers();
  recalculateScores(matches, users);
  writeUsers(users);

  res.json({ success: true });
});

// Forçar sincronização
app.post('/api/admin/sync', async (req, res) => {
  const { adminPin } = req.body;
  if (adminPin !== '2026') {
    return res.status(401).json({ error: 'Código administrativo incorreto.' });
  }

  await syncFromWeb();
  
  res.json({ success: true, message: 'Sincronização forçada realizada com sucesso.' });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
