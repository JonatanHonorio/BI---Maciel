import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { podeEditarContrato, podeVerBanco } from "@/lib/contratos";
import { montarEndereco, parte, type ImovelEndereco } from "@/lib/imovel-endereco";
import { proprietariosDoImovel, pessoaDoCliente, contaDoCliente, temConta } from "@/lib/cliente-contrato";

/**
 * Preenchimento do card pela referência do imóvel.
 *
 * Devolve endereço, ficha do imóvel e os PROPRIETÁRIOS (o vendedor/locador),
 * com o dado civil que o contrato exige. A ref é digitada de vários jeitos
 * ("58298", "L58808", "V 58298"), mas o número é sempre o id do imóvel —
 * `imoveis.codigo` está gravado como "0" na maior parte da base.
 *
 * Só quem opera o quadro chama isto: é consulta de CPF/RG/conta bancária por
 * referência, não pode ficar aberta a qualquer sessão logada.
 */
export async function GET(req: NextRequest) {
  const session = getSession(req);
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!podeEditarContrato(session)) {
    return NextResponse.json({ error: "sem acesso" }, { status: 403 });
  }

  const ref = req.nextUrl.searchParams.get("ref") || "";
  const id = Number(ref.replace(/\D/g, ""));
  if (!id) return NextResponse.json({ error: "ref inválida" }, { status: 400 });

  const sql = getDb();
  const [imovel] = await sql`
    SELECT id, endereco, numero, complemento, compl_blocos, unidade_imovel,
           quadra, lote, bairro, cidade, estado, cep, tipo_imovel, dormitorios,
           suites, banheiros, area_util, area_total, valor, valor_locacao,
           edificio_id
    FROM imoveis WHERE id = ${id}
  `;
  if (!imovel) return NextResponse.json({ error: "imóvel não encontrado" }, { status: 404 });

  const proprietarios = await proprietariosDoImovel(sql, id);

  const verBanco = podeVerBanco(session);
  const [edificio] = imovel.edificio_id
    ? await sql`SELECT nome FROM empreendimentos WHERE id = ${imovel.edificio_id}`
    : [undefined];

  return NextResponse.json({
    imovel_id: imovel.id,
    endereco: montarEndereco(imovel as unknown as ImovelEndereco),
    imovel_dados: {
      tipo: parte(imovel.tipo_imovel as string),
      empreendimento: edificio?.nome ?? null,
      bairro: parte(imovel.bairro as string),
      cidade: parte(imovel.cidade as string),
      estado: parte(imovel.estado as string),
      cep: parte(imovel.cep as string),
      dormitorios: Number(imovel.dormitorios) || null,
      suites: Number(imovel.suites) || null,
      banheiros: Number(imovel.banheiros) || null,
      area_util: Number(imovel.area_util) || null,
      area_total: Number(imovel.area_total) || null,
      valor: Number(imovel.valor) || null,
      valor_locacao: Number(imovel.valor_locacao) || null,
    },
    // Cada proprietário vira uma linha do bloco "vendedor". Imóvel de casal
    // volta com dois, e o percentual de cada um vem junto.
    vendedor: proprietarios.map(pessoaDoCliente),
    // O bloco bancário vem separado do vendedor para poder ser omitido inteiro
    // de quem não pode vê-lo, sem mexer no resto da ficha.
    banco: verBanco ? proprietarios.filter(temConta).map(contaDoCliente) : null,
    sem_proprietario: proprietarios.length === 0,
  });
}
