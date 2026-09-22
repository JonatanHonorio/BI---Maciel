// Ajusta as vendas do Residencial Parque Floresta às regras próprias daquele
// lançamento (pedido do Jonatan em 22/09/2026):
//
//   1. Captação pagou 5% da comissão, e não os 10% de tabela — 2,5% pra
//      Fabiana Oliveira e 2,5% pra Suely Andrade.
//   2. Sirley recebe 10% da comissão como LANÇAMENTO, na feature nova (bloco
//      de pessoas), e não mais como a rubrica fixa de 5% que existia antes.
//
// Escopo: negócios de VENDA cuja competência é dez/2025 ou posterior e cujo
// endereço é do Loteamento Floresta (ref 58298). São 39 em dez/2025, em
// quatro unidades — Urbanova, Diretoria, Lançamento e Esplanada.
//
// Roda SEM argumento pra simular. `--aplicar` grava.
//
// Idempotente: reescreve as linhas de levantamento e lançamento desses
// negócios pro estado final, então rodar duas vezes dá o mesmo resultado.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const APLICAR = process.argv.includes("--aplicar");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Cada destinatario e mantido COMO JA ESTA GRAVADO hoje, porque trocar a
// forma de identificar a pessoa parte o relatorio de pagamento em dois:
//
//   Suely Andrade  -> corretor 170, que esta em scripts/corretores_fechamento.json
//                     e e como as 39 linhas ja estao gravadas hoje.
//   Fabiana Oliveira / Sirley -> nome digitado. As duas existem em `corretores`
//                     (347 e 853) mas NAO na lista que alimenta o seletor, e a
//                     Sirley ja aparece como "Sirley" digitado no fechamento e
//                     na gerencia destes mesmos negocios.
//
// De quebra isto conserta "Fabiano Oliveira", digitado uma vez no lugar de
// "Fabiana" - no relatorio de pagamento, a grafia errada virava outra pessoa.
const CAPTACAO = [
  { corretor_id: null, nome: "Fabiana Oliveira", percentual: 0.025 },
  { corretor_id: 170, nome: "Suely Andrade", percentual: 0.025 },
];
const LANCAMENTO = [{ corretor_id: null, nome: "Sirley", percentual: 0.10 }];

