import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeEditarContrato, podeVerBanco } from "@/lib/contratos";
import {
  clientePorId, pessoaDoCliente, contaDoCliente, temConta, clientesSemelhantes,
} from "@/lib/cliente-contrato";

/**
 * Ficha do cliente pelo id do Kurole — preenche o comprador/locatário do mesmo
 * jeito que a referência do imóvel preenche o vendedor.
 *
 * O id é o número do cadastro no Kurole, não a referência do imóvel: são
 * sequências diferentes, e digitar um no lugar do outro traz a pessoa errada
 * em vez de dar erro. Por isso a resposta devolve o nome em destaque, pra Ana
 * conferir antes de salvar.
 *
 * Só quem opera o quadro chama: é consulta de CPF/RG por id, não pode ficar
 * aberta a qualquer sessão logada.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!podeEditarContrato(session)) {
    return NextResponse.json({ error: "sem acesso" }, { status: 403 });
  }

  const bruto = req.nextUrl.searchParams.get("id") || "";
  const id = Number(bruto.replace(/\D/g, ""));
  if (!id) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const cliente = await clientePorId(getDb(), id);
  if (!cliente) return NextResponse.json({ error: "cliente não encontrado" }, { status: 404 });

  /*
   * Aviso de ficha pela metade (21/10/2026).
   *
   * CPF vazio é o sinal que pega os dois jeitos de a Ana puxar a pessoa
   * errada: o cadastro que a adm completou no Kurole DEPOIS do dump do dia
   * (o BI só enxerga na importação seguinte) e a ficha duplicada criada por
   * lead do Canal Pro. Em ambos a tela mostrava o dado incompleto calada.
   *
   * Avisa, mas não impede: há contrato que começa com cadastro incompleto de
   * verdade, e travar a tela só faria a Ana procurar outro caminho.
   */
  const semCpf = !cliente.cpf || !String(cliente.cpf).trim();
  const semelhantes = semCpf
    ? await clientesSemelhantes(getDb(), id, cliente.celular, cliente.email)
    : [];

  return NextResponse.json({
    pessoa: pessoaDoCliente(cliente),
    // Mesma regra do vendedor: a conta sai da resposta inteira para quem não
    // pode vê-la, em vez de vir zerada campo a campo.
    conta: podeVerBanco(session) && temConta(cliente) ? contaDoCliente(cliente) : null,
    alerta: semCpf ? { sem_cpf: true, semelhantes } : null,
  });
}
