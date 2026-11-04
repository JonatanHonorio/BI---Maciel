#!/usr/bin/env node
/**
 * Permissão avulsa de operar o Kanban de contratos (04/11/2026).
 *
 * POR QUÊ uma coluna, e não trocar o papel: as diretoras cobrem o setor
 * quando alguém falta, mas `role = "contratos"` prende a pessoa em /contratos
 * — ela perderia fechamento, resumo, ranking e o "Ver como". A coluna segue o
 * molde do `ranking`, que existe pelo mesmo motivo.
 *
 * A TATIANE NÃO ENTRA AQUI: ela é admin e já opera o quadro inteiro pelo
 * papel. Ligar a permissão para ela não mudaria nada.
 *
 * ⚠️ O JWT é assinado no login: quem receber a permissão precisa SAIR e
 * ENTRAR de novo no BI.
 *
 * Uso: node scripts/add-permissao-contratos.js [--aplicar]
 * Idempotente.
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const { Pool } = require("pg");

const EMAILS = ["daniela@imobiliariamaciel.com.br"];
const APLICAR = process.argv.includes("--aplicar");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (sql, p) => {
  for (let i = 0; i < 6; i++) {
    try { return await pool.query(sql, p); }
    catch (e) { if (i === 5) throw e; await new Promise((r) => setTimeout(r, 2000)); }
  }
};

(async () => {
  const [{ existe }] = (await q(
    `SELECT count(*)::int AS existe FROM information_schema.columns
     WHERE table_name = 'usuarios_bi' AND column_name = 'contratos'`
  )).rows;

  if (!existe) {
    console.log(APLICAR ? "criando coluna usuarios_bi.contratos..." : "(simulação) criaria a coluna usuarios_bi.contratos");
    if (APLICAR) {
      await q(`ALTER TABLE usuarios_bi ADD COLUMN contratos boolean NOT NULL DEFAULT false`);
      console.log("coluna criada");
    }
  } else {
    console.log("coluna usuarios_bi.contratos já existe");
  }

  if (!existe && !APLICAR) { await pool.end(); return; }

  for (const email of EMAILS) {
    const [u] = (await q(
      `SELECT id, nome, role, contratos FROM usuarios_bi WHERE lower(email) = $1`, [email]
    )).rows;
    if (!u) { console.log(`  ⚠️ ${email} não existe`); continue; }
    if (u.role === "admin" || u.role === "contratos") {
      console.log(`  ${u.nome}: já opera o quadro pelo papel '${u.role}' — permissão desnecessária`);
      continue;
    }
    if (u.contratos === true) { console.log(`  ${u.nome}: já tem a permissão`); continue; }
    if (!APLICAR) { console.log(`  (simulação) ligaria para ${u.nome} (${u.role})`); continue; }
    await q(`UPDATE usuarios_bi SET contratos = true WHERE id = $1`, [u.id]);
    console.log(`  ${u.nome} (${u.role}): permissão LIGADA`);
  }

  const { rows } = await q(
    `SELECT nome, role, contratos FROM usuarios_bi
     WHERE ativo = true AND (contratos = true OR role IN ('admin','contratos')) ORDER BY role, nome`
  );
  console.log("\nquem opera o Kanban de contratos hoje:");
  for (const r of rows) console.log(`  ${r.nome} — ${r.contratos ? "permissão avulsa" : `papel ${r.role}`}`);
  if (APLICAR) console.log("\n⚠️ quem ganhou a permissão precisa SAIR e ENTRAR de novo no BI.");
  await pool.end();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
