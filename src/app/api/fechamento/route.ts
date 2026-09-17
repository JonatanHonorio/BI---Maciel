import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { competenciaAtual, UNIDADES_FECHAMENTO } from "@/lib/fechamento";
import type { Tipo } from "@/lib/unidade";

/**
 * Período do mês corrente (ou o pedido) da própria unidade+tipo do gerente.
 * Admin (unidade/tipo nulos na sessão) precisa passar ?unidade=&tipo= —
 * é o único jeito de escolher qual unidade lançar/ver (inclusive Diretoria
 * e Lançamento, que não têm gerente próprio).
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isAdmin = session.role === "admin";
  const unidade = isAdmin ? req.nextUrl.searchParams.get("unidade") : session.unidade;
  const tipo = (isAdmin ? req.nextUrl.searchParams.get("tipo") : session.tipo) as Tipo | null;
  const competencia = req.nextUrl.searchParams.get("competencia") || competenciaAtual();

  const sessaoInfo = { role: session.role, unidade: session.unidade, tipo: session.tipo, nome: session.nome };

  // Admin sem unidade/tipo escolhidos ainda: devolve só as opções pro seletor,
  // sem tentar abrir um período (não sabe qual).
  if (!unidade || !tipo) {
    if (isAdmin) {
      return NextResponse.json({ session: sessaoInfo, unidades: UNIDADES_FECHAMENTO, periodo: null, negocios: [] });
    }
    return NextResponse.json({ error: "unidade e tipo são obrigatórios" }, { status: 400 });
  }

  const sql = getDb();

  const [periodo] = await sql`
    INSERT INTO fechamento_periodos (competencia, unidade, tipo)
    VALUES (${competencia}, ${unidade}, ${tipo})
    ON CONFLICT (competencia, unidade, tipo) DO UPDATE SET competencia = EXCLUDED.competencia
    RETURNING id, competencia, unidade, tipo, status, enviado_por, enviado_em
  `;

  const negocios = await sql`
    SELECT n.id, n.data_contrato, n.ref, n.contrato, n.endereco, n.origem,
      n.valor, n.comissao, n.pagamento, n.observacao,
      n.comissao_paga, n.comissao_paga_em,
      COALESCE(
        json_agg(
          json_build_object(
            'corretor_id', rc.corretor_id, 'nome', cor.nome_comercial,
            'papel', rc.papel, 'percentual', rc.percentual
          )
        ) FILTER (WHERE rc.id IS NOT NULL), '[]'
      ) AS rateio
    FROM fechamento_negocios n
    LEFT JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
    LEFT JOIN corretores cor ON cor.id = rc.corretor_id
    WHERE n.periodo_id = ${periodo.id}
    GROUP BY n.id
    ORDER BY n.id
  `;

  return NextResponse.json({ session: sessaoInfo, unidades: UNIDADES_FECHAMENTO, periodo, negocios });
}
