// Marca de "sumiu do Kurole" (28/09/2026). Idempotente.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/*
 * O BI nunca apagava nada: a importação só insere e atualiza. Resultado —
 * registro excluído no Kurole continuava vivo aqui para sempre. Foi o que
 * criou o contrato fantasma de R$ 1.600 no funil do Satélite: o BI mostrava
 * 12 contratos e o Kurole 11, e o que sobrava tinha sido apagado lá.
 *
 * A marca é uma data, e não um DELETE, por dois motivos: dá para saber QUANDO
 * sumiu, e dá para voltar atrás se um dia a importação errar — apagar não tem
 * volta.
 *
 * Só nas tabelas que vêm INTEIRAS no dump. `imovel_atualizacoes` e
 * `lead_atividades` são importadas com corte de 12 meses, então "não veio no
 * dump" ali significa "é antigo", não "foi apagado" — marcá-las apagaria meia
 * base a cada importação.
 */
const TABELAS = ["conversoes", "conversao_corretores", "imoveis", "imovel_captadores"];

(async () => {
  for (const t of TABELAS) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS removido_em TIMESTAMP`);
    await pool.query(`CREATE INDEX IF NOT EXISTS ${t}_removido_idx ON ${t} (removido_em)`);
    console.log(`ok: ${t}.removido_em`);
  }
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
