#!/usr/bin/env node
/**
 * Mauro (#209), Girotto (#207) e Dimas (#174) trabalham em **20% / 20%** em
 * qualquer papel — confirmado pela Tatiane ao Jonatan em 10/11/2026.
 *
 * Até então o BI só aplicava a regra quando um deles CAPTAVA. Entrando como
 * FECHADOR, o negócio voltava aos 30/10 de tabela. Este script acerta os
 * negócios que saíram assim: o bloco Fechamento desce para 20% e o bloco
 * Levantamento sobe para 20%, dividido igualmente entre quem captou.
 *
 * A SOMA DO NEGÓCIO NÃO MUDA: 30+10 e 20+20 dão os mesmos 40 pontos. O que
 * muda é de que lado o dinheiro cai — por isso não mexe em gerência nem em
 * diretoria, e por isso o total do fechamento continua igual.
 *
 * ⚠️ PULA NEGÓCIO COM COMISSÃO JÁ PAGA. Mexer no percentual depois do
 * pagamento criaria diferença entre o devido e o pago, que é conversa de
 * acerto, não de correção. Esses saem na lista do fim para decisão humana.
 *
 * ⚠️ CORTE POR COMPETÊNCIA (--desde, padrão 2026-09). A reclamação da Tatiane
 * é sobre os fechamentos recentes. Negócio mais antigo e não pago também
 * aparece fora do 20/20 (o #276 de 04/2026), mas corrigir mês fechado há meio
 * ano é decisão de quem assina, não do script — ele sai na lista do fim.
 *
 * 🔒 DECISÃO DO JONATAN (10/11/2026): **o que já foi fechado fica como está,
 * até a diretoria pedir para mudar.** Vale para os 8 negócios com comissão
 * paga e para o #276 de 04/2026 (não pago, mas de competência antiga). Não
 * rodar com --desde para alcançá-los sem a diretoria pedir.
 *
 * Uso: node scripts/corrige-rateio-2020-girotto.js [--desde AAAA-MM] [--aplicar]
 * Idempotente, e grava backup JSON antes de escrever.
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const ESPECIAIS = [209, 207, 174];
const APLICAR = process.argv.includes("--aplicar");
/*
 * Corte por competência. A reclamação da Tatiane é sobre os fechamentos
 * RECENTES; negócio não pago de meses antigos (o #276, de 04/2026) também sai
 * fora do 20/20, mas mexer em mês fechado há meio ano é decisão de quem
 * assina, não do script. Ele aparece na lista do fim, sem ser tocado.
 */
const iDesde = process.argv.indexOf("--desde");
const DESDE = (iDesde > -1 && process.argv[iDesde + 1]) || "2026-09";
const noPeriodo = (mes) => { const [mm, aa] = mes.split("/"); return `${aa}-${mm}` >= DESDE; };
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 8; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 7) throw e; await new Promise(r => setTimeout(r, 2500)); }
  }
};
const BRL = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

