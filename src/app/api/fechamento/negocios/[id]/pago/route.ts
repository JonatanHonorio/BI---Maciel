import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

/** Marca/desmarca comissão como paga — admin only (controle de pagamento). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const { pago } = (await req.json()) as { pago: boolean };
  const sql = getDb();

  await sql`
    UPDATE fechamento_negocios SET
      comissao_paga = ${pago},
      comissao_paga_em = ${pago ? new Date().toISOString() : null},
      comissao_paga_por = ${pago ? session.id : null}
    WHERE id = ${Number(id)}
  `;

  return NextResponse.json({ ok: true });
}
