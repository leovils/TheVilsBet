const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'cup.txt');
const outputPath = path.join(__dirname, '..', '.data', 'matches.json');

if (!fs.existsSync(inputPath)) {
  console.error('Erro: cup.txt nao encontrado.');
  process.exit(1);
}

const content = fs.readFileSync(inputPath, 'utf8');
const lines = content.split(/\r?\n/);

const matches = [];
let currentGroup = null;
let currentDate = null;
let matchId = 1;

// Regex mais robusto para capturar "Group A-L" ignorando caracteres especiais no comeco
const groupRegex = /^[^a-zA-Z0-9\s]?\s*(Group\s+[A-L])/i;
const dateRegex = /^(Thu|Fri|Sat|Sun|Mon|Tue|Wed)\s+June\s+(\d+)/i;

for (let line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    continue;
  }

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

  if (trimmed.includes(' v ') && trimmed.includes('@')) {
    const atSplit = trimmed.split('@');
    const stadium = atSplit[1].trim();
    const matchPart = atSplit[0].trim();
    
    const vSplit = matchPart.split(/\s+v\s+/);
    if (vSplit.length === 2) {
      const team1Part = vSplit[0].trim();
      const team2 = vSplit[1].trim();
      
      const timeMatch = team1Part.match(/^(\d{2}:\d{2}\s+UTC[+-]\d+)\s+(.+)$/);
      if (timeMatch) {
        const time = timeMatch[1].trim();
        const team1 = timeMatch[2].trim();
        
        matches.push({
          id: matchId++,
          group: currentGroup,
          date: currentDate,
          time: time,
          team1: team1,
          team2: team2,
          stadium: stadium,
          score1: null,
          score2: null,
          status: 'scheduled'
        });
      }
    }
  }
}

// Criar pasta .data se nao existir
const dataDir = path.dirname(outputPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(matches, null, 2), 'utf8');
console.log(`Sucesso: ${matches.length} partidas importadas.`);
