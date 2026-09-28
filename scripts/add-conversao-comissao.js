// Valor da comissão da conversão (28/09/2026). Idempotente.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  /*
   * `conversao.taxa_valor` é o que a imobiliária recebe — valor × taxa. Em
   * venda é a Comissão; em locação é o Valor da Prestação de Serviço, que é o
   * mesmo campo com outro nome no fechamento.
   *
   * Confere com o que a adm digitou à mão: o contrato 239 (ref 2949) tem
   * taxa_valor 26.100,00, exatamente a comissão lançada no fechamento.
   */
  await pool.query(`ALTER TABLE conversoes ADD COLUMN IF NOT EXISTS comissao_valor NUMERIC(18,2)`);
  console.log("ok: conversoes.comissao_valor");
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
