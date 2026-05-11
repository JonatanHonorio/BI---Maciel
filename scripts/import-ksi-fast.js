#!/usr/bin/env node
/**
 * Importador RÁPIDO do backup KSI (.sql.gz) para o BI Maciel
 * Usa batch inserts para velocidade 50-100x maior
 * Uso: node scripts/import-ksi-fast.js caminho/para/backup.sql.gz
 */

const fs = require("fs");
const zlib = require("zlib");
const readline = require("readline");
const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

let client;
const BATCH_SIZE = 100;

const TABLES_TO_IMPORT = [
  "usuarios", "clientes", "imoveis", "ordem_atendimento",
  "ordem_atendimento_releases", "ordem_atendimento_utm",
  "saidadeproposta", "conversao", "conversao_aten",
  "midia", "temperatura", "pre_aten", "edificio",
];

let tableColumns = {};
let currentTable = null;
let currentColumns = [];
let stats = {};
let errors = 0;
let batches = {};
let loggedErrors = {};

function parseInsertLine(line) {
  const valuesMatch = line.match(/VALUES\s*(.+)/i);
  if (!valuesMatch) return [];
  const rows = [];
  let current = "";
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < valuesMatch[1].length; i++) {
    const ch = valuesMatch[1][i];
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === "\\") { current += ch; escaped = true; continue; }
    if (ch === "'" && !escaped) { inString = !inString; current += ch; continue; }
    if (!inString) {
      if (ch === "(") { depth++; if (depth === 1) { current = ""; continue; } }
      else if (ch === ")") { depth--; if (depth === 0) { rows.push(parseRow(current)); current = ""; continue; } }
    }
    current += ch;
  }
  return rows;
}

function parseRow(rowStr) {
  const values = [];
  let current = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < rowStr.length; i++) {
    const ch = rowStr[i];
    if (escaped) {
      if (ch === "n") current += "\n"; else if (ch === "r") current += "\r";
      else if (ch === "t") current += "\t"; else if (ch === "0") current += "";
      else current += ch;
      escaped = false; continue;
    }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === "'") {
      if (inString && rowStr[i + 1] === "'") { current += "'"; i++; continue; }
      inString = !inString; continue;
    }
    if (ch === "," && !inString) { values.push(current.trim() === "NULL" ? null : current.trim()); current = ""; continue; }
    current += ch;
  }
  values.push(current.trim() === "NULL" ? null : current.trim());
  return values;
}

function col(columns, name) { return columns.indexOf(name); }
function sv(values, idx) { if (idx === -1 || idx >= values.length) return null; return values[idx]; }
function sn(values, idx) { const v = sv(values, idx); if (v === null || v === "") return 0; const n = Number(v); return isNaN(n) ? 0 : n; }
function sd(values, idx) { const v = sv(values, idx); if (!v || v === "0000-00-00" || v === "0000-00-00 00:00:00") return null; return v; }

