// Venda cancelada no fechamento (26/09/2026). Idempotente.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  /*
   * Venda cancelada/distratada: o registro FICA, os valores saem das contas.
   * Pedido do Jonatan em 26/09 — apagar a linha perderia o histórico ("esse
   * imóvel chegou a ser vendido em março"), e deixá-la valendo infla
   * faturamento, comissão e, quando existir, o ranking.
   *
   * Por isso é uma marca, e não um DELETE: quem soma passa a filtrar
   * `cancelado = false`, e quem lista mostra a linha com a marca.
   */
  await pool.query(`ALTER TABLE fechamento_negocios ADD COLUMN IF NOT EXISTS cancelado BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`ALTER TABLE fechamento_negocios ADD COLUMN IF NOT EXISTS cancelado_em TIMESTAMP`);
  await pool.query(`ALTER TABLE fechamento_negocios ADD COLUMN IF NOT EXISTS cancelado_por INTEGER REFERENCES usuarios_bi(id)`);
  await pool.query(`ALTER TABLE fechamento_negocios ADD COLUMN IF NOT EXISTS cancelado_motivo TEXT`);
  console.log("ok: fechamento_negocios.cancelado (+ em, por, motivo)");

  const [{ n }] = (await pool.query(`SELECT count(*)::int n FROM fechamento_negocios WHERE cancelado`)).rows;
  console.log(`negócios cancelados hoje: ${n}`);
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
