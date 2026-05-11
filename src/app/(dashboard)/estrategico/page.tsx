"use client";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum, fmtPct } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import KpiCard from "@/components/KpiCard";
import LineChartCard from "@/components/charts/LineChartCard";
import { TrendingUp, DollarSign, Users, Handshake, Target, Percent, Building2, Megaphone } from "lucide-react";

interface DashboardData {
  leads: { total: number; venda: number; locacao: number };
  propostas: number;
  conversoes: { total: number; vendas: number; locacoes: number; receita: number };
  trafego: { investimento: number; leads: number; conversas: number; cpl: number; roas: number };
  visitas_site: number;
  metas: {
    leads_meta: number; propostas_meta: number; vendas_meta: number;
    receita_meta: number; budget_meta: number;
  } | null;
}

interface VendasData {
  receita_acumulada: { dia: string; acumulado: number }[];
}

interface TrafegoData {
  gasto_acumulado: { dia: string; acumulado: number }[];
}

export default function EstrategicoPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<DashboardData>(`/api/dashboard?since=${since}&until=${until}`);
  const { data: vendas } = useFetch<VendasData>(`/api/vendas?since=${since}&until=${until}`);
  const { data: trafego } = useFetch<TrafegoData>(`/api/trafego?since=${since}&until=${until}`);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const totalLeads = data.leads.total;
  const totalConversoes = data.conversoes.total;
  const receita = data.conversoes.receita;
  const investimento = data.trafego.investimento;
  const taxaConversao = totalLeads > 0 ? (totalConversoes / totalLeads) * 100 : 0;
  const roi = investimento > 0 ? ((receita - investimento) / investimento) * 100 : 0;
  const ticketMedio = totalConversoes > 0 ? receita / totalConversoes : 0;
  const cpv = totalConversoes > 0 ? investimento / totalConversoes : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Visão Estratégica</h2>
        <DateFilter since={since} until={until} onSinceChange={setSince} onUntilChange={setUntil} onPreset={setPreset} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Executive Dashboard</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Receita Total" value={fmtMoney(receita)} icon={DollarSign} iconColor="text-emerald-500" />
          <KpiCard label="Total Conversões" value={fmtNum(totalConversoes)} subtitle={`V: ${data.conversoes.vendas} | L: ${data.conversoes.locacoes}`} icon={Handshake} iconColor="text-green-500" />
          <KpiCard label="Ticket Médio" value={fmtMoney(ticketMedio)} icon={Building2} iconColor="text-blue-500" />
          <KpiCard
            label="ROI"
            value={`${roi.toFixed(1)}%`}
            subtitle={roi >= 0 ? "Acima do break-even" : "Abaixo do break-even"}
            icon={TrendingUp}
            iconColor={roi >= 0 ? "text-green-500" : "text-red-500"}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="ROAS" value={`${data.trafego.roas.toFixed(2)}x`} icon={TrendingUp} iconColor="text-indigo-500" />
        <KpiCard label="CPV (Custo/Venda)" value={fmtMoney(cpv)} icon={Megaphone} iconColor="text-orange-500" />
        <KpiCard label="Investimento" value={fmtMoney(investimento)} icon={DollarSign} iconColor="text-red-500" />
        <KpiCard label="Taxa Conversão" value={fmtPct(taxaConversao)} icon={Percent} iconColor="text-purple-500" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard label="Leads Totais" value={fmtNum(totalLeads)} subtitle={`V: ${data.leads.venda} | L: ${data.leads.locacao}`} icon={Users} iconColor="text-blue-500" />
        <KpiCard label="CPL" value={fmtMoney(data.trafego.cpl)} icon={Target} iconColor="text-cyan-500" />
        <KpiCard label="Visitas Site" value={fmtNum(data.visitas_site)} subtitle="Páginas de imóveis" icon={Building2} iconColor="text-gray-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {vendas?.receita_acumulada && (
          <LineChartCard
            title="Receita Acumulada por Dia"
            data={vendas.receita_acumulada}
            xKey="dia"
            lines={[{ key: "acumulado", color: "#10b981", label: "Receita (R$)" }]}
            formatY={(v) => `R$${(v / 1000).toFixed(0)}k`}
          />
        )}
        {trafego?.gasto_acumulado && (
          <LineChartCard
            title="Investimento Acumulado"
            data={trafego.gasto_acumulado}
            xKey="dia"
            lines={[{ key: "acumulado", color: "#ef4444", label: "Gasto (R$)" }]}
            formatY={(v) => `R$${(v / 1000).toFixed(0)}k`}
          />
        )}
      </div>
    </div>
  );
}
