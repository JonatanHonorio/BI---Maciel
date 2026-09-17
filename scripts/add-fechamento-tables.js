// Cria as tabelas do sistema de fechamento mensal (17/09/2026).
// Idempotente (CREATE TABLE IF NOT EXISTS) — seguro rodar de novo.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fechamento_periodos (
      id SERIAL PRIMARY KEY,
      competencia DATE NOT NULL,
      unidade VARCHAR(60) NOT NULL,
      tipo VARCHAR(10) NOT NULL,
      status VARCHAR(10) NOT NULL DEFAULT 'aberto',
      enviado_por INTEGER REFERENCES usuarios_bi(id),
      enviado_em TIMESTAMP,
      criado_em TIMESTAMP DEFAULT NOW(),
      UNIQUE (competencia, unidade, tipo)
    )
  `);
  console.log("ok: fechamento_periodos");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fechamento_negocios (
      id SERIAL PRIMARY KEY,
      periodo_id INTEGER NOT NULL REFERENCES fechamento_periodos(id),
      data_contrato DATE,
      ref VARCHAR(30),
      contrato VARCHAR(30),
      endereco TEXT,
      origem VARCHAR(60),
      valor DECIMAL(15,2),
      comissao DECIMAL(15,2),
      pagamento VARCHAR(30),
      observacao TEXT,
      comissao_paga BOOLEAN NOT NULL DEFAULT false,
      comissao_paga_em TIMESTAMP,
      comissao_paga_por INTEGER REFERENCES usuarios_bi(id),
      criado_em TIMESTAMP DEFAULT NOW(),
      criado_por INTEGER REFERENCES usuarios_bi(id),
      atualizado_em TIMESTAMP,
      atualizado_por INTEGER REFERENCES usuarios_bi(id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fneg_periodo ON fechamento_negocios(periodo_id)`);
  console.log("ok: fechamento_negocios");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fechamento_negocio_corretores (
      id SERIAL PRIMARY KEY,
      negocio_id INTEGER NOT NULL REFERENCES fechamento_negocios(id) ON DELETE CASCADE,
      papel VARCHAR(12) NOT NULL,
      corretor_id INTEGER NOT NULL REFERENCES corretores(id),
      percentual DECIMAL(6,4)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fnegcorr_negocio ON fechamento_negocio_corretores(negocio_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_fnegcorr_corretor ON fechamento_negocio_corretores(corretor_id)`);
  console.log("ok: fechamento_negocio_corretores");

  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
