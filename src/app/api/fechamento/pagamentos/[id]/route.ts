import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";

/** Remove um lançamento de pagamento errado — admin only. */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = getSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const sql = getDb();
  await sql`DELETE FROM fechamento_pagamentos WHERE id = ${Number(id)}`;
  return NextResponse.json({ ok: true });
}