(async () => {
  // Negócios em que um dos três é FECHADOR e o bloco não está em 20/20.
  const { rows: alvos } = await q(`
    WITH deles AS (
      SELECT DISTINCT n.id
      FROM fechamento_negocio_corretores rc
      JOIN fechamento_negocios n ON n.id = rc.negocio_id
      WHERE rc.corretor_id = ANY($1::int[]) AND rc.papel = 'fechamento'
    )
    SELECT n.id, n.ref, n.valor, n.comissao, p.tipo, p.unidade,
           to_char(p.competencia,'MM/YYYY') mes,
           round(sum(rc.percentual) FILTER (WHERE rc.papel='fechamento')*100,2)   fec,
           round(sum(rc.percentual) FILTER (WHERE rc.papel='levantamento')*100,2) lev,
           coalesce((SELECT sum(fp.valor) FROM fechamento_pagamentos fp
                     JOIN fechamento_negocio_corretores x ON x.id = fp.negocio_corretor_id
                     WHERE x.negocio_id = n.id),0)::float pago
    FROM deles d
    JOIN fechamento_negocios n ON n.id = d.id
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
    GROUP BY n.id, n.ref, n.valor, n.comissao, p.tipo, p.unidade, p.competencia
    HAVING round(sum(rc.percentual) FILTER (WHERE rc.papel='fechamento')*100,2) <> 20
    ORDER BY p.competencia, n.id`, [ESPECIAIS]);

  if (!alvos.length) { console.log("nada a corrigir — todos já estão em 20/20"); await pool.end(); return; }

  const corrigir = alvos.filter(a => Number(a.pago) === 0 && noPeriodo(a.mes));
  const antigos  = alvos.filter(a => Number(a.pago) === 0 && !noPeriodo(a.mes));
  const travados = alvos.filter(a => Number(a.pago) > 0);

  console.log(`${alvos.length} negócio(s) fora do 20/20 · ${corrigir.length} a corrigir · ${travados.length} com comissão já paga\n`);

  const backup = [];
  for (const a of corrigir) {
    const { rows: linhas } = await q(`
      SELECT rc.id, rc.papel, rc.percentual, rc.corretor_id,
             COALESCE(NULLIF(TRIM(c.nome_comercial),''),c.nome,rc.nome_livre) quem
      FROM fechamento_negocio_corretores rc
      LEFT JOIN corretores c ON c.id = rc.corretor_id
      WHERE rc.negocio_id = $1 AND rc.papel IN ('levantamento','fechamento')
      ORDER BY rc.papel DESC, rc.id`, [a.id]);
    const lev = linhas.filter(l => l.papel === "levantamento");
    const fec = linhas.filter(l => l.papel === "fechamento");
    const base = a.tipo === "venda" ? Number(a.comissao) : Number(a.valor);

    console.log(`#${a.id} · ${a.mes} · ${a.unidade}/${a.tipo} · ref ${a.ref} · base ${BRL(base)}`);
    const novos = [];
    for (const l of fec) {
      const novo = 0.20 / fec.length;
      novos.push({ id: l.id, de: Number(l.percentual), para: novo });
      console.log(`   fechamento   ${l.quem}: ${(100*l.percentual).toFixed(2)}% -> ${(100*novo).toFixed(2)}%  (${BRL(base*l.percentual)} -> ${BRL(base*novo)})`);
    }
    for (const l of lev) {
      const novo = 0.20 / (lev.length || 1);
      novos.push({ id: l.id, de: Number(l.percentual), para: novo });
      console.log(`   levantamento ${l.quem}: ${(100*l.percentual).toFixed(2)}% -> ${(100*novo).toFixed(2)}%  (${BRL(base*l.percentual)} -> ${BRL(base*novo)})`);
    }
    backup.push({ negocio: a.id, mes: a.mes, linhas: novos });
    if (APLICAR) {
      for (const n of novos) {
        await q(`UPDATE fechamento_negocio_corretores SET percentual = $2 WHERE id = $1`, [n.id, n.para]);
      }
    }
    console.log();
  }

  if (APLICAR && backup.length) {
    const arq = path.join(__dirname, `backup-rateio-2020-${Date.now()}.json`);
    fs.writeFileSync(arq, JSON.stringify(backup, null, 2), "utf-8");
    console.log(`backup: ${arq}`);
    console.log(`${backup.reduce((s,b)=>s+b.linhas.length,0)} linha(s) de rateio atualizada(s) em ${backup.length} negócio(s).`);
  } else if (!APLICAR) {
    console.log("(simulação — rode com --aplicar)");
  }

  if (antigos.length) {
    console.log(`\n⚠️ FORA DO CORTE (não pagos, competência anterior a ${DESDE}) — use --desde para alcançá-los:`);
    for (const a of antigos) {
      console.log(`   #${a.id} · ${a.mes} · ${a.unidade}/${a.tipo} · ref ${a.ref} · fec ${a.fec}% lev ${a.lev}%`);
    }
  }

  if (travados.length) {
    console.log(`\n⚠️ NÃO MEXI nestes — a comissão já foi paga, corrigir abre diferença:`);
    for (const a of travados) {
      console.log(`   #${a.id} · ${a.mes} · ${a.unidade}/${a.tipo} · ref ${a.ref} · fec ${a.fec}% lev ${a.lev}% · já pago ${BRL(a.pago)}`);
    }
  }
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
