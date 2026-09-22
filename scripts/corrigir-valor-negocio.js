// Corrige o VALOR de um negócio do fechamento e traz a comissão junto.
//
//   node scripts/corrigir-valor-negocio.js <id> <valor>            # simula
//   node scripts/corrigir-valor-negocio.js <id> <valor> --aplicar  # grava
//
// Em venda a comissão não é campo independente: é uma taxa sobre o valor, e
// todo o rateio incide sobre ELA. Mudar só o valor deixaria o negócio
// internamente errado e todo mundo recebendo sobre uma venda que não existe.
// A taxa NÃO é fixada em 6% aqui — é lida do próprio negócio (comissão ÷
// valor), pra não achatar um fechamento que tenha sido combinado diferente.
//
// Em locação não há comissão: o valor é a própria prestação de serviço.
//
// Guardas, porque isto mexe em dinheiro de gente:
//   - período precisa estar 'aberto';
//   - nenhum pagamento lançado no negócio (senão o pago fica maior que o
//     devido sem explicação);
//   - imprime o rateio antes e depois, e só grava com --aplicar.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const [, , idArg, valorArg] = process.argv;
const APLICAR = process.argv.includes("--aplicar");
const id = Number(idArg);
// Aceita "708333.33" e "708.333,33". A vírgula é o que decide: com ela, o
// ponto é separador de milhar; sem ela, o ponto é o decimal. Sem esta
// distinção, "708333.33" virava 70.833.333 — a simulação pegou.
const bruto = String(valorArg ?? "").trim();
const valorNovo = Number(bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto);

if (!Number.isFinite(id) || !Number.isFinite(valorNovo) || valorNovo <= 0) {
  console.error("uso: node scripts/corrigir-valor-negocio.js <id> <valor> [--aplicar]");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const brl = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const cli = await pool.connect();
  try {
    const { rows: [n] } = await cli.query(`
      SELECT n.id, n.ref, n.endereco, n.valor, n.comissao,
        p.unidade, p.tipo, p.status, to_char(p.competencia,'YYYY-MM') AS comp
      FROM fechamento_negocios n
      JOIN fechamento_periodos p ON p.id = n.periodo_id
      WHERE n.id = $1`, [id]);
    if (!n) return console.error(`negócio ${id} não existe.`);

    console.log(`Negócio #${n.id} — ${n.unidade} / ${n.tipo} / ${n.comp} (período ${n.status})`);
    console.log(`  ref ${n.ref} · ${n.endereco}`);

    if (n.status !== "aberto") return console.error("\nABORTADO: o período já foi enviado. Reabra antes.");

    const { rows: pagos } = await cli.query(`
      SELECT fp.id, fp.valor, fp.data_pagamento
      FROM fechamento_pagamentos fp
      JOIN fechamento_negocio_corretores rc ON rc.id = fp.negocio_corretor_id
      WHERE rc.negocio_id = $1`, [id]);
    if (pagos.length) {
      console.error(`\nABORTADO: ${pagos.length} pagamento(s) já lançados neste negócio.`);
      console.table(pagos);
      return;
    }

    const valorAtual = Number(n.valor);
    let comissaoNova = null;
    if (n.tipo === "venda") {
      if (!n.comissao || !valorAtual) {
        return console.error("\nABORTADO: venda sem valor ou sem comissão — não dá pra deduzir a taxa.");
      }
      const taxa = Number(n.comissao) / valorAtual;
      comissaoNova = Number((valorNovo * taxa).toFixed(2));
      console.log(`\n  taxa de comissão deste negócio: ${(taxa * 100).toFixed(4)}%`);
      console.log(`  valor    ${brl(valorAtual)}  ->  ${brl(valorNovo)}`);
      console.log(`  comissão ${brl(n.comissao)}  ->  ${brl(comissaoNova)}`);
    } else {
      console.log(`\n  valor (prestação de serviço) ${brl(valorAtual)}  ->  ${brl(valorNovo)}`);
    }

    // O rateio não muda de percentual — muda a base sobre a qual ele incide.
    const poolAtual = n.tipo === "venda" ? Number(n.comissao) : valorAtual;
    const poolNovo = n.tipo === "venda" ? comissaoNova : valorNovo;
    const { rows: rateio } = await cli.query(`
      SELECT rc.papel, rc.percentual,
        COALESCE(NULLIF(TRIM(c.nome_comercial),''), NULLIF(TRIM(c.nome),''), rc.nome_livre) AS nome
      FROM fechamento_negocio_corretores rc
      LEFT JOIN corretores c ON c.id = rc.corretor_id
      WHERE rc.negocio_id = $1 ORDER BY rc.papel, rc.id`, [id]);

    console.log("\n  quem recebe:");
    let somaAntes = 0, somaDepois = 0;
    for (const r of rateio) {
      const antes = Number(r.percentual) * poolAtual;
      const depois = Number(r.percentual) * poolNovo;
      somaAntes += antes; somaDepois += depois;
      console.log(`    ${String(r.papel).padEnd(13)} ${String(r.nome).padEnd(20)} ${brl(antes).padStart(12)} -> ${brl(depois).padStart(12)}`);
    }
    console.log(`    ${"".padEnd(13)} ${"TOTAL".padEnd(20)} ${brl(somaAntes).padStart(12)} -> ${brl(somaDepois).padStart(12)}  (${brl(somaDepois - somaAntes)})`);

    if (!APLICAR) return console.log("\n(simulação — rode com --aplicar pra gravar)");

    await cli.query(
      `UPDATE fechamento_negocios SET valor = $2, comissao = $3, atualizado_em = NOW() WHERE id = $1`,
      [id, valorNovo, comissaoNova]);
    console.log("\nGravado.");
  } finally {
    cli.release();
    await pool.end();
  }
})();
