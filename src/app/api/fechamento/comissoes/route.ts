import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { competenciaAtual } from "@/lib/fechamento";

interface Rateio { corretor_id: number; nome: string; papel: "levantamento" | "fechamento"; percentual: number | null }

/** Todos os negócios de todas as unidades/tipos num mês — admin only, base da tela de comissão paga. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const competencia = req.nextUrl.searchParams.get("competencia") || competenciaAtual();
  const sql = getDb();

  const negocios = await sql`
    SELECT n.id, n.ref, n.endereco, n.valor, n.comissao, n.comissao_paga, n.comissao_paga_em,
      p.unidade, p.tipo, p.competencia,
      COALESCE(
        json_agg(
          json_build_object('corretor_id', rc.corretor_id, 'nome', cor.nome_comercial,
            'papel', rc.papel, 'percentual', rc.percentual)
        ) FILTER (WHERE rc.id IS NOT NULL), '[]'
      ) AS rateio
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    LEFT JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
    LEFT JOIN corretores cor ON cor.id = rc.corretor_id
    WHERE p.competencia = ${competencia}
    GROUP BY n.id, p.unidade, p.tipo, p.competencia
    ORDER BY p.unidade, p.tipo, n.id
  `;

  return NextResponse.json({ competencia, negocios: negocios as (typeof negocios[number] & { rateio: Rateio[] })[] });
}
