#!/usr/bin/env node
/**
 * Daniel Santos deixa a gerência de vendas da Dutra e volta a ser CORRETOR de
 * vendas da unidade; Emanoel Anderson Duarte Montenegro ("Anderson", corretor
 * #1100) assume a gerência (Jonatan, 16/11/2026).
 *
 * O que ESTE script faz no BI:
 *  - cria o login do Anderson como gerente de vendas da Dutra, copiando o
 *    perfil de outro gerente de vendas em vez de digitar os campos;
 *  - DESATIVA o login do Daniel. Não é desligamento: ele continua na Maciel,
 *    mas corretor não tem acesso ao BI — o único perfil que existe para quem
 *    atende é nenhum. Deixar o login de pé daria a ele a unidade inteira, e
 *    faria `gerenteDaUnidade` ter dois candidatos para o mesmo LIMIT 1.
 *
 * O que ele NÃO faz, de propósito:
 *  - não mexe em rateio nenhum: a gerência dos negócios que o Daniel fechou
 *    como gerente continua dele, e os de novembro já lançados ficam como
 *    estão (quem assina o mês é quem a diretoria decidir);
 *  - não tira o Daniel de `corretores_fechamento.json`: ele passa a aparecer
 *    nos blocos de levantamento/fechamento, que é exatamente o que um
 *    corretor faz.
 *
 * ⚠️ DEPENDE DO KUROLE para o bloco Gerência preencher sozinho.
 * `gerenteDaUnidade` casa usuarios_bi.email com corretores.email: o #1100 já
 * está com `manoel.guttierrez@imobiliariamaciel.com.br`, então o vínculo
 * fecha na hora. O que falta lá é só o DEPARTAMENTO dos dois, que hoje está
 * trocado (#138 em "Gerente Vendas Dutra", #1100 em "Vendas Dutra"). Isso não
 * quebra nada — os dois departamentos caem na mesma unidade/vertical —, mas
 * deixa o organograma mentindo. Pedir a troca.
 *
 * ⚠️ Existe OUTRO Anderson ativo em Vendas Dutra: Anderson Campos (#314).
 * O gerente é o #1100, pelo e-mail. Nunca casar por "Anderson".
 *
 * Uso: node scripts/troca-gerencia-vendas-dutra.js [--aplicar]
 * Idempotente.
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const { Pool } = require("pg");

const EMAIL_DANIEL = "daniel.santos@imobiliariamaciel.com.br";
const EMAIL_ANDERSON = "manoel.guttierrez@imobiliariamaciel.com.br";
const NOME_ANDERSON = "Anderson Montenegro";
const MODELO = "eder.ribeiro@imobiliariamaciel.com.br"; // gerente de vendas
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
  // ---------- 1. o novo gerente ----------
  const [ja] = (await q(
    `SELECT id, nome, role, unidade, tipo, ativo FROM usuarios_bi WHERE lower(email)=$1`, [EMAIL_ANDERSON]
  )).rows;

  if (ja) {
    console.log(`Anderson já tem login: #${ja.id} ${ja.nome} · ${ja.role} · ${ja.unidade}/${ja.tipo} · ativo=${ja.ativo}`);
  } else {
    const [m] = (await q(
      `SELECT role, tipo, marketing, ranking, contratos FROM usuarios_bi WHERE lower(email)=$1`, [MODELO]
    )).rows;
    if (!m) throw new Error(`modelo ${MODELO} não encontrado`);
    if (m.role !== "gerente" || m.tipo !== "venda") {
      throw new Error(`o modelo deixou de ser gerente de vendas (hoje ${m.role}/${m.tipo}) — conferir antes`);
    }
    console.log(`modelo: ${MODELO} · ${m.role}/${m.tipo} · marketing=${m.marketing} ranking=${m.ranking} contratos=${m.contratos}`);
    console.log(`criaria: ${NOME_ANDERSON} · ${EMAIL_ANDERSON} · ${m.role} · ${UNIDADE}/${m.tipo}`);
    if (APLICAR) {
      const [novo] = (await q(
        `INSERT INTO usuarios_bi (email, nome, role, unidade, tipo, marketing, ranking, contratos, ativo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
         RETURNING id, nome, role, unidade, tipo, ativo`,
        [EMAIL_ANDERSON, NOME_ANDERSON, m.role, UNIDADE, m.tipo,
         m.marketing === true, m.ranking === true, m.contratos === true]
      )).rows;
      console.log(`  criado: #${novo.id} · ${novo.role} · ${novo.unidade}/${novo.tipo} · ativo=${novo.ativo}`);
    }
  }

  // ---------- 2. o gerente que sai ----------
  const [d] = (await q(
    `SELECT id, nome, role, unidade, tipo, ativo FROM usuarios_bi WHERE lower(email)=$1`, [EMAIL_DANIEL]
  )).rows;
  if (!d) throw new Error("login do Daniel não encontrado");
  console.log(`\nDaniel: #${d.id} · ${d.role} · ${d.unidade}/${d.tipo} · ativo=${d.ativo}`);
  if (!d.ativo) {
    console.log("  já está desativado — nada a fazer");
  } else if (!APLICAR) {
    console.log("  (simulação) desativaria o login dele (volta a ser corretor)");
  } else {
    await q(`UPDATE usuarios_bi SET ativo = false WHERE id = $1`, [d.id]);
    console.log("  login DESATIVADO — ele volta a ser corretor de vendas da Dutra");
  }

  // ---------- 3. conferência ----------
  const { rows: g } = await q(
    `SELECT u.nome, u.email,
            (SELECT count(*)::int FROM corretores c WHERE lower(c.email)=lower(u.email)) AS elo
     FROM usuarios_bi u
     WHERE u.role='gerente' AND u.tipo='venda' AND u.unidade='Dutra' AND u.ativo=true`
  );
  console.log(`\ngerente de vendas da Dutra com login ativo: ${
    g.length ? g.map(r => `${r.nome} (vínculo Kurole: ${r.elo ? "OK" : "NÃO ENCONTRADO"})`).join(", ")
             : "NENHUM — o bloco Gerência sairia vazio"}`);
  if (g.length > 1) console.log("⚠️ mais de um: gerenteDaUnidade pega só o primeiro, arrumar");

  if (!APLICAR) console.log("\n(simulação — rode com --aplicar)");
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
