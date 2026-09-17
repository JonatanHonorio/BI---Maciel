import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

/** Reabre um período já enviado — admin only, confirmado com o Jonatan. */
export async function POST(req: NextRequest) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { periodo_id } = (await req.json()) as { periodo_id: number };
  const sql = getDb();

  await sql`
    UPDATE fechamento_periodos SET status = 'aberto', enviado_por = NULL, enviado_em = NULL
    WHERE id = ${periodo_id}
  `;

  return NextResponse.json({ ok: true });
}
