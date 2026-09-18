import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeLancarComissao, podeAcessarPeriodo } from "@/lib/permissoes";

/**
 * Remove um lançamento de pagamento errado — admin ou gerente administrativa,
 * e só dentro das unidades dela. Sem o join até o período, bastaria variar o
 * id na requisição pra apagar pagamento de qualquer unidade.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = getSession(req);
  if (!session || !podeLancarComissao(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const pagamentoId = Number(id);
  if (!Number.isInteger(pagamentoId)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const sql = getDb();
  const [destino] = await sql`
    SELECT p.unidade, p.tipo
    FROM fechamento_pagamentos fp
    JOIN fechamento_negocio_corretores rc ON rc.id = fp.negocio_corretor_id
    JOIN fechamento_negocios n ON n.id = rc.negocio_id
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE fp.id = ${pagamentoId}
  `;
  if (!destino) return NextResponse.json({ error: "pagamento não encontrado" }, { status: 404 });
  if (!podeAcessarPeriodo(session, destino)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  await sql`DELETE FROM fechamento_pagamentos WHERE id = ${pagamentoId}`;
  return NextResponse.json({ ok: true });
}
