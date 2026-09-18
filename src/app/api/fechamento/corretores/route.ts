import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { corretoresParaRateio } from "@/lib/fechamento";

/**
 * Opções do select de corretor pro rateio. A lista é a mesma pra todo mundo,
 * em qualquer unidade e vertical — ver o comentário de corretoresParaRateio.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json(await corretoresParaRateio(getDb()));
}
