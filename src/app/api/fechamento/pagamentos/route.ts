import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

interface PagamentoInput {
  negocio_corretor_id: number;
  valor: number;
  data_pagamento: string;
  observacao: string | null;
}

/**
 * Registra um pagamento (parcial ou total) pra um destinatário do rateio —
 * admin only (é a gerente administrativa quem lança). Um negócio pode ter
 * vários pagamentos ao longo do tempo pro mesmo destinatário.
 */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as PagamentoInput;
  if (!body.negocio_corretor_id || !body.valor || body.valor <= 0 || !body.data_pagamento) {
    return NextResponse.json({ error: "negocio_corretor_id, valor (>0) e data_pagamento são obrigatórios" }, { status: 400 });
  }

  const sql = getDb();
  const [destinatario] = await sql`SELECT id FROM fechamento_negocio_corretores WHERE id = ${body.negocio_corretor_id}`;
  if (!destinatario) return NextResponse.json({ error: "destinatário do rateio não encontrado" }, { status: 404 });

  const [pagamento] = await sql`
    INSERT INTO fechamento_pagamentos (negocio_corretor_id, valor, data_pagamento, observacao, criado_por)
    VALUES (${body.negocio_corretor_id}, ${body.valor}, ${body.data_pagamento}, ${body.observacao}, ${session.id})
    RETURNING id
  `;

  return NextResponse.json({ id: pagamento.id }, { status: 201 });
}
