#!/usr/bin/env node
/**
 * Importador do backup KSI (.sql.gz) para o BI Maciel
 * Uso: node scripts/import-ksi.js caminho/para/backup.sql.gz
 */

const fs = require("fs");
const zlib = require("zlib");
const readline = require("readline");
const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

let client;

const TABLES_TO_IMPORT = [
  "usuarios", "clientes", "imoveis", "ordem_atendimento",
  "ordem_atendimento_releases", "ordem_atendimento_utm",
  "saidadeproposta", "conversao", "conversao_aten",
  "midia", "temperatura", "pre_aten", "edificio",
];
// imoveis_visitas_site removido por ter 22M+ rows - importação separada se necessário

let currentTable = null;
let currentColumns = [];
let tableColumns = {}; // stores columns per table from CREATE TABLE
let stats = {};
let errors = 0;

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
      if (ch === "n") current += "\n";
      else if (ch === "r") current += "\r";
      else if (ch === "t") current += "\t";
      else if (ch === "0") current += "";
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

async function q(text, params) {
  try {
    await client.query(text, params);
    return true;
  } catch (e) {
    errors++;
    return false;
  }
}

async function transformAndInsert(table, columns, rows) {
  for (const v of rows) {
    const c = (name) => col(columns, name);
    let ok = false;

    if (table === "usuarios") {
      ok = await q(
        `INSERT INTO corretores (id,nome,nome_comercial,email,celular,departamento_id,funcao,ativo,empresa,data_admissao,data_demissao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,nome_comercial=EXCLUDED.nome_comercial,ativo=EXCLUDED.ativo`,
        [sn(v,c("id")), sv(v,c("nome"))||"", sv(v,c("nome_comercial")), sv(v,c("email")), sv(v,c("celular")), sn(v,c("id_departamento")), sn(v,c("funcao")), sn(v,c("ativo")), sn(v,c("empresa")), sd(v,c("data_admissao")), sd(v,c("data_demissao"))]
      );
    } else if (table === "clientes") {
      ok = await q(
        `INSERT INTO clientes (id,nome,email,celular,telefone,cidade,estado,bairro,sexo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,email=EXCLUDED.email,celular=EXCLUDED.celular`,
        [sn(v,c("id")), sv(v,c("nome"))||"", sv(v,c("email")), sv(v,c("celular")), sv(v,c("fone")), sv(v,c("cidade")), sv(v,c("estado")), sv(v,c("bairro")), sn(v,c("sexo"))]
      );
    } else if (table === "imoveis") {
      ok = await q(
        `INSERT INTO imoveis (id,codigo,titulo,tipo_mae,tipo_imovel,locacao_venda,endereco,bairro,cidade,estado,dormitorios,suites,banheiros,area_util,area_total,valor,edificio_id,data_cadastro) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (id) DO UPDATE SET valor=EXCLUDED.valor,titulo=EXCLUDED.titulo,locacao_venda=EXCLUDED.locacao_venda`,
        [sn(v,c("id")), sv(v,c("codigo")), sv(v,c("titulo")), sv(v,c("tipo_mae")), sv(v,c("tipo_imovel")), sv(v,c("locacao_venda")), sv(v,c("endereco")), sv(v,c("bairro_nome")), sv(v,c("cidade")), sv(v,c("estado")), sn(v,c("dormitorios")), sn(v,c("suites")), sn(v,c("banheiros")), sn(v,c("a_util")), sn(v,c("a_total")), sn(v,c("valor")), sn(v,c("id_edi_cond")), sd(v,c("data"))]
      );
    } else if (table === "ordem_atendimento") {
      const status = sv(v,c("pq_fechou")) ? "fechado" : "aberto";
      const corrId = sn(v,c("id_usuario_resp")) || sn(v,c("id_usuario"));
      ok = await q(
        `INSERT INTO leads (id,corretor_id,cliente_id,empresa_id,locacao_venda,origem,origem_fonte,temperatura_id,tipo_imovel,bairros,cidades,dormitorios,valor_aluguel,valor_venda,data_inicio,data_fim,status,observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT (id) DO UPDATE SET temperatura_id=EXCLUDED.temperatura_id,status=EXCLUDED.status`,
        [sn(v,c("id")), corrId, sn(v,c("id_cliente")), sn(v,c("id_empresa")), sv(v,c("locacao_venda")), sv(v,c("origem")), sv(v,c("origem_fonte")), sn(v,c("id_temperatura")), sv(v,c("tipo_imovel")), sv(v,c("bairros")), sv(v,c("cidades")), sn(v,c("dormitorios")), sn(v,c("valor_aluguel")), sn(v,c("valor_venda")), sd(v,c("data_inicio")), sd(v,c("data_fim")), status, sv(v,c("observacoes"))]
      );
    } else if (table === "ordem_atendimento_releases") {
      ok = await q(
        `INSERT INTO lead_atividades (id,lead_id,corretor_id,descricao,temperatura_id,data,tempo_retorno) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [sn(v,c("id")), sn(v,c("id_ordem_atendimento")), sn(v,c("id_usuario")), (sv(v,c("descricao"))||"").substring(0,5000), sn(v,c("id_temperatura")), sd(v,c("data")), sn(v,c("tempo_retorno"))]
      );
    } else if (table === "ordem_atendimento_utm") {
      ok = await q(
        `INSERT INTO lead_utms (id,lead_id,utm_source,utm_medium,utm_campaign,utm_term,utm_content,data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [sn(v,c("id")), sn(v,c("id_ordem_atendimento")), sv(v,c("utm_source")), sv(v,c("utm_medium")), sv(v,c("utm_campaign")), sv(v,c("utm_term")), sv(v,c("utm_content")), sd(v,c("data_now"))]
      );
    } else if (table === "saidadeproposta") {
      ok = await q(
        `INSERT INTO propostas (id,imovel_id,cliente_id,corretor_id,lead_id,locacao_venda,valor_pedido,valor_proposto,data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [sn(v,c("id")), sn(v,c("id_imovel")), sn(v,c("id_cliente")), sn(v,c("id_usuario")), sn(v,c("id_ordem_atendimento")), sv(v,c("locacao_venda")), sn(v,c("valor")), sn(v,c("valor_proposto")), sd(v,c("data"))]
      );
    } else if (table === "conversao") {
      ok = await q(
        `INSERT INTO conversoes (id,imovel_id,midia_id,locacao_venda,valor,taxa,data_inicio,data_assinatura,data_efetivacao,finalidade) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [sn(v,c("id")), sn(v,c("id_imovel")), sn(v,c("id_midia")), sv(v,c("locacao_venda")), sn(v,c("valor")), sn(v,c("taxa")), sd(v,c("data_inicio")), sd(v,c("data_assinatura")), sd(v,c("data_efetivacao")), sv(v,c("finalidade"))]
      );
    } else if (table === "conversao_aten") {
      ok = await q(
        `INSERT INTO conversao_corretores (id,conversao_id,corretor_id,percentual) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [sn(v,c("id")), sn(v,c("id_conversao")), sn(v,c("id_usuario")), sn(v,c("percentual"))]
      );
    } else if (table === "midia") {
      ok = await q(
        `INSERT INTO midias (id,nome,ativo) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome`,
        [sn(v,c("id")), sv(v,c("nome"))||"", !sn(v,c("flag_inativo"))]
      );
    } else if (table === "temperatura") {
      ok = await q(
        `INSERT INTO temperaturas (id,nome,cor,ordem) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome,cor=EXCLUDED.cor`,
        [sn(v,c("id")), sv(v,c("nome")), sv(v,c("cor")), sn(v,c("ordem"))]
      );
    } else if (table === "pre_aten") {
      ok = await q(
        `INSERT INTO pre_atendimentos (id,origem_id,finalidade_id,corretor_destino_id,cliente_id,lead_id,descricao,data,pendente) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [sn(v,c("id")), sn(v,c("id_origem")), sn(v,c("id_finalidade")), sn(v,c("id_usuario_para")), sn(v,c("id_cliente")), sn(v,c("id_ordem_atendimento")), (sv(v,c("descricao"))||"").substring(0,5000), sd(v,c("data_now")), !!sn(v,c("flag_pendente"))]
      );
    } else if (table === "edificio") {
      ok = await q(
        `INSERT INTO empreendimentos (id,nome,endereco,bairro,cidade,estado,tipo,lancamento,status_id,valor_condominio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome`,
        [sn(v,c("id")), sv(v,c("nome_edificio"))||"", sv(v,c("endereco")), sv(v,c("bairro")), sv(v,c("cidade")), sv(v,c("estado")), sn(v,c("edi_tipo")), !!sn(v,c("lancamento_flag")), sn(v,c("id_edificio_status")), sn(v,c("valor_condominio"))]
      );
    }

    if (ok) stats[table] = (stats[table] || 0) + 1;
  }
}

async function processFile(filePath) {
  console.log(`\n📦 Importando: ${filePath}`);
  console.log("⏳ Isso pode levar alguns minutos...\n");

  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const rl = readline.createInterface({ input: fileStream.pipe(gunzip), crlfDelay: Infinity });

  let insertBuffer = "";
  let lineCount = 0;

  for await (const line of rl) {
    lineCount++;
    if (lineCount % 100000 === 0) {
      process.stdout.write(`\r📄 ${(lineCount / 1000).toFixed(0)}k linhas... | Importados: ${Object.values(stats).reduce((a,b)=>a+b,0).toLocaleString()} | Erros: ${errors}`);
    }

    // Track CREATE TABLE to capture column order
    const createMatch = line.match(/^CREATE TABLE `(\w+)`/);
    if (createMatch) {
      // Save columns of previous table
      if (currentTable && currentColumns.length > 0) {
        tableColumns[currentTable] = [...currentColumns];
      }
      currentTable = createMatch[1];
      currentColumns = [];
      continue;
    }

    // Capture column names from CREATE TABLE body
    if (currentTable && line.match(/^\s+`(\w+)`/)) {
      const m = line.match(/^\s+`(\w+)`/);
      if (m && !line.includes("PRIMARY KEY") && !line.includes("KEY `") && !line.includes("UNIQUE KEY")) {
        currentColumns.push(m[1]);
      }
    }

    // Save columns when table definition ends
    if (currentTable && (line.includes("ENGINE=") || line.startsWith(") "))) {
      if (currentColumns.length > 0) {
        tableColumns[currentTable] = [...currentColumns];
      }
    }

    if (line.startsWith("INSERT INTO")) {
      const tableMatch = line.match(/INSERT INTO `(\w+)`/);
      if (tableMatch && TABLES_TO_IMPORT.includes(tableMatch[1])) {
        insertBuffer = line;
        if (!line.endsWith(";")) continue;

        // Try explicit columns first, fallback to CREATE TABLE columns
        let colsForTable = [];
        const colsMatch = insertBuffer.match(/INSERT INTO `\w+` \(([^)]+)\)/);
        if (colsMatch) {
          colsMatch[1].split(",").forEach(c => colsForTable.push(c.trim().replace(/`/g, "")));
        } else {
          colsForTable = tableColumns[tableMatch[1]] || [];
        }

        const rows = parseInsertLine(insertBuffer);
        if (rows.length > 0 && colsForTable.length > 0) await transformAndInsert(tableMatch[1], colsForTable, rows);
        insertBuffer = "";
      }
      continue;
    }

    if (insertBuffer) {
      insertBuffer += line;
      if (line.endsWith(";")) {
        const tableMatch = insertBuffer.match(/INSERT INTO `(\w+)`/);
        if (tableMatch) {
          let colsForTable = [];
          const colsMatch = insertBuffer.match(/INSERT INTO `\w+` \(([^)]+)\)/);
          if (colsMatch) {
            colsMatch[1].split(",").forEach(c => colsForTable.push(c.trim().replace(/`/g, "")));
          } else {
            colsForTable = tableColumns[tableMatch[1]] || [];
          }
          const rows = parseInsertLine(insertBuffer);
          if (rows.length > 0 && colsForTable.length > 0) await transformAndInsert(tableMatch[1], colsForTable, rows);
        }
        insertBuffer = "";
      }
    }
  }

  console.log("\n\n✅ Importação concluída!\n");
  console.log("📊 Registros importados:");
  for (const [table, count] of Object.entries(stats)) {
    console.log(`   ${table}: ${count.toLocaleString()}`);
  }
  console.log(`   ⚠️ Erros ignorados: ${errors}`);

  await q(`INSERT INTO importacoes (tipo,arquivo,registros,status) VALUES ($1,$2,$3,$4)`,
    ['ksi', filePath, Object.values(stats).reduce((a,b)=>a+b,0), 'ok']);
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) { console.error("❌ Uso: node scripts/import-ksi.js caminho/para/backup.sql.gz"); process.exit(1); }
  if (!fs.existsSync(filePath)) { console.error(`❌ Arquivo não encontrado: ${filePath}`); process.exit(1); }

  client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("✅ Conectado ao banco!");

  await processFile(filePath);
  await client.end();
}

main().catch(err => { console.error("❌ Erro:", err.message); process.exit(1); });
