import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeVerRanking } from "@/lib/permissoes";
import { rankingPorPapel, rankingUnidades, type FiltroRanking } from "@/lib/ranking";

/**
 * Ranking do fechamento. As categorias são as quatro primeiras pedidas pelo
 * Jonatan em 28/09/2026; o resto vem da diretoria.
 *
 * QUEM VÊ: a diretoria e a Suzana (os `admin`), mais quem tenha a permissão
 * avulsa `ranking` — hoje só a Daniela, diretora de vendas. Gerente não vê
 * nem o ranking da própria unidade: o ranking compara pessoa com pessoa e
 * unidade com unidade, e isso é conversa da diretoria.
 *
 * O proxy já barra pela lista ROTAS_DIRETORIA; a checagem aqui é a segunda
 * tranca, para a rota não depender só do middleware.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  if (!podeVerRanking(session)) {
    return NextResponse.json({ error: "sem acesso" }, { status: 403 });
  }

  const q = req.nextUrl.searchParams;
  const tipo = q.get("tipo") === "locacao" ? "locacao" : "venda";
  // Unidade vazia = todas.
  const unidade = q.get("unidade")?.trim() || null;

  const sql = getDb();

  // A faixa padrão é tudo o que existe lançado — o primeiro uso é a diretoria
  // olhando o ano inteiro, não o mês.
  const [faixa] = (await sql`
    SELECT to_char(min(competencia), 'YYYY-MM-DD') AS primeira,
           to_char(max(competencia), 'YYYY-MM-DD') AS ultima
    FROM fechamento_periodos p
    WHERE EXISTS (SELECT 1 FROM fechamento_negocios n WHERE n.periodo_id = p.id AND NOT n.cancelado)
  `) as { primeira: string | null; ultima: string | null }[];

  const competencia = /^\d{4}-\d{2}-01$/;
  const de = competencia.test(q.get("de") || "") ? q.get("de")! : faixa.primeira ?? "2025-12-01";
  const ate = competencia.test(q.get("ate") || "") ? q.get("ate")! : faixa.ultima ?? de;

  const filtro: FiltroRanking = { de, ate, unidade, tipo };

  const [vendedores, captadores, unidades] = await Promise.all([
    rankingPorPapel(sql, "fechamento", filtro),
    rankingPorPapel(sql, "levantamento", filtro),
    rankingUnidades(sql, filtro),
  ]);

  const opcoes = (await sql`
    SELECT DISTINCT unidade FROM fechamento_periodos ORDER BY unidade
  `) as { unidade: string }[];

  return NextResponse.json({
    filtro,
    faixa,
    unidades: opcoes.map((u) => u.unidade),
    vendedores,
    captadores,
    porUnidade: unidades,
    totais: {
      negocios: unidades.reduce((s, u) => s + u.negocios, 0),
      vgv: unidades.reduce((s, u) => s + u.vgv, 0),
    },
  });
}
