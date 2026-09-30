import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rankingPorPapel, rankingUnidades, type FiltroRanking } from "@/lib/ranking";

/**
 * Ranking do fechamento. As categorias são as quatro primeiras pedidas pelo
 * Jonatan em 28/09/2026; o resto vem da diretoria.
 *
 * ESCOPO DE LEITURA: gerente com unidade só vê a própria. Gerente SEM unidade
 * (a Daniela, diretora de vendas) e admin veem a empresa inteira — aqui
 * "unidade nula = todas" é intencional e seguro, ao contrário do que vale no
 * fechamento, porque esta rota não escreve nada. Quem tem vertical fixa fica
 * preso a ela.
 *
 * `gerente_adm` e `contratos` nem chegam: o proxy barra /api/ranking, que não
 * está na lista de rotas desses perfis.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams;
  const admin = session.role === "admin";

  const tipoPedido = q.get("tipo") === "locacao" ? "locacao" : "venda";
  const tipo = !admin && session.tipo ? session.tipo : tipoPedido;

  // Gerente de unidade não escolhe: a unidade dele vale mesmo que mande outra
  // na query. Admin e diretoria escolhem, e vazio significa todas.
  const unidadePedida = q.get("unidade")?.trim() || null;
  const unidade = !admin && session.unidade ? session.unidade : unidadePedida;

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
    // A tela some com o seletor de unidade de quem não escolhe — o gerente de
    // unidade veria uma lista que não muda nada.
    escolheUnidade: admin || !session.unidade,
    escolheTipo: admin || !session.tipo,
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
