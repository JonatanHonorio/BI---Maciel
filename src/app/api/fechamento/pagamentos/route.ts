import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeLancarComissao, podeAcessarPeriodo } from "@/lib/permissoes";

interface PagamentoInput {
  negocio_corretor_id: number;
  valor: number;
  data_pagamento: string;
  observacao: string | null;
}

/**
 * Registra um pagamento (parcial ou total) pra um destinatário do rateio —
 * admin ou gerente administrativa, e só dentro das unidades dela. Um negócio
 * pode ter vários pagamentos ao longo do tempo pro mesmo destinatário.
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session || !podeLancarComissao(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as PagamentoInput;
  if (!body.negocio_corretor_id || !body.valor || body.valor <= 0 || !body.data_pagamento) {
    return NextResponse.json({ error: "negocio_corretor_id, valor (>0) e data_pagamento são obrigatórios" }, { status: 400 });
  }

  const sql = getDb();
  // Sobe até o período pra saber de qual unidade é este pagamento.
  const [destino] = await sql`
    SELECT p.unidade, p.tipo
    FROM fechamento_negocio_corretores rc
    JOIN fechamento_negocios n ON n.id = rc.negocio_id
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE rc.id = ${body.negocio_corretor_id}
  `;
  if (!destino) return NextResponse.json({ error: "destinatário do rateio não encontrado" }, { status: 404 });
  if (!podeAcessarPeriodo(session, destino)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  const [pagamento] = await sql`
    INSERT INTO fechamento_pagamentos (negocio_corretor_id, valor, data_pagamento, observacao, criado_por)
    VALUES (${body.negocio_corretor_id}, ${body.valor}, ${body.data_pagamento}, ${body.observacao}, ${session.id})
    RETURNING id
  `;

  return NextResponse.json({ id: pagamento.id }, { status: 201 });
}
