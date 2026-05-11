import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";

export async function GET(req: NextRequest) {
  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);

  const maisVisitados = await sql`
    SELECT i.id, i.codigo, i.titulo, i.tipo_imovel, i.bairro, i.cidade,
      i.valor, i.locacao_venda, i.dormitorios, COUNT(v.*) as visitas
    FROM imovel_visitas v
    JOIN imoveis i ON i.id = v.imovel_id
    WHERE v.data >= ${since} AND v.data <= ${until}::date + 1
    GROUP BY i.id ORDER BY visitas DESC LIMIT 20`;

  const porTipo = await sql`
    SELECT COALESCE(tipo_imovel, 'Outros') as tipo, COUNT(*) as total,
      AVG(valor) as valor_medio
    FROM imoveis WHERE valor > 0
    GROUP BY COALESCE(tipo_imovel, 'Outros') ORDER BY total DESC LIMIT 15`;

  const porBairro = await sql`
    SELECT COALESCE(bairro, 'N/A') as bairro, COUNT(*) as total,
      AVG(valor) FILTER (WHERE locacao_venda IN ('V', 'VE', 'LV', 'LVE')) as valor_medio_venda,
      AVG(valor) FILTER (WHERE locacao_venda IN ('L', 'LE', 'LV', 'LVE')) as valor_medio_locacao
    FROM imoveis WHERE valor > 0
    GROUP BY COALESCE(bairro, 'N/A') ORDER BY total DESC LIMIT 20`;

  const estoque = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE locacao_venda IN ('V', 'VE', 'LV', 'LVE')) as venda,
      COUNT(*) FILTER (WHERE locacao_venda IN ('L', 'LE', 'LV', 'LVE')) as locacao,
      AVG(valor) FILTER (WHERE valor > 0) as valor_medio
    FROM imoveis`;

  const visitasPorDia = await sql`
    SELECT data::date as dia, COUNT(*) as total
    FROM imovel_visitas
    WHERE data >= ${since} AND data <= ${until}::date + 1
    GROUP BY dia ORDER BY dia`;

  return NextResponse.json({
    mais_visitados: maisVisitados,
    por_tipo: porTipo,
    por_bairro: porBairro,
    estoque: estoque[0],
    visitas_por_dia: visitasPorDia,
  });
}