function mapRow(table, columns, v) {
  const c = (name) => col(columns, name);

  if (table === "usuarios") {
    return [sn(v,c("id")), sv(v,c("nome"))||"", sv(v,c("nome_comercial")), sv(v,c("email")), sv(v,c("celular")), sn(v,c("id_departamento")), sn(v,c("funcao")), sn(v,c("ativo")), sn(v,c("empresa")), sd(v,c("data_admissao")), sd(v,c("data_demissao"))];
  } else if (table === "clientes") {
    return [sn(v,c("id")), sv(v,c("nome"))||"", sv(v,c("email")), sv(v,c("celular")), sv(v,c("fone")), sv(v,c("cidade")), sv(v,c("estado")), sv(v,c("bairro")), sn(v,c("sexo"))];
  } else if (table === "imoveis") {
    return [sn(v,c("id")), sv(v,c("codigo")), sv(v,c("titulo")), sv(v,c("tipo_mae")), sv(v,c("tipo_imovel")), sv(v,c("locacao_venda")), sv(v,c("endereco")), sv(v,c("bairro_nome")), sv(v,c("cidade")), sv(v,c("estado")), sn(v,c("dormitorios")), sn(v,c("suites")), sn(v,c("banheiros")), sn(v,c("a_util")), sn(v,c("a_total")), sn(v,c("valor")), sn(v,c("id_edi_cond")), sd(v,c("data"))];
  } else if (table === "ordem_atendimento") {
    const status = sv(v,c("pq_fechou")) ? "fechado" : "aberto";
    const corrId = sn(v,c("id_usuario_resp")) || sn(v,c("id_usuario"));
    return [sn(v,c("id")), corrId, sn(v,c("id_cliente")), sn(v,c("id_empresa")), sv(v,c("locacao_venda")), sv(v,c("origem")), sv(v,c("origem_fonte")), sn(v,c("id_temperatura")), sv(v,c("tipo_imovel")), sv(v,c("bairros")), sv(v,c("cidades")), sn(v,c("dormitorios")), sn(v,c("valor_aluguel")), sn(v,c("valor_venda")), sd(v,c("data_inicio")), sd(v,c("data_fim")), status, sv(v,c("observacoes"))];
  } else if (table === "ordem_atendimento_releases") {
    return [sn(v,c("id")), sn(v,c("id_ordem_atendimento")), sn(v,c("id_usuario")), (sv(v,c("descricao"))||"").substring(0,5000), sn(v,c("id_temperatura")), sd(v,c("data")), sn(v,c("tempo_retorno"))];
  } else if (table === "ordem_atendimento_utm") {
    return [sn(v,c("id")), sn(v,c("id_ordem_atendimento")), sv(v,c("utm_source")), sv(v,c("utm_medium")), sv(v,c("utm_campaign")), sv(v,c("utm_term")), sv(v,c("utm_content")), sd(v,c("data_now"))];
  } else if (table === "saidadeproposta") {
    return [sn(v,c("id")), sn(v,c("id_imovel")), sn(v,c("id_cliente")), sn(v,c("id_usuario")), sn(v,c("id_ordem_atendimento")), sv(v,c("locacao_venda")), sn(v,c("valor")), sn(v,c("valor_proposto")), sd(v,c("data"))];
  } else if (table === "conversao") {
    return [sn(v,c("id")), sn(v,c("id_imovel")), sn(v,c("id_midia")), sv(v,c("locacao_venda")), sn(v,c("valor")), sn(v,c("taxa")), sd(v,c("data_inicio")), sd(v,c("data_assinatura")), sd(v,c("data_efetivacao")), sv(v,c("finalidade"))];
  } else if (table === "conversao_aten") {
    return [sn(v,c("id")), sn(v,c("id_conversao")), sn(v,c("id_usuario")), sn(v,c("percentual"))];
  } else if (table === "midia") {
    return [sn(v,c("id")), sv(v,c("nome"))||"", !sn(v,c("flag_inativo"))];
  } else if (table === "temperatura") {
    return [sn(v,c("id")), sv(v,c("nome")), sv(v,c("cor")), sn(v,c("ordem"))];
  } else if (table === "pre_aten") {
    return [sn(v,c("id")), sn(v,c("id_origem")), sn(v,c("id_finalidade")), sn(v,c("id_usuario_para")), sn(v,c("id_cliente")), sn(v,c("id_ordem_atendimento")), (sv(v,c("descricao"))||"").substring(0,5000), sd(v,c("data_now")), !!sn(v,c("flag_pendente"))];
  } else if (table === "edificio") {
    return [sn(v,c("id")), sv(v,c("nome_edificio"))||"", sv(v,c("endereco")), sv(v,c("bairro")), sv(v,c("cidade")), sv(v,c("estado")), sn(v,c("edi_tipo")), !!sn(v,c("lancamento_flag")), sn(v,c("id_edificio_status")), sn(v,c("valor_condominio"))];
  }
  return null;
}

