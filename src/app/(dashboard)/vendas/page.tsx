"use client";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import KpiCard from "@/components/KpiCard";
import LineChartCard from "@/components/charts/LineChartCard";
import PieChartCard from "@/components/charts/PieChartCard";
import BarChartCard from "@/components/charts/BarChartCard";
import { DollarSign, Handshake, Home, TrendingUp } from "lucide-react";

interface VendasData {
  resumo: {
    total: number; vendas: number; locacoes: number;
    receita_total: number; receita_venda: number; receita_locacao: number;
    ticket_medio: number;
  };
  por_dia: { dia: string; total: number; receita: number }[];
  por_midia: { midia: string; total: number; receita: number }[];
  por_finalidade: { finalidade: string; total: number; receita: number }[];
  receita_acumulada: { dia: string; acumulado: number }[];
}

export default function VendasPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<VendasData>(`/api/vendas?since=${since}&until=${until}`);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const r = data.resumo;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Vendas & Locações</h2>
        <DateFilter since={since} until={until} onSinceChange={setSince} onUntilChange={setUntil} onPreset={setPreset} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-3">
        <KpiCard label="Total Conversões" value={fmtNum(r.total)} icon={Handshake} iconColor="text-green-500" />
        <KpiCard label="Vendas" value={fmtNum(r.vendas)} subtitle={fmtMoney(r.receita_venda)} icon={Home} iconColor="text-blue-500" />
        <KpiCard label="Locações" value={fmtNum(r.locacoes)} subtitle={fmtMoney(r.receita_locacao)} icon={Home} iconColor="text-orange-500" />
        <KpiCard label="Receita Total" value={fmtMoney(r.receita_total)} icon={DollarSign} iconColor="text-emerald-500" />
        <KpiCard label="Ticket Médio" value={fmtMoney(r.ticket_medio)} icon={TrendingUp} iconColor="text-indigo-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LineChartCard
          title="Receita Acumulada"
          data={data.receita_acumulada}
          xKey="dia"
          lines={[{ key: "acumulado", color: "#10b981", label: "Receita (R$)" }]}
          formatY={(v) => `R$${(v / 1000).toFixed(0)}k`}
        />
        <BarChartCard
          title="Conversões por Dia"
          data={data.por_dia}
          xKey="dia"
          bars={[{ key: "total", color: "#3b82f6", label: "Conversões" }]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PieChartCard
          title="Por Finalidade"
          data={data.por_finalidade.map((f) => ({
            name: f.finalidade || "N/A",
            value: Number(f.total),
          }))}
        />
        <BarChartCard
          title="Conversões por Mídia/Canal"
          data={data.por_midia.slice(0, 10)}
          xKey="midia"
          bars={[{ key: "total", color: "#8b5cf6", label: "Conversões" }]}
          layout="horizontal"
        />
      </div>
    </div>
  );
}
