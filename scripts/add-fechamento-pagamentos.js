// Cria a tabela de histórico de pagamentos de comissão por destinatário do
// rateio (18/09/2026). Idempotente (CREATE TABLE IF NOT EXISTS).
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fechamento_pagamentos (
      id SERIAL PRIMARY KEY,
      negocio_corretor_id INTEGER NOT NULL REFERENCES fechamento_negocio_corretores(id) ON DELETE CASCADE,
      valor DECIMAL(15,2) NOT NULL,
      data_pagamento DATE NOT NULL,
      observacao TEXT,
      criado_em TIMESTAMP DEFAULT NOW(),
      criado_por INTEGER REFERENCES usuarios_bi(id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fpag_negcorr ON fechamento_pagamentos(negocio_corretor_id)`);
  console.log("ok: fechamento_pagamentos");

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
