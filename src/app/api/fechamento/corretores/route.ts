import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { corretoresParaRateio } from "@/lib/fechamento";
import type { Tipo } from "@/lib/unidade";

/** Opções do select de corretor pro rateio — sempre inclui Secretaria Comercial. */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isAdmin = session.role === "admin";
  const unidade = isAdmin ? req.nextUrl.searchParams.get("unidade") : session.unidade;
  const tipo = (isAdmin ? req.nextUrl.searchParams.get("tipo") : session.tipo) as Tipo | null;

  if (!unidade || !tipo) {
    return NextResponse.json({ error: "unidade e tipo são obrigatórios" }, { status: 400 });
  }

  const sql = getDb();
  const corretores = await corretoresParaRateio(sql, unidade, tipo);
  return NextResponse.json(corretores);
}
