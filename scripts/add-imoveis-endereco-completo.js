// Acrescenta em `imoveis` as partes do endereço que faltavam (21/09/2026).
//
// Por quê: o fechamento preenche o endereço sozinho pela referência, mas saía
// só "Avenida Robson Custódio Machado, Loteamento Floresta" — sem número,
// bloco nem unidade. Não dava pra saber de qual apartamento era o negócio, e
// a adm digitava por cima.
//
// O dump do KSI SEMPRE teve esses campos (numero, complemento, compl_blocos,
// unidade, quadra, lote, cep); o importador é que nunca os trouxe. Depois
// desta migração é preciso reimportar `imoveis` pra preencher o que já existe
// — a coluna nasce vazia nas 34 mil linhas antigas.
//
// Idempotente.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COLUNAS = [
  ["numero", "VARCHAR(60)"],
  ["complemento", "VARCHAR(240)"],
  ["compl_blocos", "VARCHAR(255)"],
  ["unidade_imovel", "VARCHAR(60)"],   // `unidade` já significa outra coisa no BI
  ["quadra", "VARCHAR(40)"],
  ["lote", "VARCHAR(40)"],
  ["cep", "VARCHAR(20)"],
];

(async () => {
  for (const [nome, tipo] of COLUNAS) {
    await pool.query(`ALTER TABLE imoveis ADD COLUMN IF NOT EXISTS ${nome} ${tipo}`);
    console.log(`ok: imoveis.${nome}`);
  }

  const { rows } = await pool.query(`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE NULLIF(TRIM(numero), '') IS NOT NULL) AS com_numero
    FROM imoveis`);
  console.log("imóveis:", rows[0].total, "| com número preenchido:", rows[0].com_numero);
  console.log("\nSe 'com número' estiver em 0, reimporte: node scripts/import-ksi-fast.js <dump.sql.gz>");

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
