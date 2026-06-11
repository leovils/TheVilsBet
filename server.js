const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const MATCHES_FILE = path.join(__dirname, '.data', 'matches.json');
const USERS_FILE = path.join(__dirname, '.data', 'users.json');

// Inicialização de arquivos locais (fallback)
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

// Configuração do Banco de Dados
let pgClient = null;
const usePostgres = !!process.env.DATABASE_URL;

async function initDb() {
  if (usePostgres) {
    console.log('Usando banco de dados PostgreSQL...');
    try {
      pgClient = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Obrigatório para conexões seguras no Render/Neon
      });
      await pgClient.connect();
      
      // Criar tabelas se não existirem
      await pgClient.query(`
        CREATE TABLE IF NOT EXISTS matches (
          id INT PRIMARY KEY,
          group_name VARCHAR(50),
          match_date VARCHAR(20),
          match_time VARCHAR(20),
          team1 VARCHAR(100),
          team2 VARCHAR(100),
          stadium VARCHAR(200),
          score1 INT,
          score2 INT,
          status VARCHAR(50)
        );
        CREATE TABLE IF NOT EXISTS users (
          username VARCHAR(100) PRIMARY KEY,
          pin VARCHAR(4),
          predictions JSONB,
          score INT DEFAULT 0,
          exact_scores INT DEFAULT 0,
          outcome_scores INT DEFAULT 0
        );
      `);
      
      // Se matches estiver vazio no SQL, popular com dados do matches.json inicial
      const matchesCheck = await pgClient.query('SELECT count(*) FROM matches');
      if (parseInt(matchesCheck.rows[0].count, 10) === 0) {
        console.log('Populando tabela matches do PostgreSQL a partir do matches.json local...');
        const localMatches = JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8'));
        for (let m of localMatches) {
          await pgClient.query(
            `INSERT INTO matches (id, group_name, match_date, match_time, team1, team2, stadium, score1, score2, status) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [m.id, m.group, m.date, m.time, m.team1, m.team2, m.stadium, m.score1, m.score2, m.status]
          );
        }
        console.log('Importação do matches.json para SQL finalizada.');
      }
    } catch (e) {
      console.error('Erro ao conectar ou configurar o PostgreSQL:', e.message);
      console.log('O servidor continuará usando banco de dados em arquivo local como fallback.');
      pgClient = null;
    }
  } else {
    console.log('Usando banco de dados baseado em arquivos JSON locais...');
  }
}

// Inicializar banco no início
initDb();

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

// ----------------- IMPLEMENTAÇÃO DE COMPATIBILIDADE DB -----------------

async function dbGetMatches() {
  if (pgClient) {
    const res = await pgClient.query('SELECT * FROM matches ORDER BY id ASC');
    return res.rows.map(m => ({
      id: m.id,
      group: m.group_name,
      date: m.match_date,
      time: m.match_time,
      team1: m.team1,
      team2: m.team2,
      stadium: m.stadium,
      score1: m.score1,
      score2: m.score2,
      status: m.status
    }));
  } else {
    return readMatches();
  }
}

async function dbUpdateMatch(id, score1, score2, status) {
  if (pgClient) {
    await pgClient.query(
      'UPDATE matches SET score1 = $1, score2 = $2, status = $3 WHERE id = $4',
      [score1, score2, status, id]
    );
  } else {
    const matches = readMatches();
    const match = matches.find(m => m.id === id);
    if (match) {
      match.score1 = score1;
      match.score2 = score2;
      match.status = status;
      writeMatches(matches);
    }
  }
}

async function dbGetUsers() {
  if (pgClient) {
    const res = await pgClient.query('SELECT * FROM users');
    const users = {};
    res.rows.forEach(u => {
      users[u.username] = {
        pin: u.pin,
        predictions: u.predictions || {},
        score: u.score || 0,
        exactScores: u.exact_scores || 0,
        outcomeScores: u.outcome_scores || 0
      };
    });
    return users;
  } else {
    return readUsers();
  }
}

async function dbSaveUser(username, userData) {
  if (pgClient) {
    await pgClient.query(
      `INSERT INTO users (username, pin, predictions, score, exact_scores, outcome_scores)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO UPDATE 
       SET pin = $2, predictions = $3, score = $4, exact_scores = $5, outcome_scores = $6`,
      [username, userData.pin, userData.predictions, userData.score, userData.exactScores, userData.outcomeScores]
    );
  } else {
    const users = readUsers();
    users[username] = userData;
    writeUsers(users);
  }
}

async function dbSaveAllUsers(users) {
  if (pgClient) {
    for (let username in users) {
      await dbSaveUser(username, users[username]);
    }
  } else {
    writeUsers(users);
  }
}

// ----------------- AUXILIARES -----------------

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

function isMatchLocked(match) {
  const kickoff = getMatchKickoffTime(match);
  const now = new Date();
  return now.getTime() >= (kickoff.getTime() - 15 * 60 * 1000);
}

async function recalculateScores(matches, users) {
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

      if (p1 === a1 && p2 === a2) {
        score += 10;
        exactScores += 1;
      }
      else if (
        (a1 > a2 && p1 > p2) ||
        (a1 < a2 && p1 < p2) ||
        (a1 === a2 && p1 === p2)
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

// Sincronizar com web
async function syncFromWeb() {
  try {
    const url = 'https://raw.githubusercontent.com/openfootball/worldcup/master/2026--usa/cup.txt';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Falha ao buscar cup.txt do GitHub');
    
    const content = await response.text();
    const lines = content.split(/\r?\n/);
    const matches = await dbGetMatches();
    let updated = false;

    const normalizeName = name => name.trim().toLowerCase()
      .replace(/korea\s+republic|south\s+korea/g, 'korea republic')
      .replace(/ir\s+iran|iran/g, 'ir iran')
      .replace(/cote\s+d\'ivoire|ivory\s+coast/g, 'ivory coast')
      .replace(/czechia|czech\s+republic/g, 'czechia');

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
        let parts = trimmed.split('@');
        let matchPart = parts[0].trim();
        
        const scoreRegex = /^(.*)\s+(\d+)-(\d+)\s+(.*)$/;
        const scoreMatch = matchPart.match(scoreRegex);

        let team1 = '';
        let team2 = '';
        let s1 = null;
        let s2 = null;

        if (scoreMatch) {
          let t1Part = scoreMatch[1].trim();
          t1Part = t1Part.replace(/^\d{2}:\d{2}\s+UTC[+-]\d+\s+/, '').trim();
          team1 = t1Part;
          s1 = parseInt(scoreMatch[2], 10);
          s2 = parseInt(scoreMatch[3], 10);
          team2 = scoreMatch[4].trim();
        } else {
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
                await dbUpdateMatch(localMatch.id, s1, s2, 'completed');
                updated = true;
              }
            }
          }
        }
      }
    }

    if (updated) {
      const users = await dbGetUsers();
      const freshMatches = await dbGetMatches();
      await recalculateScores(freshMatches, users);
      await dbSaveAllUsers(users);
      console.log('Sincronização concluída: resultados atualizados.');
    } else {
      console.log('Sincronização concluída: nenhum resultado novo.');
    }
  } catch (error) {
    console.error('Erro na sincronização automática:', error.message);
  }
}

// ----------------- ROTAS DA API -----------------

app.post('/api/register', async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin || pin.length !== 4 || isNaN(pin)) {
    return res.status(400).json({ error: 'Dados inválidos. Nome e PIN de 4 dígitos são necessários.' });
  }

  const users = await dbGetUsers();
  const lowerName = username.trim().toLowerCase();
  
  for (let key in users) {
    if (key.toLowerCase() === lowerName) {
      return res.status(400).json({ error: 'Este nome já está em uso.' });
    }
  }

  const newUser = {
    pin: pin,
    predictions: {},
    score: 0,
    exactScores: 0,
    outcomeScores: 0
  };

  await dbSaveUser(username.trim(), newUser);
  res.json({ success: true, username: username.trim() });
});

app.post('/api/login', async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) {
    return res.status(400).json({ error: 'Nome e PIN são necessários.' });
  }

  const users = await dbGetUsers();
  const user = users[username.trim()];

  if (!user || user.pin !== pin) {
    return res.status(401).json({ error: 'Nome de usuário ou PIN incorreto.' });
  }

  res.json({ success: true, username: username.trim() });
});

app.get('/api/data', async (req, res) => {
  const { username } = req.query;
  
  const now = Date.now();
  if (now - lastSyncTime > 5 * 60 * 1000) {
    lastSyncTime = now;
    syncFromWeb();
  }

  const matches = await dbGetMatches();
  const users = await dbGetUsers();

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

  const processedMatches = matches.map(match => {
    const isLocked = isMatchLocked(match);
    const predictions = [];

    let myPrediction = null;
    if (username && users[username]) {
      myPrediction = users[username].predictions[match.id] || null;
    }

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

app.post('/api/predictions', async (req, res) => {
  const { username, pin, matchId, score1, score2 } = req.body;
  if (!username || !pin || !matchId) {
    return res.status(400).json({ error: 'Dados insuficientes.' });
  }

  const users = await dbGetUsers();
  const user = users[username];

  if (!user || user.pin !== pin) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }

  const matches = await dbGetMatches();
  const match = matches.find(m => m.id === parseInt(matchId, 10));

  if (!match) {
    return res.status(404).json({ error: 'Partida não encontrada.' });
  }

  if (isMatchLocked(match)) {
    return res.status(400).json({ error: 'Apostas encerradas para este jogo (limite de 15 minutos antes do início).' });
  }

  user.predictions[matchId] = {
    score1: score1 === '' || score1 === null ? null : parseInt(score1, 10),
    score2: score2 === '' || score2 === null ? null : parseInt(score2, 10)
  };

  await dbSaveUser(username, user);
  res.json({ success: true });
});

// Admin
app.post('/api/admin/update-match', async (req, res) => {
  const { adminPin, matchId, score1, score2 } = req.body;
  if (adminPin !== '2026') {
    return res.status(401).json({ error: 'Código administrativo incorreto.' });
  }

  const matches = await dbGetMatches();
  const match = matches.find(m => m.id === parseInt(matchId, 10));

  if (!match) {
    return res.status(404).json({ error: 'Partida não encontrada.' });
  }

  let s1 = null;
  let s2 = null;
  let status = 'scheduled';

  if (score1 !== null && score2 !== null && score1 !== '' && score2 !== '') {
    s1 = parseInt(score1, 10);
    s2 = parseInt(score2, 10);
    status = 'completed';
  }

  await dbUpdateMatch(match.id, s1, s2, status);

  const freshMatches = await dbGetMatches();
  const users = await dbGetUsers();
  await recalculateScores(freshMatches, users);
  await dbSaveAllUsers(users);

  res.json({ success: true });
});

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
