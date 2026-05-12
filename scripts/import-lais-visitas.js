require('dotenv').config({path:'.env.local'});
const fs = require('fs');
const {Pool} = require('pg');

const pool = new Pool({connectionString: process.env.DATABASE_URL});

// Read CSV
const dlPath = 'C:\\Users\\Jonatan Honório\\Downloads';
const files = fs.readdirSync(dlPath);
const csvFile = files.find(f => f.includes('Visitas Agendadas'));
if (!csvFile) { console.error('CSV not found!'); process.exit(1); }

console.log(`Reading: ${csvFile}`);
const data = fs.readFileSync(dlPath + '\\' + csvFile, 'utf-8');
const lines = data.split('\n').filter(l => l.trim());

function parseCSV(line) {
  const fields = []; let field = ''; let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { fields.push(field); field = ''; continue; }
    field += ch;
  }
  fields.push(field);
  return fields;
}

const header = parseCSV(lines[0]);
const idx = {};
header.forEach((h, i) => idx[h] = i);

// Parse English date format: "May 12, 2026, 3:00 PM" -> Date
function parseDate(str) {
  if (!str) return null;
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch { return null; }
}

// Extract location from conversation_summary
function extractLocation(summary) {
  if (!summary) return '';
  const match = summary.match(/\*Localização:\*\s*(.+?)(?:\n|$)/);
  return match ? match[1].trim() : '';
}

// Translate tipo_transacao
function translateTipo(tipo) {
  if (!tipo) return '';
  if (tipo === 'rent') return 'Aluguel';
  if (tipo === 'buy') return 'Venda';
  return tipo;
}

