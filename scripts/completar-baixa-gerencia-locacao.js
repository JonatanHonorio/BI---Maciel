#!/usr/bin/env node
/**
 * Completa as baixas de gerência de locação que ficaram no percentual antigo
 * (07/10/2026).
 *
 * O QUE ACONTECEU. A Mayra lançou os recebimentos da Esplanada em 30/09 e o BI
 * distribuiu a comissão sozinho, com a gerência de locação em **10%**. No dia
 * seguinte, 01/10, a regra foi corrigida para **20%** em 394 linhas retroativas
 * (`gerencia-locacao-20.js`) — porque 20% sempre foi o certo e o BI é que
 * estava errado. A baixa dela continuou valendo metade do novo devido, e todos
 * aqueles negócios passaram a aparecer como "Parcial" sem que ninguém tivesse
 * feito nada de errado. Foi ela quem percebeu e avisou.
 *
 * POR QUE COMPLETAR E NÃO COBRAR. O Jonatan confirmou em 07/10/2026 que **a
 * Maciel pagou os 20% ao Wellington** — o repasse real aconteceu pelo valor
 * certo, e foi só o registro no BI que saiu a menos. Então aqui não se está
 * inventando um pagamento: está-se terminando de anotar um que existiu.
 *
 * É o espelho do acerto de 02/10 (`ajustar-baixas-acima-do-devido.js`), que
 * baixou quem tinha ficado ACIMA do devido pela mesma troca de percentual.
 * Aquele script deixou de propósito quem estava ABAIXO, porque naquele momento
 * ninguém sabia se o dinheiro tinha saído — agora sabe-se.
 *
 * O QUE ELE NÃO TOCA. As 5 linhas de CAPTAÇÃO do Girotto e do Mauro (R$ 4.564),
 * que ficaram parciais pela outra correção do mesmo dia, a da captação de 20%.
 * É outra regra e outras pessoas: só entra quando o Jonatan confirmar que esse
 * repasse também saiu pelo valor novo.
 *
 * COMO ESCOLHE AS LINHAS. Gerência de locação a 20%, com baixa lançada ANTES
 * de 01/10, pagando menos do que o devido, e cujo negócio já foi 100% recebido
 * do cliente — essa última condição é o que separa "o BI registrou a menos" de
 * "o cliente ainda não pagou", que é um Parcial legítimo e não se mexe.
 *
 * A diferença entra com a DATA DA BAIXA ORIGINAL, não a de hoje: o repasse
 * aconteceu lá atrás, e datar hoje faria o relatório de pagamentos do mês
 * mostrar um dinheiro que não saiu em outubro.
 *
 * Uso: node scripts/completar-baixa-gerencia-locacao.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente: depois de rodar, não acha mais nada.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");
const CORTE = "2026-10-01"; // dia em que a gerência de locação virou 20%

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

(async () => {
  const { rows } = await q(`
    SELECT rc.id AS linha, n.ref, p.unidade, to_char(p.competencia,'MM/YYYY') comp,
           COALESCE(NULLIF(TRIM(k.nome_comercial),''), NULLIF(TRIM(k.nome),''), rc.nome_livre) AS nome,
           (rc.percentual*100)::float pct,
           (rc.percentual * n.valor)::float devido,
           COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp
                     WHERE fp.negocio_corretor_id = rc.id), 0)::float pago,
           n.valor::float pool,
           COALESCE((SELECT sum(fr.valor) FROM fechamento_recebimentos fr
                     WHERE fr.negocio_id = n.id), 0)::float recebido,
           (SELECT min(fp.criado_em) FROM fechamento_pagamentos fp
            WHERE fp.negocio_corretor_id = rc.id) AS primeira_baixa,
           (SELECT fp.data_pagamento FROM fechamento_pagamentos fp
            WHERE fp.negocio_corretor_id = rc.id ORDER BY fp.id LIMIT 1) AS data_original,
           (SELECT fp.recebimento_id FROM fechamento_pagamentos fp
            WHERE fp.negocio_corretor_id = rc.id ORDER BY fp.id LIMIT 1) AS recebimento_id,
           (SELECT fp.criado_por FROM fechamento_pagamentos fp
            WHERE fp.negocio_corretor_id = rc.id ORDER BY fp.id LIMIT 1) AS criado_por
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
    JOIN fechamento_periodos p ON p.id = n.periodo_id AND p.tipo = 'locacao'
    LEFT JOIN corretores k ON k.id = rc.corretor_id
    WHERE rc.papel = 'gerencia' AND rc.percentual = 0.20
    ORDER BY p.competencia, n.ref`);

  const alvo = rows.filter((r) =>
    r.pago > 0 &&
    r.pago < r.devido - 0.01 &&
    r.primeira_baixa && new Date(r.primeira_baixa) < new Date(CORTE) &&
    r.recebido >= r.pool - 0.01
  );

  console.log(`linhas de gerência de locação a 20%: ${rows.length}`);
  console.log(`a completar (baixa antes de ${CORTE}, negócio 100% recebido): ${alvo.length}`);

  const porPessoa = {};
  alvo.forEach((a) => {
    const k = `${a.nome} · ${a.unidade}`;
    porPessoa[k] = (porPessoa[k] ?? 0) + (a.devido - a.pago);
  });
  console.log("\nquem recebe a diferença:");
  console.table(Object.entries(porPessoa).map(([quem, v]) => ({ quem, falta: Math.round(v * 100) / 100 })));
  console.log("\namostra:");
  console.table(alvo.slice(0, 8).map((a) => ({
    ref: a.ref, comp: a.comp, nome: a.nome,
    devido: a.devido, pago: a.pago,
    completar: Math.round((a.devido - a.pago) * 100) / 100,
    data: String(a.data_original).slice(0, 10),
  })));
  const total = alvo.reduce((s, a) => s + a.devido - a.pago, 0);
  console.log(`\ntotal a lançar: R$ ${total.toFixed(2)}`);

  if (!APLICAR) {
    console.log("\n(simulação — rode com --aplicar para gravar)");
    await pool.end();
    return;
  }

  let n = 0;
  for (const a of alvo) {
    const falta = Math.round((a.devido - a.pago) * 100) / 100;
    if (falta <= 0) continue;
    await q(`
      INSERT INTO fechamento_pagamentos
        (negocio_corretor_id, valor, data_pagamento, observacao, criado_por, recebimento_id)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [a.linha, falta, a.data_original,
       "Complemento da gerência de locação: a baixa saiu com 10% e a regra é 20% (acerto de 07/10/2026)",
       a.criado_por, a.recebimento_id]);
    n++;
  }
  console.log(`\nbaixas complementares lançadas: ${n}`);

  const { rows: sobrou } = await q(`
    SELECT count(*)::int linhas FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
    JOIN fechamento_periodos p ON p.id = n.periodo_id AND p.tipo='locacao'
    WHERE rc.papel='gerencia' AND rc.percentual = 0.20
      AND COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp
                    WHERE fp.negocio_corretor_id = rc.id), 0) BETWEEN 0.01
          AND rc.percentual * n.valor - 0.02
      AND COALESCE((SELECT sum(fr.valor) FROM fechamento_recebimentos fr
                    WHERE fr.negocio_id = n.id), 0) >= n.valor - 0.01`);
  console.log("gerências de locação ainda parciais sem motivo de recebimento:", sobrou[0].linhas);

  // Rede de segurança: ninguém pode ter passado do devido com este acerto.
  const { rows: acima } = await q(`
    SELECT count(*)::int linhas FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id AND NOT n.cancelado
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp
                    WHERE fp.negocio_corretor_id = rc.id), 0)
          > rc.percentual * (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END) + 0.01`);
  console.log("linhas com pagamento acima do devido (tem que ser 0):", acima[0].linhas);

  await pool.end();
})().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