(async () => {
  const cli = await pool.connect();
  try {
    const { rows: negocios } = await cli.query(`
      SELECT n.id, n.ref, n.comissao, p.unidade, to_char(p.competencia,'YYYY-MM') AS comp
      FROM fechamento_negocios n
      JOIN fechamento_periodos p ON p.id = n.periodo_id
      WHERE p.tipo = 'venda'
        AND p.competencia >= DATE '2025-12-01'
        AND n.endereco ILIKE '%floresta%'
      ORDER BY p.competencia, n.id
    `);
    const ids = negocios.map((n) => n.id);
    console.log(`Vendas do Floresta encontradas: ${negocios.length}`);
    if (!ids.length) return;

    // Guarda de segurança: um pagamento já lançado significa que alguém
    // recebeu com o percentual antigo, e mexer no percentual calado deixaria
    // o "pago" maior que o "devido" sem explicação.
    const { rows: pagos } = await cli.query(`
      SELECT rc.negocio_id, rc.papel, rc.nome_livre, fp.valor
      FROM fechamento_pagamentos fp
      JOIN fechamento_negocio_corretores rc ON rc.id = fp.negocio_corretor_id
      WHERE rc.negocio_id = ANY($1::int[]) AND rc.papel IN ('levantamento','lancamento')
    `, [ids]);
    if (pagos.length) {
      console.error(`\nABORTADO: ${pagos.length} pagamento(s) já lançados em linhas que este script reescreve.`);
      console.table(pagos);
      return;
    }

    const { rows: antes } = await cli.query(`
      SELECT negocio_id, papel, nome_livre, corretor_id, percentual
      FROM fechamento_negocio_corretores
      WHERE negocio_id = ANY($1::int[]) AND papel IN ('levantamento','lancamento')
      ORDER BY negocio_id, papel
    `, [ids]);

    console.log("\nO que existe hoje nessas duas funções:");
    const resumo = new Map();
    for (const r of antes) {
      const k = `${r.papel} | ${r.nome_livre ?? `corretor ${r.corretor_id}`} | ${(Number(r.percentual) * 100).toFixed(2)}%`;
      resumo.set(k, (resumo.get(k) || 0) + 1);
    }
    [...resumo.entries()].sort().forEach(([k, v]) => console.log(`  ${String(v).padStart(3)}x  ${k}`));

    console.log("\nComo vai ficar, em cada um dos negócios:");
    for (const l of [...CAPTACAO, ...LANCAMENTO]) {
      const como = l.corretor_id ? `corretor ${l.corretor_id}` : "nome digitado";
      console.log(`  ${l.nome} - ${(l.percentual * 100).toFixed(2)}%  (${como})`);
    }

    // Conferência: o rateio inteiro de cada negócio depois da troca. Passar de
    // 100% da comissão é erro, e é melhor ver antes de gravar.
    const { rows: outros } = await cli.query(`
      SELECT negocio_id, SUM(percentual) AS pct
      FROM fechamento_negocio_corretores
      WHERE negocio_id = ANY($1::int[]) AND papel NOT IN ('levantamento','lancamento')
      GROUP BY negocio_id
    `, [ids]);
    const porNegocio = new Map(outros.map((r) => [r.negocio_id, Number(r.pct)]));
    const novoBloco = [...CAPTACAO, ...LANCAMENTO].reduce((s, l) => s + l.percentual, 0);
    let estourou = 0;
    const totais = new Map();
    for (const n of negocios) {
      const total = (porNegocio.get(n.id) || 0) + novoBloco;
      totais.set(total.toFixed(4), (totais.get(total.toFixed(4)) || 0) + 1);
      if (total > 1.0000001) { estourou++; console.error(`  !! negócio ${n.id} passa de 100%: ${(total * 100).toFixed(2)}%`); }
    }
    console.log("\nTotal distribuído por negócio depois do ajuste:");
    [...totais.entries()].sort().forEach(([t, v]) => console.log(`  ${String(v).padStart(3)} negócio(s) — ${(Number(t) * 100).toFixed(2)}%`));
    if (estourou) { console.error("\nABORTADO: algum negócio passaria de 100% da comissão."); return; }

    const soma = negocios.reduce((s, n) => s + Number(n.comissao || 0), 0);
    console.log(`\nComissão somada dos ${negocios.length} negócios: R$ ${soma.toFixed(2)}`);
    console.log(`  captação passa de R$ ${(soma * 0.10).toFixed(2)} para R$ ${(soma * 0.05).toFixed(2)}`);
    console.log(`  Sirley (lançamento) recebe R$ ${(soma * 0.10).toFixed(2)}`);

    if (!APLICAR) { console.log("\n(simulação — rode com --aplicar pra gravar)"); return; }

    await cli.query("BEGIN");
    await cli.query(
      `DELETE FROM fechamento_negocio_corretores
       WHERE negocio_id = ANY($1::int[]) AND papel IN ('levantamento','lancamento')`, [ids]);
    for (const id of ids) {
      for (const [papel, linhas] of [["levantamento", CAPTACAO], ["lancamento", LANCAMENTO]]) {
        for (const l of linhas) {
          await cli.query(
            `INSERT INTO fechamento_negocio_corretores (negocio_id, papel, corretor_id, nome_livre, percentual)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, papel, l.corretor_id, l.corretor_id ? null : l.nome, l.percentual]);
        }
      }
    }
    await cli.query(
      `UPDATE fechamento_negocios SET atualizado_em = NOW() WHERE id = ANY($1::int[])`, [ids]);
    await cli.query("COMMIT");
    console.log(`\nGravado: ${ids.length * 3} linhas em ${ids.length} negócios.`);
  } catch (e) {
    await cli.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    cli.release();
    await pool.end();
  }
})();
