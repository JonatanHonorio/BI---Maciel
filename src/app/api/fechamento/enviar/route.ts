import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeAcessarPeriodo } from "@/lib/permissoes";

/** Trava o período do mês — só o dono da unidade (ou admin). */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { periodo_id } = (await req.json()) as { periodo_id: number };
  const sql = getDb();

  const [periodo] = await sql`SELECT id, unidade, tipo, status FROM fechamento_periodos WHERE id = ${periodo_id}`;
  if (!periodo) return NextResponse.json({ error: "período não encontrado" }, { status: 404 });

  if (!podeAcessarPeriodo(session, periodo)) {
    return NextResponse.json({ error: "sem acesso a este período" }, { status: 403 });
  }

  if (periodo.status === "enviado") {
    return NextResponse.json({ error: "período já estava enviado" }, { status: 409 });
  }

  await sql`
    UPDATE fechamento_periodos SET status = 'enviado', enviado_por = ${session.id}, enviado_em = NOW()
    WHERE id = ${periodo_id}
  `;

  return NextResponse.json({ ok: true });
}
