import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";

export async function GET(req: NextRequest) {
  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);

  const [leads] = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE locacao_venda = 'V') as venda,
      COUNT(*) FILTER (WHERE locacao_venda = 'L') as locacao
    FROM leads WHERE data_inicio >= ${since} AND data_inicio <= ${until}::date + 1`;

  const [propostas] = await sql`
    SELECT COUNT(*) as total FROM propostas
    WHERE data >= ${since} AND data <= ${until}::date + 1`;

  const [conversoes] = await sql`
    SELECT
      COUNT(*) as total,
      COALESCE(SUM(valor), 0) as receita,
      COALESCE(SUM(valor) FILTER (WHERE locacao_venda = 'V'), 0) as receita_venda,
      COALESCE(SUM(valor) FILTER (WHERE locacao_venda = 'L'), 0) as receita_locacao,
      COUNT(*) FILTER (WHERE locacao_venda = 'V') as vendas,
      COUNT(*) FILTER (WHERE locacao_venda = 'L') as locacoes
    FROM conversoes WHERE data_assinatura >= ${since} AND data_assinatura <= ${until}`;

  const [trafego] = await sql`
    SELECT
      COALESCE(SUM(gasto), 0) as investimento,
      COALESCE(SUM(impressoes), 0) as impressoes,
      COALESCE(SUM(cliques), 0) as cliques,
      COALESCE(SUM(leads), 0) as leads_trafego,
      COALESCE(SUM(conversas_iniciadas), 0) as conversas
    FROM meta_insights_diarios WHERE data >= ${since} AND data <= ${until}`;

  const [visitas] = await sql`
    SELECT COUNT(*) as total FROM imovel_visitas
    WHERE data >= ${since} AND data <= ${until}::date + 1`;

  const [metas] = await sql`
    SELECT * FROM metas
    WHERE mes = date_trunc('month', ${since}::date)
    LIMIT 1`;

  const investimento = Number(trafego.investimento);
  const leadsTotal = Number(leads.total);
  const cpl = leadsTotal > 0 ? investimento / leadsTotal : 0;
  const receitaTotal = Number(conversoes.receita);
  const roas = investimento > 0 ? receitaTotal / investimento : 0;

  return NextResponse.json({
    periodo: { since, until },
    leads: {
      total: Number(leads.total),
      venda: Number(leads.venda),
      locacao: Number(leads.locacao),
    },
    propostas: Number(propostas.total),
    conversoes: {
      total: Number(conversoes.total),
      vendas: Number(conversoes.vendas),
      locacoes: Number(conversoes.locacoes),
      receita: receitaTotal,
      receita_venda: Number(conversoes.receita_venda),
      receita_locacao: Number(conversoes.receita_locacao),
    },
    trafego: {
      investimento,
      impressoes: Number(trafego.impressoes),
      cliques: Number(trafego.cliques),
      leads: Number(trafego.leads_trafego),
      conversas: Number(trafego.conversas),
      cpl,
      roas,
    },
    visitas_site: Number(visitas.total),
    metas: metas || null,
  });
}
