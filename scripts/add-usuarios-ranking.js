#!/usr/bin/env node
/**
 * Coluna `ranking` em usuarios_bi (30/09/2026).
 *
 * O ranking é da diretoria, e a diretoria no BI é o papel `admin`. A Daniela
 * é diretora de vendas mas está modelada como `gerente` — promovê-la a admin
 * para ela ver o ranking daria junto reabrir fechamento e mexer na comissão
 * de toda a empresa, que não é o que o Jonatan pediu.
 *
 * Por isso uma permissão avulsa, no mesmo molde do `marketing` que já existe:
 * um sim/não por pessoa, lido no login e carregado no cookie.
 *
 * Default `false` de propósito — quem não foi marcado continua sem ver.
 *
 * ⚠️ Depois de rodar, quem ganhou a permissão precisa SAIR e ENTRAR de novo:
 * o JWT não é reconsultado a cada request.
 *
 * Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  await pool.query(`
    ALTER TABLE usuarios_bi
    ADD COLUMN IF NOT EXISTS ranking BOOLEAN NOT NULL DEFAULT false
  `);
  console.log("ok: coluna ranking");

  // Admin já entra pelo papel; a marca aqui é só para o dado não mentir sobre
  // quem enxerga o ranking.
  const r = await pool.query(`UPDATE usuarios_bi SET ranking = true WHERE role = 'admin' AND NOT ranking`);
  console.log(`admins marcados: ${r.rowCount}`);

  const d = await pool.query(
    `UPDATE usuarios_bi SET ranking = true WHERE email = 'daniela@imobiliariamaciel.com.br' AND NOT ranking`
  );
  console.log(`Daniela: ${d.rowCount ? "liberada" : "já estava liberada (ou e-mail não encontrado)"}`);

  const { rows } = await pool.query(
    `SELECT nome, email, role, ranking FROM usuarios_bi WHERE ranking ORDER BY role, nome`
  );
  console.table(rows);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
