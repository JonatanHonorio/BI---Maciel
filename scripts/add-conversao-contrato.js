// Número do contrato (CtrCod) e unidade nas conversões (28/09/2026). Idempotente.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  /*
   * `CtrCod` é o NÚMERO DO CONTRATO do Kurole — o mesmo que aparece na
   * primeira coluna do funil de conversão e que a Suzana digita no fechamento.
   * Não é o `id` da conversão: a conversão 10703 é o contrato 4415.
   *
   * Venda e locação têm sequências separadas, então o número sozinho repete
   * (435 casos). A chave única é NÚMERO + VERTICAL — conferido nas 4.416
   * conversões do dump, zero colisões.
   *
   * `id_unidade` é a filial do contrato, e é por ela que o Kurole agrupa o
   * funil. Mesma numeração de `corretores.empresa`.
   */
  await pool.query(`ALTER TABLE conversoes ADD COLUMN IF NOT EXISTS contrato_numero INTEGER`);
  await pool.query(`ALTER TABLE conversoes ADD COLUMN IF NOT EXISTS unidade_id INTEGER`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS conversoes_contrato_idx
    ON conversoes (contrato_numero, locacao_venda)
  `);
  console.log("ok: conversoes.contrato_numero + unidade_id + índice");
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
