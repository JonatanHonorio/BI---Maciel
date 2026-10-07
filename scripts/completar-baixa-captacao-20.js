#!/usr/bin/env node
/**
 * Completa as baixas de CAPTAÇÃO que ficaram no percentual antigo (07/10/2026).
 *
 * Irmão do `completar-baixa-gerencia-locacao.js`, mesma história e mesma data
 * de origem: as adms lançaram os recebimentos retroativos em 30/09, o BI
 * distribuiu a comissão sozinho com os percentuais daquele momento, e nos dias
 * 01 e 02/10 as regras da captação foram corrigidas para cima —
 * `captacao-20-mauro-girotto.js` (captador de 20% captando sozinho) e
 * `rateio-oito-pendentes.js` (captação dividida: 10% para o de 20%, 5% para o
 * outro). A baixa continuou valendo o percentual velho e os negócios viraram
 * "Parcial" sem culpa de ninguém.
 *
 * O Jonatan confirmou em 07/10/2026 que **a Maciel pagou os 20% a eles
 * também** — o repasse saiu pelo valor certo e só o registro ficou a menos.
 * Como no caso do Wellington, isto termina de anotar um pagamento que
 * aconteceu, não cria um.
 *
 * São 5 linhas, R$ 4.564,00, do Girotto (207) e do Mauro (209). Duas delas
 * estão a 10% e não a 20%: são as de captação DIVIDIDA, em que a regra da
 * Tatiane dá 10% ao captador de 20% e 5% ao outro — ali o percentual também
 * subiu (de 5% para 10%), que é o que importa aqui.
 *
 * O filtro é o mesmo do script irmão, e a condição que o torna seguro é "o
 * negócio já foi 100% recebido do cliente": sem ela, um Parcial legítimo —
 * cliente que ainda não pagou — seria quitado à força.
 *
 * A diferença entra com a DATA DA BAIXA ORIGINAL: o dinheiro saiu lá atrás.
 *
 * Uso: node scripts/completar-baixa-captacao-20.js [--aplicar]
 * Sem --aplicar, só mostra. Idempotente.
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const APLICAR = process.argv.includes("--aplicar");
const CORTE = "2026-10-01";
/** Mauro Souza, José Rafael Girotto, Dimas Barbosa — ver CAPTADORES_20 em @/lib/comissao. */
const CAPTADORES_20 = [209, 207, 174];

const q = async (sql, params) => {
  for (let i = 0; i < 5; i++) {
    try { return await pool.query(sql, params); }
    catch (e) { if (i === 4) throw e; await new Promise((r) => setTimeout(r, 1200)); }
  }
};

(async () => {
  const { rows } = await q(`
    SELECT rc.id AS linha, rc.corretor_id, n.ref, p.unidade, p.tipo,
           to_char(p.competencia,'MM/YYYY') comp,
           COALESCE(NULLIF(TRIM(k.nome_comercial),''), NULLIF(TRIM(k.nome),''), rc.nome_livre) AS nome,
           (rc.percentual*100)::float pct,
           (rc.percentual * (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END))::float devido,
           COALESCE((SELECT sum(fp.valor) FROM fechamento_pagamentos fp
                     WHERE fp.negocio_corretor_id = rc.id), 0)::float pago,
           (CASE WHEN p.tipo='venda' THEN n.comissao ELSE n.valor END)::float pool,
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
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    LEFT JOIN corretores k ON k.id = rc.corretor_id
    WHERE rc.papel = 'levantamento'
    ORDER BY p.competencia, n.ref`);

  const alvo = rows.filter((r) =>
    r.pago > 0 &&
    r.pago < r.devido - 0.01 &&
    r.primeira_baixa && new Date(r.primeira_baixa) < new Date(CORTE) &&
    r.recebido >= r.pool - 0.01
  );

  /*
   * Trava de escopo: este acerto é SÓ dos captadores de 20%. Se um dia o filtro
   * pegar outra pessoa, é porque a causa é outra — e aí o certo é olhar, não
   * completar a baixa dela junto.
   */
  const forasteiros = alvo.filter((a) => !CAPTADORES_20.includes(Number(a.corretor_id)));
  if (forasteiros.length) {
    console.error("linhas fora do escopo (não são captadores de 20%):");
    console.table(forasteiros.map((f) => ({ linha: f.linha, nome: f.nome, ref: f.ref })));
    throw new Error("o filtro pegou gente que este acerto não cobre — confira antes de rodar");
  }

  console.log(`linhas de captação a completar: ${alvo.length}`);
  console.table(alvo.map((a) => ({
    ref: a.ref, unidade: a.unidade, tipo: a.tipo, comp: a.comp, nome: a.nome,
    pct: a.pct, devido: a.devido, pago: a.pago,
    completar: Math.round((a.devido - a.pago) * 100) / 100,
    data: String(a.data_original).slice(0, 10),
  })));
  const total = alvo.reduce((s, a) => s + a.devido - a.pago, 0);
  console.log(`total a lançar: R$ ${total.toFixed(2)}`);

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
       "Complemento da captação: a baixa saiu no percentual antigo e a regra do captador de 20% é maior (acerto de 07/10/2026)",
       a.criado_por, a.recebimento_id]);
    n++;
  }
  console.log(`\nbaixas complementares lançadas: ${n}`);

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
