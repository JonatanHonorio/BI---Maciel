import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { competenciaAtual, calcularStatusPagamento, type Papel } from "@/lib/fechamento";

interface PagamentoRow {
  id: number;
  valor: number;
  data_pagamento: string;
  observacao: string | null;
}

interface RateioRow {
  id: number;
  corretor_id: number;
  nome: string;
  papel: Papel;
  percentual: number | null;
  pagamentos: PagamentoRow[];
}

/** Todos os negócios de todas as unidades/tipos num mês — admin only, base da tela de comissão paga. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const competencia = req.nextUrl.searchParams.get("competencia") || competenciaAtual();
  const sql = getDb();

  const negocios = (await sql`
    SELECT n.id, n.ref, n.endereco, n.valor, n.comissao,
      p.unidade, p.tipo, p.competencia,
      COALESCE(
        json_agg(
          json_build_object(
            'id', rc.id, 'corretor_id', rc.corretor_id, 'nome', cor.nome_comercial,
            'papel', rc.papel, 'percentual', rc.percentual,
            'pagamentos', COALESCE(pg.pagamentos, '[]'::json)
          )
        ) FILTER (WHERE rc.id IS NOT NULL), '[]'
      ) AS rateio
    FROM fechamento_negocios n
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    LEFT JOIN fechamento_negocio_corretores rc ON rc.negocio_id = n.id
    LEFT JOIN corretores cor ON cor.id = rc.corretor_id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'id', fp.id, 'valor', fp.valor, 'data_pagamento', fp.data_pagamento, 'observacao', fp.observacao
      ) ORDER BY fp.data_pagamento) AS pagamentos
      FROM fechamento_pagamentos fp WHERE fp.negocio_corretor_id = rc.id
    ) pg ON true
    WHERE p.competencia = ${competencia}
    GROUP BY n.id, p.unidade, p.tipo, p.competencia
    ORDER BY p.unidade, p.tipo, n.id
  `) as {
    id: number; ref: string | null; endereco: string | null; valor: number | null; comissao: number | null;
    unidade: string; tipo: "venda" | "locacao"; competencia: string; rateio: RateioRow[];
  }[];

  const comNegociosComputados = negocios.map((n) => {
    const pool = n.tipo === "venda" ? n.comissao : n.valor;
    const { rateio, valorDevidoTotal, valorPagoTotal, ficouParaImobiliaria, status } = calcularStatusPagamento(pool, n.rateio);
    return {
      ...n,
      rateio: rateio.map(({ linha, valorDevido, valorPago }) => ({ ...linha, valorDevido, valorPago })),
      valor_devido_total: valorDevidoTotal,
      valor_pago_total: valorPagoTotal,
      ficou_pra_imobiliaria: ficouParaImobiliaria,
      status_pagamento: status,
    };
  });

  return NextResponse.json({ competencia, negocios: comNegociosComputados });
}
