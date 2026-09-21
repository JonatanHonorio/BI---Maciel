#!/usr/bin/env node
/**
 * Cria/atualiza as contas de login individual do BI (15/09/2026).
 *
 * Idempotente: roda com ON CONFLICT (email) DO UPDATE, mas NUNCA mexe em
 * senha_hash — só o próprio fluxo de "esqueci minha senha" define isso, pra
 * rodar este script de novo não apagar senha de quem já definiu.
 *
 * Uso: node scripts/seed-usuarios-bi.js
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ADMIN = { role: "admin", unidade: null, tipo: null, marketing: true };
const GERENTE_VENDA = { role: "gerente", tipo: "venda", marketing: false };
const GERENTE_LOCACAO = { role: "gerente", tipo: "locacao", marketing: false };
const DIRETORA_VENDAS = { role: "gerente", unidade: null, tipo: "venda", marketing: false };
// Gerente administrativa: só /fechamento e /fechamento/comissoes, nas DUAS
// verticais da própria unidade (por isso tipo null). `unidade` é a principal e
// `unidades` é a lista completa — preenchidas as duas até nas de unidade única,
// pra ter uma forma só de ler o dado.
const ADM = { role: "gerente_adm", tipo: null, marketing: false };

const usuarios = [
  // Acesso total — igual ao Jonatan
  { email: "jonatanhonorio@gmail.com", nome: "Jonatan Honório", ...ADMIN },
  { email: "pietracmaciel5@gmail.com", nome: "Pietra Maciel", ...ADMIN },
  { email: "tatiane@imobiliariamaciel.com.br", nome: "Tatiane", ...ADMIN },
  // Suzana, administrativo da matriz (21/09/2026). Único acesso no domínio
  // mtorre.com.br — os outros são imobiliariamaciel.com.br.
  { email: "adm@mtorre.com.br", nome: "Suzana", ...ADMIN },

  // Diretora de Vendas — todas as unidades, só vendas
  { email: "daniela@imobiliariamaciel.com.br", nome: "Daniela", ...DIRETORA_VENDAS },

  // Gerentes de Vendas
  { email: "patricia.generoso@imobiliariamaciel.com.br", nome: "Patricia Generoso", unidade: "Vista Verde", ...GERENTE_VENDA },
  { email: "bruno@imobiliariamaciel.com.br", nome: "Bruno", unidade: "Urbanova", ...GERENTE_VENDA },
  { email: "eder.ribeiro@imobiliariamaciel.com.br", nome: "Eder Ribeiro", unidade: "Satélite", ...GERENTE_VENDA },
  { email: "daniel.santos@imobiliariamaciel.com.br", nome: "Daniel Santos", unidade: "Dutra", ...GERENTE_VENDA },
  { email: "lilian.santos@imobiliariamaciel.com.br", nome: "Lilian Santos", unidade: "Esplanada", ...GERENTE_VENDA },
  { email: "andre.rodrigues@imobiliariamaciel.com.br", nome: "Andre Rodrigues", unidade: "Aquarius", ...GERENTE_VENDA },

  // Gerentes de Locação
  { email: "gisela@imobiliariamaciel.com.br", nome: "Gisela", unidade: "Vista Verde", ...GERENTE_LOCACAO },
  { email: "cecilia.paula@imobiliariamaciel.com.br", nome: "Cecilia Paula", unidade: "Urbanova", ...GERENTE_LOCACAO },
  { email: "joao.marcondes@imobiliariamaciel.com.br", nome: "Joao Marcondes", unidade: "Satélite", ...GERENTE_LOCACAO },
  { email: "jessica.piemontez@imobiliariamaciel.com.br", nome: "Jessica Piemontez", unidade: "Dutra", ...GERENTE_LOCACAO },
  { email: "wellington.oliveira@imobiliariamaciel.com.br", nome: "Wellington Oliveira", unidade: "Esplanada", ...GERENTE_LOCACAO },
  { email: "fabio.gomes@imobiliariamaciel.com.br", nome: "Fabio Gomes", unidade: "Aquarius", ...GERENTE_LOCACAO },

  // Gerentes administrativas (18/09/2026). Os e-mails carregam os nomes
  // antigos das unidades: Andrômeda = Satélite, São João = Esplanada.
  { email: "admandromeda@imobiliariamaciel.com.br", nome: "Erika", unidade: "Satélite", unidades: ["Satélite"], ...ADM },
  { email: "adm1.andromeda@imobiliariamaciel.com.br", nome: "Lucelia", unidade: "Satélite", unidades: ["Satélite"], ...ADM },
  { email: "adm2.saojoao@imobiliariamaciel.com.br", nome: "Mayra", unidade: "Esplanada", unidades: ["Esplanada"], ...ADM },
  { email: "adm.aquarius@imobiliariamaciel.com.br", nome: "Juliana", unidade: "Aquarius", unidades: ["Aquarius"], ...ADM },
  { email: "admvistaverde@imobiliariamaciel.com.br", nome: "Andreza", unidade: "Vista Verde", unidades: ["Vista Verde"], ...ADM },
  { email: "adm.dutra@imobiliariamaciel.com.br", nome: "Evelyn", unidade: "Dutra", unidades: ["Dutra"], ...ADM },
  // A Rachel lança também Diretoria e Lançamento, que não têm gerente próprio.
  { email: "adm.urbanova@imobiliariamaciel.com.br", nome: "Rachel", unidade: "Urbanova", unidades: ["Urbanova", "Diretoria", "Lançamento"], ...ADM },
];

(async () => {
  for (const u of usuarios) {
    await pool.query(
      `INSERT INTO usuarios_bi (email, nome, role, unidade, unidades, tipo, marketing, ativo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       ON CONFLICT (email) DO UPDATE SET
         nome = EXCLUDED.nome, role = EXCLUDED.role, unidade = EXCLUDED.unidade,
         unidades = EXCLUDED.unidades, tipo = EXCLUDED.tipo,
         marketing = EXCLUDED.marketing, ativo = true`,
      [u.email, u.nome, u.role, u.unidade ?? null, u.unidades ?? null, u.tipo ?? null, u.marketing]
    );
    console.log(`ok: ${u.email} (${u.role}${u.unidade ? ", " + u.unidade : ""}${u.tipo ? ", " + u.tipo : ""})`);
  }
  console.log(`\n${usuarios.length} contas processadas.`);
  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