const QUERIES = {
  usuarios: { cols: 11, sql: (n) => `INSERT INTO corretores (id,nome,nome_comercial,email,celular,departamento_id,funcao,ativo,empresa,data_admissao,data_demissao) VALUES ${n} ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,nome_comercial=EXCLUDED.nome_comercial,ativo=EXCLUDED.ativo` },
  clientes: { cols: 9, sql: (n) => `INSERT INTO clientes (id,nome,email,celular,telefone,cidade,estado,bairro,sexo) VALUES ${n} ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,email=EXCLUDED.email,celular=EXCLUDED.celular` },
  imoveis: { cols: 18, sql: (n) => `INSERT INTO imoveis (id,codigo,titulo,tipo_mae,tipo_imovel,locacao_venda,endereco,bairro,cidade,estado,dormitorios,suites,banheiros,area_util,area_total,valor,edificio_id,data_cadastro) VALUES ${n} ON CONFLICT (id) DO UPDATE SET valor=EXCLUDED.valor,titulo=EXCLUDED.titulo,locacao_venda=EXCLUDED.locacao_venda` },
  ordem_atendimento: { cols: 18, sql: (n) => `INSERT INTO leads (id,corretor_id,cliente_id,empresa_id,locacao_venda,origem,origem_fonte,temperatura_id,tipo_imovel,bairros,cidades,dormitorios,valor_aluguel,valor_venda,data_inicio,data_fim,status,observacoes) VALUES ${n} ON CONFLICT (id) DO UPDATE SET temperatura_id=EXCLUDED.temperatura_id,status=EXCLUDED.status` },
  ordem_atendimento_releases: { cols: 7, sql: (n) => `INSERT INTO lead_atividades (id,lead_id,corretor_id,descricao,temperatura_id,data,tempo_retorno) VALUES ${n} ON CONFLICT (id) DO NOTHING` },
  ordem_atendimento_utm: { cols: 8, sql: (n) => `INSERT INTO lead_utms (id,lead_id,utm_source,utm_medium,utm_campaign,utm_term,utm_content,data) VALUES ${n} ON CONFLICT (id) DO NOTHING` },
  saidadeproposta: { cols: 9, sql: (n) => `INSERT INTO propostas (id,imovel_id,cliente_id,corretor_id,lead_id,locacao_venda,valor_pedido,valor_proposto,data) VALUES ${n} ON CONFLICT (id) DO NOTHING` },
  conversao: { cols: 10, sql: (n) => `INSERT INTO conversoes (id,imovel_id,midia_id,locacao_venda,valor,taxa,data_inicio,data_assinatura,data_efetivacao,finalidade) VALUES ${n} ON CONFLICT (id) DO NOTHING` },
  conversao_aten: { cols: 4, sql: (n) => `INSERT INTO conversao_corretores (id,conversao_id,corretor_id,percentual) VALUES ${n} ON CONFLICT (id) DO NOTHING` },
  midia: { cols: 3, sql: (n) => `INSERT INTO midias (id,nome,ativo) VALUES ${n} ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome` },
  temperatura: { cols: 4, sql: (n) => `INSERT INTO temperaturas (id,nome,cor,ordem) VALUES ${n} ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,cor=EXCLUDED.cor` },
  pre_aten: { cols: 9, sql: (n) => `INSERT INTO pre_atendimentos (id,origem_id,finalidade_id,corretor_destino_id,cliente_id,lead_id,descricao,data,pendente) VALUES ${n} ON CONFLICT (id) DO NOTHING` },
  edificio: { cols: 10, sql: (n) => `INSERT INTO empreendimentos (id,nome,endereco,bairro,cidade,estado,tipo,lancamento,status_id,valor_condominio) VALUES ${n} ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome` },
};

