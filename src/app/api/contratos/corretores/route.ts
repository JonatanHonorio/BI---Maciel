import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeEditarContrato } from "@/lib/contratos";
import { corretoresComLotacao } from "@/lib/unidade";

/**
 * Corretores ativos com unidade e vertical, pro card de contrato.
 *
 * A base ativa inteira, não a lista curta do rateio: quem vende é quem vende, e
 * a unidade que sai daqui é o que decide qual gerente enxerga o contrato.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!podeEditarContrato(session)) {
    return NextResponse.json({ error: "sem acesso" }, { status: 403 });
  }

  return NextResponse.json({ corretores: await corretoresComLotacao(getDb()) });
}
