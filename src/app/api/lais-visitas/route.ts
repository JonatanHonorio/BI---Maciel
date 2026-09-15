import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";
import { getSession } from "@/lib/auth";
import { corretoresDaUnidade } from "@/lib/unidade";

export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);
  const corretorIds = await corretoresDaUnidade(sql, session.unidade, session.tipo);
  const escopo = sql`(${corretorIds}::int[] IS NULL OR corretor_id = ANY(${corretorIds}::int[]))`;

  const resumo = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(corretor_nome) as com_corretor,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Venda') as vendas,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Aluguel') as alugueis
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}`;

  const visitas = await sql`
    SELECT id, nome, email, tipo_transacao, origem, data_visita,
      localizacao, corretor_nome, referencia_imovel, match_method
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    ORDER BY data_visita DESC`;

  const porCorretor = await sql`
    SELECT COALESCE(corretor_nome, 'Não identificado') as corretor,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Venda') as vendas,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Aluguel') as alugueis
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    GROUP BY COALESCE(corretor_nome, 'Não identificado')
    ORDER BY total DESC`;

  const porMes = await sql`
    SELECT TO_CHAR(data_visita, 'YYYY-MM') as mes,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Venda') as vendas,
      COUNT(*) FILTER (WHERE tipo_transacao = 'Aluguel') as alugueis
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    GROUP BY TO_CHAR(data_visita, 'YYYY-MM')
    ORDER BY mes`;

  const porOrigem = await sql`
    SELECT COALESCE(origem, 'Não informado') as origem, COUNT(*) as total
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    GROUP BY COALESCE(origem, 'Não informado')
    ORDER BY total DESC`;

  const porDia = await sql`
    SELECT data_visita::date as dia, COUNT(*) as total
    FROM lais_visitas
    WHERE data_visita >= ${since} AND data_visita <= ${until}::date + 1 AND ${escopo}
    GROUP BY data_visita::date
    ORDER BY dia`;

  return NextResponse.json({
    resumo: resumo[0],
    visitas,
    por_corretor: porCorretor,
    por_mes: porMes,
    por_origem: porOrigem,
    por_dia: porDia,
  });
}
