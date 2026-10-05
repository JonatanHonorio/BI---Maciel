"use client";
import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";

/**
 * Avisos do quadro de contratos, em qualquer tela do BI (05/10/2026).
 *
 * Pedido da Ana: quando o gerente confere e move o card, ela precisa saber —
 * "por e-mail e por pop-up no próprio BI". O e-mail sai pelo mesmo caminho de
 * sempre; isto aqui é o pop-up, e é o canal que não depende de entrega de
 * e-mail (hoje o remetente é um Gmail pessoal e o domínio da Maciel filtra).
 *
 * Mora no layout do dashboard, e não na página de contratos, de propósito: o
 * aviso serve justamente para quem está em OUTRA tela. Quem já está olhando o
 * quadro não precisa de pop-up.
 *
 * Não renderiza nada para quem não tem aviso — e quem não é do setor de
 * contratos nunca tem, então o sino simplesmente não existe para os demais.
 */
type Aviso = {
  id: number;
  contrato_id: number;
  titulo: string;
  texto: string | null;
  senha: number | null;
  ref: string;
  criado_em: string;
};

/** De quanto em quanto tempo o BI pergunta se chegou aviso novo. */
const INTERVALO = 60_000;

export default function AvisosContratos() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [aberto, setAberto] = useState(false);
  /** Ids que já apareceram como pop-up — para não reabrir a cada rodada. */
  const [mostrados, setMostrados] = useState<number[]>([]);

  const buscar = useCallback(async () => {
    try {
      const r = await fetch("/api/contratos/notificacoes");
      if (!r.ok) return;
      const d = await r.json();
      const lista = (d.avisos ?? []) as Aviso[];
      setAvisos(lista);
      // Aviso novo abre o painel sozinho uma vez. Reabrir a cada minuto
      // enquanto ela não marcasse como lido seria praga, não aviso.
      setMostrados((jaVistos) => {
        const novos = lista.filter((a) => !jaVistos.includes(a.id));
        if (novos.length) setAberto(true);
        return lista.map((a) => a.id);
      });
    } catch {
      // Sino é conveniência: falhou a rede, tenta no próximo minuto.
    }
  }, []);

  useEffect(() => {
    buscar();
    const t = setInterval(buscar, INTERVALO);
    return () => clearInterval(t);
  }, [buscar]);

  async function marcarLidos(ids?: number[]) {
    const corpo = ids ? JSON.stringify({ ids }) : "{}";
    await fetch("/api/contratos/notificacoes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: corpo,
    });
    setAvisos((atual) => (ids ? atual.filter((a) => !ids.includes(a.id)) : []));
    if (!ids) setAberto(false);
  }

  if (!avisos.length) return null;

  return (
    <div className="fixed right-5 top-4 z-50">
      <button
        onClick={() => setAberto((v) => !v)}
        className="relative rounded-full border border-gray-200 bg-white p-2 shadow-sm hover:bg-gray-50"
        title={`${avisos.length} aviso${avisos.length > 1 ? "s" : ""} de contrato`}
      >
        <Bell size={18} className="text-gray-600" />
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white">
          {avisos.length}
        </span>
      </button>

      {aberto && (
        <div className="mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-xs font-semibold text-gray-700">Contratos</span>
            <div className="flex items-center gap-2">
              <button onClick={() => marcarLidos()} className="text-[11px] text-blue-600 hover:text-blue-700">
                marcar tudo como lido
              </button>
              <button onClick={() => setAberto(false)} className="text-gray-400 hover:text-gray-600">
                <X size={14} />
              </button>
            </div>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {avisos.map((a) => (
              <li key={a.id} className="border-b border-gray-100 last:border-0">
                <a
                  href={`/contratos?card=${a.contrato_id}`}
                  onClick={() => marcarLidos([a.id])}
                  className="block px-3 py-2 hover:bg-gray-50"
                >
                  <p className="text-xs font-medium text-gray-800">{a.titulo}</p>
                  {a.texto && <p className="mt-0.5 text-[11px] text-gray-500">{a.texto}</p>}
                  <p className="mt-1 text-[10px] text-gray-400">
                    senha {a.senha == null ? "—" : String(a.senha).padStart(3, "0")} ·{" "}
                    {new Date(a.criado_em).toLocaleString("pt-BR", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
