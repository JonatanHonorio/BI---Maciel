import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeLancarComissao, podeAcessarPeriodo } from "@/lib/permissoes";

/**
 * Desfaz uma parcela recebida inteira.
 *
 * As baixas que ela gerou saem junto pelo ON DELETE CASCADE — sem isso, quem
 * lançasse R$6.666,66 no lugar de R$666,66 teria que caçar seis pagamentos um
 * a um pra desfazer.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = getSession(req);
  if (!session || !podeLancarComissao(session)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const sql = getDb();
  const [alvo] = await sql`
    SELECT p.unidade, p.tipo
    FROM fechamento_recebimentos r
    JOIN fechamento_negocios n ON n.id = r.negocio_id
    JOIN fechamento_periodos p ON p.id = n.periodo_id
    WHERE r.id = ${Number(id)}
  `;
  if (!alvo) return NextResponse.json({ error: "recebimento não encontrado" }, { status: 404 });
  if (!podeAcessarPeriodo(session, alvo)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  await sql`DELETE FROM fechamento_recebimentos WHERE id = ${Number(id)}`;
  return NextResponse.json({ ok: true });
}
