#!/usr/bin/env node
/**
 * Cria o acesso da Henriete no BI com o MESMO perfil da Ana Mendes — a "Carol"
 * do setor de contratos (pedido da Tatiane em 16/10/2026).
 *
 * Perfil copiado da Ana (id 89), e não digitado à mão, justamente para não
 * divergir: `role = contratos`, sem unidade e sem vertical, o que no Kanban
 * significa ver **todas** as unidades e as **duas** verticais, com o bloco
 * bancário liberado (`podeVerBanco`). É o perfil de quem opera a esteira:
 * cria card, edita e move entre quaisquer fases.
 *
 * NÃO define senha. Todo mundo no BI nasce com `senha_hash` nulo; o acesso se
 * completa pelo link de "definir senha", que sai de
 * `scripts/link-definir-senha.js` e vai pela mão (o SMTP do BI não entrega em
 * `@imobiliariamaciel.com.br`).
 *
 * Uso: node scripts/cria-acesso-henriete.js [--aplicar]
 * Idempotente: se o e-mail já existir, só mostra e sai.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");

const MODELO = 89; // Ana Mendes
const NOME = "Henriete";
const EMAIL = "contratos@imobiliariamaciel.com.br";

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

(async () => {
  const [modelo] = (await q(
    `SELECT id, nome, email, role, unidade, unidades, tipo, marketing, ranking, ativo
     FROM usuarios_bi WHERE id = $1`, [MODELO])).rows;
  if (!modelo) throw new Error(`usuário modelo ${MODELO} não existe`);
  if (modelo.role !== "contratos") {
    throw new Error(`o modelo deixou de ser 'contratos' (hoje é '${modelo.role}') — conferir antes`);
  }

  console.log(`modelo: ${modelo.nome} (${modelo.email})`);
  console.log(`  role=${modelo.role} unidade=${modelo.unidade ?? "todas"} unidades=${JSON.stringify(modelo.unidades)} tipo=${modelo.tipo ?? "as duas"} marketing=${modelo.marketing} ranking=${modelo.ranking}`);
  console.log(`\nnovo acesso: ${NOME} (${EMAIL}) — mesmo perfil`);

  const [existe] = (await q(`SELECT id, nome, role, (senha_hash IS NOT NULL) tem_senha FROM usuarios_bi WHERE lower(email) = lower($1)`, [EMAIL])).rows;
  if (existe) {
    console.log(`\njá existe: id ${existe.id} · ${existe.nome} · role ${existe.role} · ${existe.tem_senha ? "com senha" : "ainda sem senha"}`);
    console.log("nada a criar.");
    await pool.end();
    return;
  }

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para criar)");
    await pool.end();
    return;
  }

  const [novo] = (await q(
    `INSERT INTO usuarios_bi (nome, email, role, unidade, unidades, tipo, marketing, ranking, ativo)
     VALUES ($1, lower($2), $3, $4, $5, $6, $7, $8, true)
     RETURNING id, nome, email, role`,
    [NOME, EMAIL, modelo.role, modelo.unidade, modelo.unidades, modelo.tipo, modelo.marketing, modelo.ranking])).rows;

  console.log(`\n✔ criado: id ${novo.id} · ${novo.nome} · ${novo.email} · role ${novo.role} · sem senha`);
  console.log(`\npróximo passo — gerar o link de definir senha:`);
  console.log(`  node scripts/link-definir-senha.js ${EMAIL} --aplicar`);
  await pool.end();
})();
