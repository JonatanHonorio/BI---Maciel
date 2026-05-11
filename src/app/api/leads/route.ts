import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseDateRange } from "@/lib/date-utils";

export async function GET(req: NextRequest) {
  const sql = getDb();
  const { since, until } = parseDateRange(req.nextUrl.searchParams);

  const porDia = await sql`
    SELECT data_inicio::date as dia, COUNT(*) as total,
      COUNT(*) FILTER (WHERE locacao_venda = 'V') as venda,
      COUNT(*) FILTER (WHERE locacao_venda = 'L') as locacao
    FROM leads WHERE data_inicio >= ${since} AND data_inicio <= ${until}::date + 1
    GROUP BY dia ORDER BY dia`;

  const porOrigem = await sql`
    SELECT COALESCE(origem_fonte, 'Não informado') as origem, COUNT(*) as total
    FROM leads WHERE data_inicio >= ${since} AND data_inicio <= ${until}::date + 1
    GROUP BY COALESCE(origem_fonte, 'Não informado') ORDER BY total DESC LIMIT 20`;

  const porCorretor = await sql`
    SELECT c.nome as corretor, COUNT(l.*) as total
    FROM leads l
    JOIN corretores c ON c.id = l.corretor_id
    WHERE l.data_inicio >= ${since} AND l.data_inicio <= ${until}::date + 1
    GROUP BY c.nome ORDER BY total DESC LIMIT 20`;

  const porTemperatura = await sql`
    SELECT COALESCE(t.nome, 'Sem temp.') as temperatura, t.cor, COUNT(l.*) as total
    FROM leads l
    LEFT JOIN temperaturas t ON t.id = l.temperatura_id
    WHERE l.data_inicio >= ${since} AND l.data_inicio <= ${until}::date + 1
    GROUP BY t.nome, t.cor ORDER BY total DESC`;

  const porTipo = await sql`
    SELECT COALESCE(locacao_venda, 'N/A') as tipo, COUNT(*) as total
    FROM leads WHERE data_inicio >= ${since} AND data_inicio <= ${until}::date + 1
    GROUP BY COALESCE(locacao_venda, 'N/A')`;

  const porBairro = await sql`
    SELECT COALESCE(bairros, 'Não informado') as bairro, COUNT(*) as total
    FROM leads WHERE data_inicio >= ${since} AND data_inicio <= ${until}::date + 1
    GROUP BY COALESCE(bairros, 'Não informado') ORDER BY total DESC LIMIT 15`;

  return NextResponse.json({
    por_dia: porDia,
    por_origem: porOrigem,
    por_corretor: porCorretor,
    por_temperatura: porTemperatura,
    por_tipo: porTipo,
    por_bairro: porBairro,
  });
}
