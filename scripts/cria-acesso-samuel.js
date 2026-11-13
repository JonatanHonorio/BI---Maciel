#!/usr/bin/env node
/**
 * Acesso do Samuel Felix de Paula no BI, como GERENTE DE LOCAÇÃO DA DUTRA —
 * ele assumiu no lugar da Jessica Piemontez, afastada (Jonatan, 13/11/2026).
 *
 * O perfil é copiado de outro gerente de locação em vez de digitado, pelo
 * mesmo motivo do acesso da Henriete: para não divergir do que já funciona.
 *
 * NÃO define senha. Todo mundo no BI nasce com `senha_hash` nulo e se cadastra
 * pelo link de "definir senha" (`scripts/link-definir-senha.js`), que vai pela
 * mão — o SMTP do BI não entrega em @imobiliariamaciel.com.br.
 *
 * ⚠️ O BLOCO GERÊNCIA DO FECHAMENTO SÓ VAI FUNCIONAR DEPOIS DE ARRUMAREM O
 * E-MAIL DELE NO KUROLE. `gerenteDaUnidade` casa usuarios_bi.email com
 * corretores.email, e o corretor #927 está com
 * `vistaverde@imobiliariamaciel.com.br` — caixa da unidade. O login aqui usa
 * o e-mail pessoal, que é o certo; o vínculo fecha quando os dois baterem.
 *
 * Uso: node scripts/cria-acesso-samuel.js [--aplicar]
 * Idempotente: se o e-mail já existir, só mostra e sai.
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const { Pool } = require("pg");

const NOME = "Samuel Felix";
const EMAIL = "samuel.felix@imobiliariamaciel.com.br";
const MODELO = "joao.marcondes@imobiliariamaciel.com.br"; // gerente de locação
const UNIDADE = "Dutra";
const APLICAR = process.argv.includes("--aplicar");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 6; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 5) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
};

(async () => {
  const [ja] = (await q(`SELECT id, nome, role, unidade, tipo, ativo FROM usuarios_bi WHERE lower(email)=$1`, [EMAIL])).rows;
  if (ja) {
    console.log(`já existe: #${ja.id} ${ja.nome} · ${ja.role} · ${ja.unidade}/${ja.tipo} · ativo=${ja.ativo}`);
    await pool.end();
    return;
  }

  const [m] = (await q(
    `SELECT role, tipo, marketing, ranking, contratos FROM usuarios_bi WHERE lower(email)=$1`, [MODELO]
  )).rows;
  if (!m) throw new Error(`modelo ${MODELO} não encontrado`);
  if (m.role !== "gerente" || m.tipo !== "locacao") {
    throw new Error(`o modelo deixou de ser gerente de locação (hoje ${m.role}/${m.tipo}) — conferir antes`);
  }
  console.log(`modelo: ${MODELO} · ${m.role}/${m.tipo} · marketing=${m.marketing} ranking=${m.ranking} contratos=${m.contratos}`);
  console.log(`criaria: ${NOME} · ${EMAIL} · ${m.role} · ${UNIDADE}/${m.tipo}`);
  if (!APLICAR) { console.log("\n(simulação — rode com --aplicar)"); await pool.end(); return; }

  const [novo] = (await q(
    `INSERT INTO usuarios_bi (email, nome, role, unidade, tipo, marketing, ranking, contratos, ativo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
     RETURNING id, nome, email, role, unidade, tipo, ativo`,
    [EMAIL, NOME, m.role, UNIDADE, m.tipo, m.marketing === true, m.ranking === true, m.contratos === true]
  )).rows;
  console.log(`\ncriado: #${novo.id} ${novo.nome} · ${novo.role} · ${novo.unidade}/${novo.tipo} · ativo=${novo.ativo}`);
  console.log("próximo passo: node scripts/link-definir-senha.js " + EMAIL + " --aplicar");

  const [elo] = (await q(
    `SELECT count(*)::int n FROM corretores WHERE lower(email) = $1`, [EMAIL]
  )).rows;
  console.log(`\nvínculo com o cadastro do Kurole por e-mail: ${elo.n ? "OK" : "AINDA NÃO — o corretor #927 está com vistaverde@; o bloco Gerência da Dutra/locação segue vazio até arrumarem lá"}`);
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