async function flushBatch(table) {
  const rows = batches[table];
  if (!rows || rows.length === 0) return;

  const q = QUERIES[table];
  const params = [];
  const placeholders = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const offset = i * q.cols;
    const ph = [];
    for (let j = 0; j < q.cols; j++) {
      params.push(row[j]);
      ph.push(`$${offset + j + 1}`);
    }
    placeholders.push(`(${ph.join(",")})`);
  }

  try {
    await client.query(q.sql(placeholders.join(",")), params);
    stats[table] = (stats[table] || 0) + rows.length;
  } catch (e) {
    if (!loggedErrors[table + '_batch']) {
      loggedErrors[table + '_batch'] = true;
      console.error(`\n⚠️ Batch falhou para ${table}: ${e.message.substring(0,200)}`);
    }
    // Fallback: try one by one
    if (!loggedErrors) loggedErrors = {};
    for (const row of rows) {
      try {
        const ph = row.map((_, j) => `$${j + 1}`).join(",");
        await client.query(q.sql(`(${ph})`), row);
        stats[table] = (stats[table] || 0) + 1;
      } catch (e2) {
        errors++;
        if (!loggedErrors[table]) {
          loggedErrors[table] = true;
          console.error(`\n❌ Erro em ${table}: ${e2.message}`);
          console.error(`   Row sample: [${row.slice(0,5).join(', ')}...]`);
          console.error(`   Expected cols: ${q.cols}`);
          console.error(`   Got cols: ${row.length}`);
        }
      }
    }
  }

  batches[table] = [];
}

async function addToBatch(table, columns, rows) {
  if (!batches[table]) batches[table] = [];

  for (const v of rows) {
    const mapped = mapRow(table, columns, v);
    if (mapped) {
      batches[table].push(mapped);
      if (batches[table].length >= BATCH_SIZE) {
        await flushBatch(table);
      }
    }
  }
}

