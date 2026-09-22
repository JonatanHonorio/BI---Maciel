"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Minus, AlertTriangle } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { ROTULO_MOEDA, type Moeda, type Faixa, type Situacao } from "@/lib/trafego";

interface Campanha {
  id: string; nome: string; rotulo: string; ativa: boolean; moeda: Moeda;
  produtos: string[]; orcamento_dia: number;
  gasto: number; resultados: number; custo: number;
  gasto_7d: number; resultados_7d: number; custo_7d: number;
  tendencia: "melhor" | "pior" | "estavel";
  frequencia: number | null;
  faixa: Faixa | null; situacao: Situacao; sem_regua: boolean;
}
interface Dados {
  de: string; ate: string; ultimo_dia: string | null;
  campanhas: Campanha[];
  totais: {
    gasto: number; leads: number; conversas: number; oportunidades: number;
    custo_oportunidade: number; orcamento_dia: number;
    campanhas_ativas: number; pausadas_com_gasto: number;
  };
}

const diaMes = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);

/** Custo em reais sem centavos quando é redondo — "R$842", como no relatório. */
const curto = (v: number) =>
  "R$" + Math.round(v).toLocaleString("pt-BR");

const CORES: Record<Situacao, string> = {
  acima: "text-red-600",
  dentro: "text-gray-900",
  abaixo: "text-emerald-700",
  sem_faixa: "text-gray-900",
};

/**
 * O quadro que o Jonatan lê pra decidir onde mexer, no formato que ele já
 * usava fora do BI: uma linha por campanha, ordenada do custo mais barato pro
 * mais caro, com a janela recente ao lado pra mostrar pra onde está indo.
 *
 * O custo NÃO tem um limite único: ele sobe com o ticket do imóvel. Cada
 * produto tem a própria faixa (`@/lib/trafego`), e é contra ela que a cor é
 * decidida — um teto único pintaria o Martim de vermelho pra sempre.
 */
export default function CampanhasAtivas({ since, until }: { since?: string; until?: string }) {
  const de = since;
  const ate = until;
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const qs = new URLSearchParams();
    if (de) qs.set("de", de);
    if (ate) qs.set("ate", ate);
    fetch(`/api/trafego/campanhas?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDados)
      .catch(() => setErro("Não foi possível carregar as campanhas."));
  }, [de, ate]);

  if (erro) return <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{erro}</div>;
  if (!dados) return <div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-400">Carregando campanhas...</div>;

  const t = dados.totais;
  // Dado velho não pode passar por resultado ruim — foi assim que o tráfego
  // ficou dois meses parado sem ninguém perceber.
  const atrasoEmDias = dados.ultimo_dia
    ? Math.floor((Date.now() - new Date(`${dados.ultimo_dia.slice(0, 10)}T12:00:00`).getTime()) / 86400000)
    : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">
          Campanhas ativas — {diaMes(dados.de)} a {diaMes(dados.ate)}
        </h3>
        <span className="text-xs text-gray-500">
          {curto(t.orcamento_dia)}/dia · {t.oportunidades.toLocaleString("pt-BR")} oportunidades ·{" "}
          {fmtMoney(t.custo_oportunidade)} cada
        </span>
      </div>

      {atrasoEmDias != null && atrasoEmDias > 2 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} />
          Último dia com dado: {dados.ultimo_dia?.slice(0, 10).split("-").reverse().join("/")} — {atrasoEmDias} dias
          atrás. Rode <code className="rounded bg-amber-100 px-1">node scripts/sync-meta.js</code>.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs text-gray-500">
              <th className="px-2 py-2 text-left font-medium">Campanha</th>
              <th className="px-2 py-2 text-right font-medium">R$/dia</th>
              <th className="px-2 py-2 text-left font-medium">Período</th>
              <th className="px-2 py-2 text-right font-medium">Custo</th>
              <th className="px-2 py-2 text-right font-medium">Últimos 7d</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {dados.campanhas.map((c) => {
              const unidade = ROTULO_MOEDA[c.moeda];
              const Seta = c.tendencia === "melhor" ? ArrowDown : c.tendencia === "pior" ? ArrowUp : Minus;
              const corSeta =
                c.tendencia === "melhor" ? "text-emerald-600"
                : c.tendencia === "pior" ? "text-red-600" : "text-gray-400";
              return (
                <tr key={c.id} className={c.ativa ? "" : "bg-gray-50/60"}>
                  <td className="px-2 py-2.5">
                    <span className="font-medium text-gray-900">{c.rotulo}</span>{" "}
                    <span className="text-gray-500">({unidade.canal})</span>
                    {c.produtos.length > 0 && (
                      <div className="text-[11px] text-gray-400">{c.produtos.join(" + ")}</div>
                    )}
                    {!c.ativa && <div className="text-[11px] text-amber-700">pausada no período</div>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-700">
                    {c.orcamento_dia > 0 ? Math.round(c.orcamento_dia) : "—"}
                  </td>
                  <td className="px-2 py-2.5 whitespace-nowrap text-gray-600">
                    {curto(c.gasto)} · {c.resultados.toLocaleString("pt-BR")}{" "}
                    {c.resultados === 1 ? unidade.um : unidade.plural}
                  </td>
                  <td className={"px-2 py-2.5 text-right font-semibold tabular-nums " + CORES[c.situacao]}>
                    {c.custo > 0 ? fmtMoney(c.custo) : "—"}
                    {c.faixa && (
                      <div className="text-[11px] font-normal text-gray-400">
                        esperado R${c.faixa.min}–{c.faixa.max}
                      </div>
                    )}
                    {c.sem_regua && c.gasto > 0 && (
                      <div className="text-[11px] font-normal text-amber-600">sem faixa definida</div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-700">
                    <span className="inline-flex items-center justify-end gap-1">
                      {c.custo_7d > 0 ? fmtMoney(c.custo_7d) : "—"}
                      {c.custo_7d > 0 && <Seta size={13} className={corSeta} />}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 border-t border-gray-100 pt-3 text-[11px] text-gray-400">
        Campanha de formulário conta <strong>lead</strong>; campanha de WhatsApp conta{" "}
        <strong>conversa</strong>. São moedas diferentes e não se somam — o total acima junta as duas
        como <strong>oportunidades</strong>.
        {t.pausadas_com_gasto > 0 && (
          <> {t.pausadas_com_gasto} campanha(s) pausada(s) no período aparecem porque o que
          produziram conta no mês.</>
        )}
      </p>
    </div>
  );
}
