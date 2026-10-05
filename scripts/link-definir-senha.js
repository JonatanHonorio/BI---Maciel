#!/usr/bin/env node
/**
 * Gera o link de "definir senha" de um usuário do BI SEM passar por e-mail
 * (05/10/2026).
 *
 * POR QUE EXISTE. Todo mundo no BI começa com `senha_hash` nulo e se cadastra
 * pelo "Esqueci minha senha" — o e-mail é o único caminho. Só que o BI manda
 * esses e-mails de uma conta **pessoal do Gmail** (`SMTP_USER`) para endereços
 * `@imobiliariamaciel.com.br`: o SMTP autentica e o envio acontece, mas a
 * mensagem é filtrada do outro lado e a pessoa nunca recebe. Três gerentes
 * ficaram presos nisso.
 *
 * Este script faz o mesmo que a rota `/api/auth/forgot-password`, só que
 * devolve o link no terminal em vez de mandar e-mail. O destino é passar o
 * link pela mão (WhatsApp), até o remetente ser trocado por um endereço do
 * domínio da Maciel — que é o conserto de verdade.
 *
 * ⚠️ O LINK É UMA CREDENCIAL: quem o tiver define a senha daquela conta
 * enquanto ele valer. Mandar direto para a pessoa, nunca em grupo.
 *
 * ⚠️ Gerar um link novo INVALIDA o anterior. Se a pessoa estiver com um link
 * aberto, ele morre aqui.
 *
 * NÃO mexe em `senha_hash`: quem já tem senha continua com ela até usar o
 * link. Mas o script recusa por padrão quem já tem senha — para ninguém
 * derrubar o acesso de alguém sem querer (ver `--mesmo-com-senha`).
 *
 * Uso: node scripts/link-definir-senha.js <email> [--aplicar] [--mesmo-com-senha]
 * Sem --aplicar, só mostra a situação da conta.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");
const MESMO_COM_SENHA = process.argv.includes("--mesmo-com-senha");
const email = (process.argv[2] || "").toLowerCase().trim();

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

(async () => {
  if (!email || email.startsWith("--")) {
    console.error("uso: node scripts/link-definir-senha.js <email> [--aplicar]");
    process.exit(1);
  }

  const [u] = (await q(`
    SELECT id, email, nome, role, unidade, tipo, ativo,
           (senha_hash IS NOT NULL) AS tem_senha,
           reset_token_expires > now() AS link_anterior_vale
    FROM usuarios_bi WHERE email = $1`, [email])).rows;

  if (!u) {
    console.error(`nenhuma conta com o e-mail ${email}`);
    process.exit(1);
  }
  console.log(`conta: ${u.nome} · ${u.role}${u.unidade ? ` · ${u.unidade}` : ""}${u.tipo ? ` · ${u.tipo}` : ""}`);
  console.log(`ativa: ${u.ativo ? "sim" : "NÃO — o link não vai funcionar"}`);
  console.log(`já tem senha: ${u.tem_senha ? "sim" : "não (nunca se cadastrou)"}`);
  console.log(`link anterior ainda válido: ${u.link_anterior_vale ? "sim — será invalidado" : "não"}`);

  if (!u.ativo) {
    console.error("\nconta inativa: reative antes de gerar o link.");
    process.exit(1);
  }
  if (u.tem_senha && !MESMO_COM_SENHA) {
    console.error("\nesta conta JÁ TEM senha. Se a pessoa esqueceu, confirme com ela antes:");
    console.error("rode de novo com --mesmo-com-senha --aplicar");
    process.exit(1);
  }

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gerar o link)");
    await pool.end();
    return;
  }

  // Mesmo formato da rota: token aleatório, só o HASH vai pro banco.
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(token, 10);
  const expira = new Date(Date.now() + 60 * 60 * 1000);

  await q(`
    UPDATE usuarios_bi SET reset_token_hash = $2, reset_token_expires = $3 WHERE id = $1`,
    [u.id, tokenHash, expira.toISOString()]);

  const link = `${process.env.APP_URL}/reset-password?email=${encodeURIComponent(u.email)}&token=${token}`;
  console.log(`\nlink (vale 1 hora, até ${expira.toLocaleTimeString("pt-BR")}):\n\n${link}\n`);
  console.log("mande direto para a pessoa — quem tiver este link define a senha dela.");

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