(async () => {
  // Extract all visits
  const visitas = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSV(lines[i]);
    if (fields[idx.visita_agendada] !== 'TRUE') continue;

    const nome = (fields[idx.nome] || '').trim();
    const email = (fields[idx.email] || '').trim();
    const tipoTransacao = translateTipo((fields[idx.tipo_transacao] || '').trim());
    const origem = (fields[idx.origem] || '').trim();
    const status = (fields[idx.status] || '').trim();
    const dataCriacao = parseDate(fields[idx.data_criacao]);
    const dataVisita = parseDate(fields[idx.last_visit_request_time]) || dataCriacao;
    const qtdVisitas = parseInt(fields[idx.qtd_visitas]) || 1;
    const summary = (fields[idx.conversation_summary] || '').trim();
    const localizacao = extractLocation(summary);
    const bairro = (fields[idx.bairro_imovel] || '').trim();
    const cidade = (fields[idx.cidade_imovel] || '').trim();
    const idImovel = (fields[idx.id_imovel] || '').trim();

    if (!nome) continue;

    visitas.push({
      nome, email, tipoTransacao, origem, status,
      dataCriacao, dataVisita, qtdVisitas,
      bairro: bairro || '', cidade: cidade || '',
      localizacao, idImovel
    });
  }

  console.log(`\nTotal visitas agendadas: ${visitas.length}`);

  // Cross-reference with Kurole to find corretor
  console.log('Cruzando com Kurole...');
  let matched = 0;

  for (const v of visitas) {
    let corretor = null;
    let corretorId = null;
    let matchMethod = '';
    let leadId = null;

    // 1. Match by email
    if (v.email) {
      const r = await pool.query(
        `SELECT c.id, c.nome, l.id as lead_id, l.corretor_id,
           COALESCE(NULLIF(cor.nome_comercial,''), cor.nome) as cor_nome
         FROM clientes c
         JOIN leads l ON l.cliente_id = c.id
         LEFT JOIN corretores cor ON cor.id = l.corretor_id
         WHERE LOWER(c.email) = LOWER($1)
         ORDER BY l.data_inicio DESC LIMIT 1`,
        [v.email]
      );
      if (r.rows.length > 0) {
        corretor = r.rows[0].cor_nome;
        corretorId = r.rows[0].corretor_id;
        matchMethod = 'email';
        leadId = r.rows[0].lead_id;
      }
    }

    // 2. Match by exact name
    if (!corretor && v.nome) {
      const r = await pool.query(
        `SELECT c.id, c.nome, l.id as lead_id, l.corretor_id,
           COALESCE(NULLIF(cor.nome_comercial,''), cor.nome) as cor_nome
         FROM clientes c
         JOIN leads l ON l.cliente_id = c.id
         LEFT JOIN corretores cor ON cor.id = l.corretor_id
         WHERE LOWER(c.nome) = LOWER($1)
         ORDER BY l.data_inicio DESC LIMIT 1`,
        [v.nome]
      );
      if (r.rows.length > 0) {
        corretor = r.rows[0].cor_nome;
        corretorId = r.rows[0].corretor_id;
        matchMethod = 'nome_exato';
        leadId = r.rows[0].lead_id;
      }
    }

    // 3. Match by LIKE name
    if (!corretor && v.nome && v.nome.includes(' ')) {
      const r = await pool.query(
        `SELECT c.id, c.nome, l.id as lead_id, l.corretor_id,
           COALESCE(NULLIF(cor.nome_comercial,''), cor.nome) as cor_nome
         FROM clientes c
         JOIN leads l ON l.cliente_id = c.id
         LEFT JOIN corretores cor ON cor.id = l.corretor_id
         WHERE LOWER(c.nome) LIKE LOWER($1)
         ORDER BY l.data_inicio DESC LIMIT 1`,
        ['%' + v.nome + '%']
      );
      if (r.rows.length > 0) {
        corretor = r.rows[0].cor_nome;
        corretorId = r.rows[0].corretor_id;
        matchMethod = 'nome_like';
        leadId = r.rows[0].lead_id;
      }
    }

    // 4. Match by first name (recent leads only)
    if (!corretor && v.nome) {
      const firstName = v.nome.split(' ')[0];
      if (firstName.length >= 4) {
        const r = await pool.query(
          `SELECT c.id, c.nome, l.id as lead_id, l.corretor_id,
             COALESCE(NULLIF(cor.nome_comercial,''), cor.nome) as cor_nome
           FROM clientes c
           JOIN leads l ON l.cliente_id = c.id
           LEFT JOIN corretores cor ON cor.id = l.corretor_id
           WHERE LOWER(c.nome) LIKE LOWER($1)
           AND l.data_inicio >= '2025-10-01'
           ORDER BY l.data_inicio DESC LIMIT 1`,
          [firstName + '%']
        );
        if (r.rows.length > 0) {
          corretor = r.rows[0].cor_nome;
          corretorId = r.rows[0].corretor_id;
          matchMethod = 'primeiro_nome';
          leadId = r.rows[0].lead_id;
        }
      }
    }

    v.corretor = corretor || '';
    v.corretorId = corretorId;
    v.matchMethod = matchMethod;
    v.leadId = leadId;
    if (corretor) matched++;

    // If we have a lead, try to get the imovel reference
    if (leadId && !v.referencia) {
      // Check if lead has associated imovel via propostas or other tables
      // For now, leave blank - imovel reference will come from CSV when available
    }
  }

  console.log(`Matched: ${matched}/${visitas.length} (${(matched/visitas.length*100).toFixed(0)}%)`);

  // Insert into database
  console.log('\nInserindo no banco...');

  // Clear existing data first
  await pool.query('DELETE FROM lais_visitas');

  let inserted = 0;
  for (const v of visitas) {
    try {
      await pool.query(
        `INSERT INTO lais_visitas
         (nome, email, tipo_transacao, origem, status, data_criacao, data_visita,
          qtd_visitas, bairro, cidade, localizacao, id_imovel, referencia_imovel,
          corretor_nome, corretor_id, match_method, lead_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (nome, email, data_visita) DO UPDATE SET
           corretor_nome = EXCLUDED.corretor_nome,
           corretor_id = EXCLUDED.corretor_id,
           match_method = EXCLUDED.match_method,
           lead_id = EXCLUDED.lead_id`,
        [
          v.nome, v.email || null, v.tipoTransacao, v.origem, v.status,
          v.dataCriacao, v.dataVisita, v.qtdVisitas,
          v.bairro || null, v.cidade || null, v.localizacao || null,
          v.idImovel || null, null,
          v.corretor || null, v.corretorId, v.matchMethod || null, v.leadId
        ]
      );
      inserted++;
    } catch (e) {
      // Skip duplicate or error
      if (!e.message.includes('duplicate')) {
        console.error(`Error inserting ${v.nome}: ${e.message}`);
      }
    }
  }

  console.log(`Inseridos: ${inserted}`);

  // Stats
  const stats = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(corretor_nome) as com_corretor,
      COUNT(DISTINCT corretor_nome) as corretores_unicos,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Venda') as vendas,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Aluguel') as alugueis,
      MIN(data_visita) as primeira,
      MAX(data_visita) as ultima
    FROM lais_visitas
  `);
  const s = stats.rows[0];
  console.log(`\nResumo no banco:`);
  console.log(`  Total: ${s.total}`);
  console.log(`  Com corretor: ${s.com_corretor}`);
  console.log(`  Corretores unicos: ${s.corretores_unicos}`);
  console.log(`  Vendas: ${s.vendas} | Alugueis: ${s.alugueis}`);
  console.log(`  Periodo: ${new Date(s.primeira).toLocaleDateString('pt-BR')} - ${new Date(s.ultima).toLocaleDateString('pt-BR')}`);

  await pool.end();
})();