async function processFile(filePath) {
  console.log(`\n📦 Importando (modo rápido): ${filePath}`);
  console.log("⏳ Processando...\n");

  const { Transform } = require("stream");
  const startTime = Date.now();

  // Custom line-skipping transform: detects INSERT INTO non-target tables
  // and replaces their data with a short skip marker, preventing huge lines from entering memory
  let skipMode = false;
  let headerBuf = "";
  let headerChecked = false;

  const lineSkipper = new Transform({
    transform(chunk, encoding, callback) {
      if (skipMode) {
        // Scan chunk for newline to end skip
        const nl = chunk.indexOf(10); // \n
        if (nl !== -1) {
          skipMode = false;
          headerBuf = "";
          headerChecked = false;
          // Pass the rest after newline
          callback(null, chunk.slice(nl + 1));
        } else {
          callback(); // skip entire chunk
        }
        return;
      }

      // Check if chunk starts a new INSERT INTO non-target table
      // We need to detect this at chunk boundaries
      let start = 0;
      let result = [];

      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 10) { // newline
          headerBuf = "";
          headerChecked = false;
          continue;
        }

        if (!headerChecked && headerBuf.length < 60) {
          headerBuf += String.fromCharCode(chunk[i]);

          // Check once we have enough of the header
          const insertMatch = headerBuf.match(/^INSERT INTO `(\w+)`/);
          if (insertMatch) {
            headerChecked = true;
            if (!TABLES_TO_IMPORT.includes(insertMatch[1])) {
              // Skip this entire line - find next newline
              const nl = chunk.indexOf(10, i);
              if (nl !== -1) {
                // Replace skipped content with empty, continue after newline
                result.push(chunk.slice(start, i - headerBuf.length + 1));
                result.push(Buffer.from("-- SKIPPED\n"));
                start = nl + 1;
                i = nl;
                headerBuf = "";
                headerChecked = false;
              } else {
                // No newline in this chunk, enter skip mode
                result.push(chunk.slice(start, i - headerBuf.length + 1));
                result.push(Buffer.from("-- SKIPPED\n"));
                skipMode = true;
                callback(null, Buffer.concat(result));
                return;
              }
            }
          }
        }
      }

      result.push(chunk.slice(start));
      callback(null, Buffer.concat(result));
    }
  });

  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip).pipe(lineSkipper), crlfDelay: Infinity });

  let insertBuffer = "";
  let insertBufferTable = "";
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount % 5000 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const total = Object.values(stats).reduce((a, b) => a + b, 0);
      process.stdout.write(`\r📄 ${(lineCount / 1000).toFixed(0)}k linhas | ${total.toLocaleString()} importados | ${errors} erros | ${elapsed}s`);
    }

    if (line.startsWith("-- SKIPPED")) continue;

    const createMatch = line.match(/^CREATE TABLE `(\w+)`/);
    if (createMatch) {
      if (currentTable && currentColumns.length > 0) tableColumns[currentTable] = [...currentColumns];
      currentTable = createMatch[1]; currentColumns = []; continue;
    }
    if (currentTable && line.match(/^\s+`(\w+)`/) && !line.includes("PRIMARY KEY") && !line.includes("KEY `") && !line.includes("UNIQUE KEY")) {
      const m = line.match(/^\s+`(\w+)`/); if (m) currentColumns.push(m[1]);
    }
    if (currentTable && (line.includes("ENGINE=") || line.startsWith(") "))) {
      if (currentColumns.length > 0) tableColumns[currentTable] = [...currentColumns];
    }

    if (line.startsWith("INSERT INTO")) {
      const tableMatch = line.match(/INSERT INTO `(\w+)`/);
      if (!tableMatch) continue;

      if (!TABLES_TO_IMPORT.includes(tableMatch[1])) continue;

      insertBuffer = line;
      insertBufferTable = tableMatch[1];
      if (!line.endsWith(";")) continue;

      let colsForTable = [];
      const colsMatch = insertBuffer.match(/INSERT INTO `\w+` \(([^)]+)\)/);
      if (colsMatch) colsMatch[1].split(",").forEach(c => colsForTable.push(c.trim().replace(/`/g, "")));
      else colsForTable = tableColumns[insertBufferTable] || [];
      const rows = parseInsertLine(insertBuffer);
      if (rows.length > 0 && colsForTable.length > 0) await addToBatch(insertBufferTable, colsForTable, rows);
      insertBuffer = "";
      insertBufferTable = "";
      continue;
    }

    if (insertBuffer) {
      insertBuffer += line;
      if (line.endsWith(";")) {
        let colsForTable = [];
        const colsMatch = insertBuffer.match(/INSERT INTO `\w+` \(([^)]+)\)/);
        if (colsMatch) colsMatch[1].split(",").forEach(c => colsForTable.push(c.trim().replace(/`/g, "")));
        else colsForTable = tableColumns[insertBufferTable] || [];
        const rows = parseInsertLine(insertBuffer);
        if (rows.length > 0 && colsForTable.length > 0) await addToBatch(insertBufferTable, colsForTable, rows);
        insertBuffer = "";
        insertBufferTable = "";
      }
    }
  }

  // Flush remaining batches
  for (const table of TABLES_TO_IMPORT) {
    await flushBatch(table);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n\n✅ Importação concluída em ${elapsed}s!\n`);
  console.log("📊 Registros importados:");
  for (const [table, count] of Object.entries(stats)) {
    console.log(`   ${table}: ${count.toLocaleString()}`);
  }
  console.log(`   ⚠️ Erros ignorados: ${errors}`);

  try {
    await client.query(`INSERT INTO importacoes (tipo,arquivo,registros,status) VALUES ($1,$2,$3,$4)`,
      ['ksi', filePath, Object.values(stats).reduce((a, b) => a + b, 0), 'ok']);
  } catch (e) {}
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) { console.error("❌ Uso: node scripts/import-ksi-fast.js caminho/para/backup.sql.gz"); process.exit(1); }
  if (!fs.existsSync(filePath)) { console.error(`❌ Arquivo não encontrado: ${filePath}`); process.exit(1); }

  client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("✅ Conectado ao banco!");

  await processFile(filePath);

  await client.end();
}

main().catch(err => { console.error("❌ Erro:", err.message); process.exit(1); });
