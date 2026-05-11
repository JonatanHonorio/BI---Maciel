import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";

export async function GET(req: NextRequest) {
  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);

  const resumo = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE locacao_venda = 'V') as vendas,
      COUNT(*) FILTER (WHERE locacao_venda = 'L') as locacoes,
      COALESCE(SUM(valor), 0) as receita_total,
      COALESCE(SUM(valor) FILTER (WHERE locacao_venda = 'V'), 0) as receita_venda,
      COALESCE(SUM(valor) FILTER (WHERE locacao_venda = 'L'), 0) as receita_locacao,
      COALESCE(AVG(valor) FILTER (WHERE valor > 0), 0) as ticket_medio
    FROM conversoes
    WHERE data_assinatura >= ${since} AND data_assinatura <= ${until}`;

  const porDia = await sql`
    SELECT data_assinatura as dia, COUNT(*) as total,
      COALESCE(SUM(valor), 0) as receita
    FROM conversoes
    WHERE data_assinatura >= ${since} AND data_assinatura <= ${until}
    GROUP BY dia ORDER BY dia`;

  const porMidia = await sql`
    SELECT COALESCE(m.nome, 'Não informado') as midia, COUNT(c.*) as total,
      COALESCE(SUM(c.valor), 0) as receita
    FROM conversoes c
    LEFT JOIN midias m ON m.id = c.midia_id
    WHERE c.data_assinatura >= ${since} AND c.data_assinatura <= ${until}
    GROUP BY m.nome ORDER BY total DESC`;

  const porFinalidade = await sql`
    SELECT COALESCE(finalidade, 'N/A') as finalidade, COUNT(*) as total,
      COALESCE(SUM(valor), 0) as receita
    FROM conversoes
    WHERE data_assinatura >= ${since} AND data_assinatura <= ${until}
    GROUP BY COALESCE(finalidade, 'N/A')`;

  const receitaAcumulada = await sql`
    SELECT data_assinatura as dia,
      SUM(SUM(valor)) OVER (ORDER BY data_assinatura) as acumulado
    FROM conversoes
    WHERE data_assinatura >= ${since} AND data_assinatura <= ${until}
    GROUP BY dia ORDER BY dia`;

  return NextResponse.json({
    resumo: resumo[0],
    por_dia: porDia,
    por_midia: porMidia,
    por_finalidade: porFinalidade,
    receita_acumulada: receitaAcumulada,
  });
}
