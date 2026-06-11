const http = require('http');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: JSON.parse(data)
        });
      });
    });
    
    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- INICIANDO TESTES DA API ---');

  // Limpar banco de dados de usuários escrevendo um JSON vazio no users.json
  const fs = require('fs');
  const path = require('path');
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'users.json'), '{}', 'utf8');

  // Teste 1: Cadastro de Usuário Novo
  console.log('Teste 1: Cadastro de "Andre"');
  const reg1 = await request('POST', '/api/register', { username: 'Andre', pin: '1234' });
  console.log('Status:', reg1.statusCode, reg1.body);
  if (reg1.statusCode !== 200 || !reg1.body.success) throw new Error('Falha no cadastro 1');

  // Teste 2: Cadastro duplicado (deve falhar)
  console.log('Teste 2: Cadastro duplicado de "andre"');
  const reg2 = await request('POST', '/api/register', { username: 'andre', pin: '5555' });
  console.log('Status (Esperado erro):', reg2.statusCode, reg2.body);
  if (reg2.statusCode === 200) throw new Error('Permitiu cadastro duplicado');

  // Teste 3: Login correto
  console.log('Teste 3: Login de "Andre" com PIN correto');
  const log1 = await request('POST', '/api/login', { username: 'Andre', pin: '1234' });
  console.log('Status:', log1.statusCode, log1.body);
  if (log1.statusCode !== 200 || !log1.body.success) throw new Error('Falha no login correto');

  // Teste 4: Login incorreto
  console.log('Teste 4: Login de "Andre" com PIN incorreto');
  const log2 = await request('POST', '/api/login', { username: 'Andre', pin: '9999' });
  console.log('Status (Esperado erro):', log2.statusCode, log2.body);
  if (log2.statusCode === 200) throw new Error('Permitiu login com PIN errado');

  // Teste 5: Obter dados gerais e checar se Jogo 1 está locked e Jogo 2 está open
  console.log('Teste 5: Obter dados do painel');
  const data1 = await request('GET', '/api/data?username=Andre');
  const match1 = data1.body.matches.find(m => m.id === 1);
  const match2 = data1.body.matches.find(m => m.id === 2);
  console.log(`Jogo 1 (Mexico v South Africa): status=${match1.status}, isLocked=${match1.isLocked}`);
  console.log(`Jogo 2 (South Korea v Czech Republic): status=${match2.status}, isLocked=${match2.isLocked}`);
  
  if (!match1.isLocked) throw new Error('Jogo 1 deveria estar bloqueado!');
  if (match2.isLocked) throw new Error('Jogo 2 deveria estar aberto para apostas!');

  // Teste 6: Palpitar no Jogo 1 (deve falhar porque está locked)
  console.log('Teste 6: Tentar palpitar no Jogo 1 (bloqueado)');
  const pred1 = await request('POST', '/api/predictions', {
    username: 'Andre',
    pin: '1234',
    matchId: 1,
    score1: 2,
    score2: 1
  });
  console.log('Status (Esperado erro):', pred1.statusCode, pred1.body);
  if (pred1.statusCode === 200) throw new Error('Permitiu aposta em jogo encerrado/bloqueado!');

  // Teste 7: Palpitar no Jogo 2 (deve funcionar)
  console.log('Teste 7: Palpitar no Jogo 2 (aberto) - Placar 2x0');
  const pred2 = await request('POST', '/api/predictions', {
    username: 'Andre',
    pin: '1234',
    matchId: 2,
    score1: 2,
    score2: 0
  });
  console.log('Status:', pred2.statusCode, pred2.body);
  if (pred2.statusCode !== 200) throw new Error('Erro ao salvar palpite no jogo 2');

  // Cadastrar segundo usuário para verificar classificação
  console.log('Cadastrar "Vils"');
  await request('POST', '/api/register', { username: 'Vils', pin: '4321' });
  console.log('Palpitar no Jogo 2 para Vils - Placar 1x1');
  await request('POST', '/api/predictions', {
    username: 'Vils',
    pin: '4321',
    matchId: 2,
    score1: 1,
    score2: 1
  });

  // Teste 8: Atualização de Resultado via Admin
  console.log('Teste 8: Gravar resultado oficial do Jogo 2 (2x0) como Admin');
  const adminUpdate = await request('POST', '/api/admin/update-match', {
    adminPin: '2026',
    matchId: 2,
    score1: 2,
    score2: 0
  });
  console.log('Status:', adminUpdate.statusCode, adminUpdate.body);
  if (adminUpdate.statusCode !== 200) throw new Error('Falha na gravacao do placar pelo admin');

  // Teste 9: Verificar ranking de Andre (deve ter 10 pontos - placar exato) e Vils (0 pontos)
  console.log('Teste 9: Verificar ranking final');
  const data2 = await request('GET', '/api/data');
  console.log('Ranking:', data2.body.leaderboard);
  
  const rankAndre = data2.body.leaderboard.find(u => u.username === 'Andre');
  const rankVils = data2.body.leaderboard.find(u => u.username === 'Vils');

  if (rankAndre.score !== 10) throw new Error(`Andre deveria ter 10 moedas, tem ${rankAndre.score}`);
  if (rankVils.score !== 0) throw new Error(`Vils deveria ter 0 moedas, tem ${rankVils.score}`);

  console.log('--- TODOS OS TESTES PASSARAM COM SUCESSO! ✅ ---');
  process.exit(0);
}

runTests().catch(e => {
  console.error('Falha nos testes de API ❌:', e);
  process.exit(1);
});
