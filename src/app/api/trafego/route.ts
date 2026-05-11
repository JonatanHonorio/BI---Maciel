import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";

export async function GET(req: NextRequest) {
  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);

  // Visão geral
  const resumo = await sql`
    SELECT
      COALESCE(SUM(gasto), 0) as investimento,
      COALESCE(SUM(impressoes), 0) as impressoes,
      COALESCE(SUM(cliques), 0) as cliques,
      COALESCE(SUM(alcance), 0) as alcance,
      COALESCE(SUM(leads), 0) as leads,
      COALESCE(SUM(conversas_iniciadas), 0) as conversas,
      COALESCE(SUM(link_clicks), 0) as link_clicks,
      COALESCE(SUM(video_views), 0) as video_views,
      COALESCE(SUM(landing_page_views), 0) as lp_views,
      CASE WHEN SUM(impressoes) > 0 THEN SUM(gasto) / SUM(impressoes) * 1000 ELSE 0 END as cpm,
      CASE WHEN SUM(cliques) > 0 THEN SUM(gasto) / SUM(cliques) ELSE 0 END as cpc,
      CASE WHEN SUM(impressoes) > 0 THEN SUM(cliques)::numeric / SUM(impressoes) * 100 ELSE 0 END as ctr,
      CASE WHEN SUM(leads) > 0 THEN SUM(gasto) / SUM(leads) ELSE 0 END as cpl
    FROM meta_insights_diarios
    WHERE data >= ${since} AND data <= ${until}`;

  // Investimento total para calcular % invest
  const totalInvest = Number(resumo[0]?.investimento || 0);

  // Performance por campanha
  const porCampanha = await sql`
    SELECT mc.nome as campanha, mc.status, mc.objetivo,
      COALESCE(SUM(i.gasto), 0) as investimento,
      COALESCE(SUM(i.impressoes), 0) as impressoes,
      COALESCE(SUM(i.cliques), 0) as cliques,
      COALESCE(SUM(i.leads), 0) as leads,
      COALESCE(SUM(i.conversas_iniciadas), 0) as conversas,
      COALESCE(SUM(i.link_clicks), 0) as link_clicks,
      COALESCE(SUM(i.landing_page_views), 0) as lp_views,
      CASE WHEN SUM(i.impressoes) > 0 THEN SUM(i.cliques)::numeric / SUM(i.impressoes) * 100 ELSE 0 END as ctr,
      CASE WHEN SUM(i.cliques) > 0 THEN SUM(i.gasto) / SUM(i.cliques) ELSE 0 END as cpc,
      CASE WHEN SUM(i.leads) > 0 THEN SUM(i.gasto) / SUM(i.leads) ELSE 0 END as cpl
    FROM meta_campanhas mc
    LEFT JOIN meta_insights_diarios i ON i.campanha_id = mc.id
      AND i.data >= ${since} AND i.data <= ${until}
    GROUP BY mc.id, mc.nome, mc.status, mc.objetivo
    HAVING SUM(i.gasto) > 0
    ORDER BY investimento DESC`;

  // Performance por criativo (anúncio)
  const porCriativo = await sql`
    SELECT a.nome as criativo, a.tipo_criativo, a.thumbnail_url,
      COALESCE(SUM(ai.gasto), 0) as investimento,
      COALESCE(SUM(ai.impressoes), 0) as impressoes,
      COALESCE(SUM(ai.cliques), 0) as cliques,
      COALESCE(SUM(ai.leads), 0) as leads,
      COALESCE(SUM(ai.conversas_iniciadas), 0) as conversas,
      COALESCE(SUM(ai.link_clicks), 0) as link_clicks,
      COALESCE(SUM(ai.landing_page_views), 0) as lp_views,
      COALESCE(SUM(ai.video_views), 0) as video_views,
      COALESCE(SUM(ai.video_p25), 0) as video_p25,
      COALESCE(SUM(ai.video_p50), 0) as video_p50,
      COALESCE(SUM(ai.video_p75), 0) as video_p75,
      COALESCE(SUM(ai.video_p100), 0) as video_p100,
      CASE WHEN SUM(ai.impressoes) > 0 THEN SUM(ai.cliques)::numeric / SUM(ai.impressoes) * 100 ELSE 0 END as ctr,
      CASE WHEN SUM(ai.leads) > 0 THEN SUM(ai.gasto) / SUM(ai.leads) ELSE 0 END as cpl,
      CASE WHEN SUM(ai.cliques) > 0 THEN SUM(ai.landing_page_views)::numeric / SUM(ai.cliques) * 100 ELSE 0 END as connect_rate
    FROM meta_anuncios a
    LEFT JOIN meta_anuncio_insights ai ON ai.anuncio_id = a.id
      AND ai.data >= ${since} AND ai.data <= ${until}
    GROUP BY a.id, a.nome, a.tipo_criativo, a.thumbnail_url
    HAVING SUM(ai.gasto) > 0
    ORDER BY investimento DESC`;

  // Gasto por dia
  const porDia = await sql`
    SELECT data as dia, SUM(gasto) as gasto, SUM(impressoes) as impressoes,
      SUM(cliques) as cliques, SUM(leads) as leads, SUM(conversas_iniciadas) as conversas
    FROM meta_insights_diarios
    WHERE data >= ${since} AND data <= ${until}
    GROUP BY dia ORDER BY dia`;

  // Gasto acumulado
  const gastoAcumulado = await sql`
    SELECT data as dia,
      SUM(SUM(gasto)) OVER (ORDER BY data) as acumulado
    FROM meta_insights_diarios
    WHERE data >= ${since} AND data <= ${until}
    GROUP BY dia ORDER BY dia`;

  return NextResponse.json({
    resumo: resumo[0],
    total_invest: totalInvest,
    por_campanha: porCampanha,
    por_criativo: porCriativo,
    por_dia: porDia,
    gasto_acumulado: gastoAcumulado,
  });
}
