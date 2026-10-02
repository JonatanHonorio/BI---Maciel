#!/usr/bin/env node
/**
 * Os oito negócios que a correção da captação de 20% não alcançou, agora com
 * os percentuais que a Tatiane definiu (02/10/2026).
 *
 * Eram os casos sem regra: captação dividida com outra pessoa, dois
 * fechadores, e comissão já paga acima do que a regra nova daria. Ela mandou
 * caso a caso, e o padrão que saiu é claro — quando o Girotto ou o Mauro
 * dividem a captação, eles ficam com 10% e o outro com 5%, e o Fechamento
 * desce para 25% para o negócio continuar fechando em 54,5% (venda) e 63%
 * (locação).
 *
 * Cada linha é identificada pelo id DO RATEIO, não pelo papel: há negócio com
 * duas linhas no mesmo bloco (duas captações, dois fechadores), e papel
 * sozinho não distingue. O script confere o nome antes de escrever — se o
 * rateio tiver mudado, ele para em vez de gravar no lugar errado.
 *
 * FORA: a ref 63666 (#783). A Tatiane mandou captação do Girotto em 10% e
 * fechamento do Janduir em 20%, o que soma 53% — dez pontos abaixo dos 63%
 * da locação. Nos outros sete as contas fecham exatas, então aqui falta uma
 * informação, e chutar qual seria inventar dinheiro.
 *
 * Uso: node scripts/rateio-oito-pendentes.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

// { linha: id em fechamento_negocio_corretores, confere: trecho do nome, pct }
const AJUSTES = [
  // 1. ref 63244 — venda, Satélite 03/2026
  { ref: "63244", linha: 1604, confere: "GIROTTO", pct: 0.10 },
  { ref: "63244", linha: 1605, confere: "Matheus", pct: 0.05 },
  { ref: "63244", linha: 1606, confere: "GIROTTO", pct: 0.25 },
  // 2. ref 51304 — locação, Satélite 06/2026
  { ref: "51304", linha: 4703, confere: "GIROTTO", pct: 0.10 },
  { ref: "51304", linha: 4702, confere: "Maurita", pct: 0.05 },
  { ref: "51304", linha: 4704, confere: "Erika", pct: 0.25 },
  // 3. ref 57615 — locação, Satélite 07/2026
  { ref: "57615", linha: 3726, confere: "GIROTTO", pct: 0.10 },
  { ref: "57615", linha: 3727, confere: "Alan", pct: 0.05 },
  { ref: "57615", linha: 3728, confere: "Marcondes", pct: 0.25 },
  // 4. ref 56542 — locação, Esplanada 07/2026
  { ref: "56542", linha: 3820, confere: "Mauro", pct: 0.10 },
  { ref: "56542", linha: 3819, confere: "Marcondes", pct: 0.05 },
  { ref: "56542", linha: 3821, confere: "Wellington", pct: 0.25 },
  // 5. ref 47273 — locação, Satélite 12/2025 (dois fechadores)
  { ref: "47273", linha: 3184, confere: "GIROTTO", pct: 0.20 },
  { ref: "47273", linha: 3185, confere: "GIROTTO", pct: 0.10 },
  { ref: "47273", linha: 3186, confere: "Wellington", pct: 0.10 },
  // 6. ref 65075 — venda, Satélite 07/2026
  { ref: "65075", linha: 2851, confere: "GIROTTO", pct: 0.20 },
  { ref: "65075", linha: 2852, confere: "GIROTTO", pct: 0.20 },
  // 8. ref 47716 — locação, Esplanada 12/2025
  { ref: "47716", linha: 3212, confere: "GIROTTO", pct: 0.20 },
  { ref: "47716", linha: 3213, confere: "Catarina", pct: 0.20 },
];

(async () => {
  const refs = [...new Set(AJUSTES.map((a) => a.ref))];

  for (const a of AJUSTES) {
    const [l] = (await q(`
      SELECT rc.id, (rc.percentual*100)::float pct, n.ref,
             COALESCE(NULLIF(TRIM(k.nome_comercial),''), k.nome, rc.nome_livre) nome
      FROM fechamento_negocio_corretores rc
      JOIN fechamento_negocios n ON n.id = rc.negocio_id
      LEFT JOIN corretores k ON k.id = rc.corretor_id
      WHERE rc.id = $1`, [a.linha])).rows;
    if (!l) throw new Error(`linha ${a.linha} não existe mais`);
    if (l.ref !== a.ref || !l.nome || !l.nome.includes(a.confere)) {
      throw new Error(`linha ${a.linha} mudou: esperava ${a.confere} na ref ${a.ref}, achei ${l.nome} na ref ${l.ref}`);
    }
    const mudou = Math.abs(l.pct - a.pct * 100) > 0.001;
    console.log(`  ref ${a.ref} linha ${a.linha} ${l.nome}: ${l.pct}% ${mudou ? `-> ${a.pct * 100}%` : "(já está)"}`);
    if (APLICAR && mudou) {
      await q(`UPDATE fechamento_negocio_corretores SET percentual = $2 WHERE id = $1`, [a.linha, a.pct]);
    }
  }

  const { rows: somas } = await q(`
    SELECT n.ref, p.tipo, round(sum(rc.percentual)*100, 2)::float soma
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
    WHERE n.ref = ANY($1::text[]) GROUP BY 1, 2 ORDER BY 1`, [[...refs, "63666"]]);
  console.log("\nsoma do rateio (venda fecha em 54,5% · locação em 63%):");
  console.table(somas);

  // Baixar um percentual pode deixar alguém com mais recebido do que devido.
  const { rows: acima } = await q(`
    SELECT n.ref, rc.papel, COALESCE(NULLIF(TRIM(k.nome_comercial),''), k.nome, rc.nome_livre) nome,
           round(rc.percentual * (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END), 2)::float devido,
           COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id), 0)::float pago
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    LEFT JOIN corretores k ON k.id = rc.corretor_id
    WHERE n.ref = ANY($1::text[])
      AND COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id), 0)
          > rc.percentual * (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END) + 0.01
    ORDER BY n.ref`, [refs]);
  console.log("\nquem ficou com mais recebido do que devido:");
  console.table(acima);

  if (!APLICAR) console.log("\n(simulação — rode com --aplicar para gravar)");
  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
