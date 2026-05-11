import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";

export async function GET(req: NextRequest) {
  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);

  const ranking = await sql`
    SELECT
      c.id, c.nome, c.nome_comercial,
      COALESCE(l.leads, 0) as leads,
      COALESCE(p.propostas, 0) as propostas,
      COALESCE(cv.conversoes, 0) as conversoes,
      COALESCE(cv.receita, 0) as receita,
      CASE WHEN COALESCE(l.leads, 0) > 0
        THEN ROUND(COALESCE(cv.conversoes, 0)::numeric / l.leads * 100, 1)
        ELSE 0 END as taxa_conversao
    FROM corretores c
    LEFT JOIN (
      SELECT corretor_id, COUNT(*) as leads
      FROM leads WHERE data_inicio >= ${since} AND data_inicio <= ${until}::date + 1
      GROUP BY corretor_id
    ) l ON l.corretor_id = c.id
    LEFT JOIN (
      SELECT corretor_id, COUNT(*) as propostas
      FROM propostas WHERE data >= ${since} AND data <= ${until}::date + 1
      GROUP BY corretor_id
    ) p ON p.corretor_id = c.id
    LEFT JOIN (
      SELECT ca.corretor_id, COUNT(DISTINCT ca.conversao_id) as conversoes,
        SUM(co.valor * ca.percentual / 100) as receita
      FROM conversao_corretores ca
      JOIN conversoes co ON co.id = ca.conversao_id
      WHERE co.data_assinatura >= ${since} AND co.data_assinatura <= ${until}
      GROUP BY ca.corretor_id
    ) cv ON cv.corretor_id = c.id
    WHERE c.ativo = 1 AND (COALESCE(l.leads, 0) > 0 OR COALESCE(cv.conversoes, 0) > 0)
    ORDER BY conversoes DESC, leads DESC`;

  const tempoResposta = await sql`
    SELECT c.nome,
      AVG(la.tempo_retorno) FILTER (WHERE la.tempo_retorno > 0) as tempo_medio_min
    FROM lead_atividades la
    JOIN corretores c ON c.id = la.corretor_id
    WHERE la.data >= ${since} AND la.data <= ${until}::date + 1
    GROUP BY c.nome
    HAVING AVG(la.tempo_retorno) FILTER (WHERE la.tempo_retorno > 0) IS NOT NULL
    ORDER BY tempo_medio_min ASC LIMIT 20`;

  return NextResponse.json({
    ranking,
    tempo_resposta: tempoResposta,
  });
}
