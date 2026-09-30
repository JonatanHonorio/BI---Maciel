"use client";
import { useState } from "react";
import { Trophy, Home, Handshake, Building2 } from "lucide-react";
import { useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum } from "@/lib/format";
import DataTable from "@/components/DataTable";
import KpiCard from "@/components/KpiCard";

/**
 * Ranking do fechamento — primeira versão (28/09/2026), com as quatro
 * categorias que o Jonatan pediu enquanto a diretoria fecha a lista.
 *
 * As tabelas mostram o número FRACIONADO ("3,5 imóveis") em vez de
 * arredondar: metade de um negócio é exatamente o que a regra manda contar, e
 * arredondar faria a soma do ranking não bater com o total da empresa.
 */

interface Linha {
  chave: string; nome: string; corretor_id: number | null;
  negocios: number; participacoes: number; vgv: number;
}
interface Unidade { unidade: string; gerente: string | null; negocios: number; vgv: number }
interface Dados {
  filtro: { de: string; ate: string; unidade: string | null; tipo: "venda" | "locacao" };
  faixa: { primeira: string | null; ultima: string | null };
  unidades: string[];
  vendedores: Linha[];
  captadores: Linha[];
  porUnidade: Unidade[];
  totais: { negocios: number; vgv: number };
}

/** "2025-12-01" <-> "2025-12" (o que o input type=month usa). */
const paraMes = (iso: string) => iso.slice(0, 7);
const paraISO = (mes: string) => `${mes}-01`;
const mesBR = (iso: string) => {
  const [a, m] = iso.split("-");
  return `${m}/${a}`;
};

/**
 * "R$ 135,4 mi" para o card do topo. O valor por extenso tem 17 caracteres e
 * era cortado no card em tela de notebook; o número exato continua no
 * subtítulo e em toda coluna de VGV das tabelas.
 */
const fmtCurto = (v: number) =>
  v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
  : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`
  : fmtMoney(v);

export default function RankingPage() {
  const [de, setDe] = useState("2025-12-01");
  const [ate, setAte] = useState(() => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [unidade, setUnidade] = useState("");
  const [tipo, setTipo] = useState<"venda" | "locacao">("venda");

  const { data } = useFetch<Dados>(
    `/api/ranking?de=${de}&ate=${ate}&tipo=${tipo}&unidade=${encodeURIComponent(unidade)}`
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const posicionar = (lista: Linha[]) =>
    lista.map((l, i) => ({
      pos: i + 1,
      nome: l.nome,
      // Quem não tem cadastro no Kurole foi digitado à mão no rateio. Vale o
      // ranking (é gente que vendeu), mas fica marcado: o nome não tem dono.
      cadastro: l.corretor_id ? "" : "nome digitado",
      negocios: l.negocios,
      participacoes: l.participacoes,
      vgv: l.vgv,
    }));

  const colunas = [
    { key: "pos", label: "#", align: "right" as const },
    { key: "nome", label: "Corretor" },
    { key: "cadastro", label: "" },
    { key: "negocios", label: "Imóveis", align: "right" as const, format: (v: unknown) => fmtNum(Number(v)) },
    { key: "participacoes", label: "Negócios", align: "right" as const },
    { key: "vgv", label: "VGV", align: "right" as const, format: (v: unknown) => fmtMoney(Number(v)) },
  ];

  const rotulo = tipo === "venda" ? "vendeu" : "locou";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">Ranking</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="month" value={paraMes(de)} onChange={(e) => e.target.value && setDe(paraISO(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5" />
          <span className="text-gray-400">até</span>
          <input type="month" value={paraMes(ate)} onChange={(e) => e.target.value && setAte(paraISO(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5" />
          <select value={unidade} onChange={(e) => setUnidade(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5">
            <option value="">Todas as unidades</option>
            {data.unidades.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "venda" | "locacao")}
            className="border border-gray-300 rounded-lg px-3 py-1.5">
            <option value="venda">Vendas</option>
            <option value="locacao">Locação</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label={tipo === "venda" ? "VGV vendido" : "Valor locado"} value={fmtCurto(data.totais.vgv)}
          subtitle={`${fmtMoney(data.totais.vgv)} · ${mesBR(de)} a ${mesBR(ate)}`} icon={Trophy} />
        <KpiCard label="Negócios" value={fmtNum(data.totais.negocios)}
          subtitle={data.filtro.unidade ?? "todas as unidades"} icon={Home} />
        <KpiCard label="Corretores no ranking" value={fmtNum(data.vendedores.length)}
          subtitle="com negócio no período" icon={Handshake} />
        <KpiCard label="Unidades" value={fmtNum(data.porUnidade.length)}
          subtitle="com negócio no período" icon={Building2} />
      </div>

      {/*
        O aviso da meia-venda fica em cima das tabelas: sem ele, o gerente lê
        "3,5 imóveis" como erro de conta, e não como a regra que a diretoria
        escolheu.
      */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-xs text-blue-900">
        Negócio em parceria conta <strong>meio imóvel e metade do VGV para cada</strong> participante — por isso
        aparecem números quebrados. A coluna <strong>Negócios</strong> mostra em quantos ele entrou, sem dividir.
        Vendas canceladas ficam de fora.
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Quem mais {rotulo}</h3>
        <p className="text-xs text-gray-500 mb-3">Pelo bloco Fechamento do rateio — quem fechou o negócio.</p>
        <DataTable columns={colunas} data={posicionar(data.vendedores)} searchable pageSize={15} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Quem mais captou</h3>
        <p className="text-xs text-gray-500 mb-3">
          Captação dos imóveis negociados no período — não é a carteira captada, que fica em Produtividade.
        </p>
        <DataTable columns={colunas} data={posicionar(data.captadores)} searchable pageSize={15} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Volume por unidade</h3>
        <p className="text-xs text-gray-500 mb-3">
          O gerente é quem mais assina o bloco Gerência da unidade no período — unidade que trocou de gerente
          continua como uma linha só, e fica com o nome de quem assinou mais vezes.
        </p>
        <DataTable
          columns={[
            { key: "pos", label: "#", align: "right" },
            { key: "unidade", label: "Unidade" },
            { key: "gerente", label: "Gerente" },
            { key: "negocios", label: "Negócios", align: "right" },
            { key: "vgv", label: "VGV", align: "right", format: (v: unknown) => fmtMoney(Number(v)) },
          ]}
          data={data.porUnidade.map((u, i) => ({ ...u, pos: i + 1, gerente: u.gerente ?? "—" }))}
          pageSize={15}
        />
      </div>
    </div>
  );
}
