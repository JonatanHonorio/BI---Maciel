#!/usr/bin/env node
/**
 * A diretora de vendas passa a VER o fechamento de todas as unidades
 * (03/11/2026).
 *
 * POR QUÊ: ela é `gerente` com unidade NULL, e `unidadesFechamento` devolve []
 * para esse caso de propósito — "sem unidade" é nenhuma, nunca todas. O
 * resultado é que a tela de Fechamento não abria para ela de jeito nenhum. O
 * caminho que existia, o "Ver como", só alcança as seis unidades que têm
 * gerente: Diretoria e Lançamento ficavam fora, e foi justamente sobre uma
 * venda da Diretoria que ela precisou tirar a dúvida.
 *
 * Preencher `unidades` resolve a leitura sem tocar em `unidade`, que continua
 * NULL — é esse NULL que a identifica como diretoria e mantém o "Ver como"
 * funcionando.
 *
 * ESCRITA continua barrada: o proxy recusa qualquer método que não seja de
 * leitura em /api/fechamento para a diretoria, olhando a sessão REAL (senão
 * ela escaparia da trava entrando em "Ver como").
 *
 * ⚠️ O JWT é assinado no login e não é reconsultado: ela precisa SAIR e
 * ENTRAR de novo para as unidades valerem.
 *
 * Uso: node scripts/diretoria-le-fechamento.js [--aplicar]
 * Idempotente.
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const { Pool } = require("pg");

const UNIDADES = [
  "Satélite", "Vista Verde", "Urbanova", "Aquarius", "Esplanada", "Dutra",
  "Diretoria", "Lançamento",
];
const EMAIL = "daniela@imobiliariamaciel.com.br";
const APLICAR = process.argv.includes("--aplicar");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });

(async () => {
  const [u] = (await pool.query(
    `SELECT id, nome, email, role, unidade, unidades, tipo, ativo
     FROM usuarios_bi WHERE lower(email) = $1`, [EMAIL]
  )).rows;
  if (!u) throw new Error(`usuário ${EMAIL} não existe`);
  console.log(`conta: ${u.nome} · ${u.role} · unidade=${u.unidade} · tipo=${u.tipo}`);
  console.log(`unidades hoje: ${JSON.stringify(u.unidades)}`);

  if (u.role !== "gerente" || u.unidade !== null) {
    throw new Error("o cadastro deixou de ser 'gerente sem unidade' — conferir antes de mexer");
  }
  if (JSON.stringify(u.unidades) === JSON.stringify(UNIDADES)) {
    console.log("nada a fazer — já está com todas as unidades");
    await pool.end();
    return;
  }
  if (!APLICAR) {
    console.log(`\n(simulação) passaria a: ${JSON.stringify(UNIDADES)}`);
    console.log("rode com --aplicar");
    await pool.end();
    return;
  }

  const [novo] = (await pool.query(
    `UPDATE usuarios_bi SET unidades = $2::text[] WHERE id = $1
     RETURNING id, nome, unidade, unidades, tipo`, [u.id, UNIDADES]
  )).rows;
  console.log(`\nagora: ${JSON.stringify(novo.unidades)}`);
  console.log("⚠️ ela precisa SAIR e ENTRAR de novo no BI — o JWT é assinado no login.");
  await pool.end();
})().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
