// Campos que o handoff do tráfego pago pediu e o BI não trazia (22/09/2026).
//
// `frequency` é o que distingue **público saturado** (frequência subindo, acima
// de ~2,5) de **criativo gasto** (frequência caindo junto com o CTR). Sem ela o
// diagnóstico é chute — e os dois casos pedem ações opostas.
//
// `effective_status` do anúncio não vem no insights: vem de /ads. Sem ele o
// ranking de criativos mostra anúncio pausado como se estivesse no ar.
//
// Idempotente (ADD COLUMN IF NOT EXISTS).
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`ALTER TABLE meta_insights_diarios ADD COLUMN IF NOT EXISTS frequencia NUMERIC(10,4)`);
  await pool.query(`ALTER TABLE meta_anuncio_insights ADD COLUMN IF NOT EXISTS frequencia NUMERIC(10,4)`);
  await pool.query(`ALTER TABLE meta_anuncios ADD COLUMN IF NOT EXISTS status_efetivo TEXT`);
  // Objetivo da campanha decide a MOEDA do resultado (lead × conversa). Já
  // existe em meta_campanhas.objetivo; o índice abaixo é só pra tela de
  // campanhas ativas, que filtra por status a cada carregamento.
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_campanhas_status ON meta_campanhas (status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_meta_insights_data ON meta_insights_diarios (data)`);
  console.log("ok — colunas e índices garantidos");
  await pool.end();
})();
