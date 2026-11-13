#!/usr/bin/env node
/**
 * Jessica Piemontez afastada; Samuel Felix de Paula assume a gerência de
 * locação da Dutra (Jonatan, 13/11/2026).
 *
 * O que ESTE script faz: desativa o login da Jessica no BI. "Afastada" não é
 * desligamento — o cadastro fica, o acesso é que sai. Reverter é `ativo=true`.
 *
 * O que ele NÃO faz, de propósito:
 *  - não mexe nos rateios dela: comissão de negócio que ela fechou antes do
 *    afastamento continua dela;
 *  - não a tira de `corretores_fechamento.json`: a adm ainda precisa poder
 *    lançar negócio fechado por ela antes de sair;
 *  - não cria o login do Samuel: falta decidir com que e-mail (ver abaixo).
 *
 * ⚠️ O bloco Gerência do fechamento de LOCAÇÃO DA DUTRA fica vazio enquanto o
 * Samuel não tiver login. `gerenteDaUnidade` casa usuarios_bi.email com
 * corretores.email, e o cadastro dele no Kurole está com
 * `vistaverde@imobiliariamaciel.com.br` — caixa da unidade, não e-mail
 * pessoal. Os outros seis gerentes de locação usam e-mail pessoal. Antes de
 * criar o acesso, pedir que troquem o e-mail dele no Kurole.
 *
 * A unidade dele já foi movida para Dutra em `correcoes_manuais.json`
 * (auto-expirável quando arrumarem o departamento no Kurole).
 *
 * Uso: node scripts/afasta-jessica-promove-samuel.js [--aplicar]
 * Idempotente.
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const { Pool } = require("pg");

const EMAIL_JESSICA = "jessica.piemontez@imobiliariamaciel.com.br";
const APLICAR = process.argv.includes("--aplicar");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 6; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 5) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
};

(async () => {
  const [j] = (await q(
    `SELECT id, nome, email, role, unidade, tipo, ativo FROM usuarios_bi WHERE lower(email) = $1`,
    [EMAIL_JESSICA]
  )).rows;
  if (!j) throw new Error("login da Jessica não encontrado");
  console.log(`Jessica: #${j.id} · ${j.role} · ${j.unidade}/${j.tipo} · ativo=${j.ativo}`);

  if (!j.ativo) {
    console.log("  já está desativada — nada a fazer");
  } else if (!APLICAR) {
    console.log("  (simulação) desativaria o login dela");
  } else {
    await q(`UPDATE usuarios_bi SET ativo = false WHERE id = $1`, [j.id]);
    console.log("  login DESATIVADO");
  }

  // quem sobra como gerente de locação da Dutra
  const { rows: g } = await q(
    `SELECT u.nome, u.email FROM usuarios_bi u
     WHERE u.role = 'gerente' AND u.tipo = 'locacao' AND u.unidade = 'Dutra' AND u.ativo = true`
  );
  console.log(`\ngerente de locação da Dutra com login ativo: ${g.length ? g.map(r => r.nome).join(", ") : "NENHUM — o bloco Gerência vai sair vazio"}`);

  const [s] = (await q(
    `SELECT id, COALESCE(NULLIF(TRIM(nome_comercial),''),nome) nome, email FROM corretores WHERE id = 927`
  )).rows;
  console.log(`Samuel no Kurole: #${s.id} · ${s.nome} · ${s.email}`);
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
