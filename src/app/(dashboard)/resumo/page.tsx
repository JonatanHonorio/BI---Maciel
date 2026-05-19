"use client";
import { useDateRange, useFetch } from "@/lib/hooks";
import { fmtMoney, fmtNum, fmtPct, getStatus } from "@/lib/format";
import DateFilter from "@/components/DateFilter";
import KpiCard from "@/components/KpiCard";
import LineChartCard from "@/components/charts/LineChartCard";
import PieChartCard from "@/components/charts/PieChartCard";
import {
  Users,
  Handshake,
  DollarSign,
  Megaphone,
  Target,
  MapPin,
} from "lucide-react";

interface DashboardData {
  leads: { total: number; venda: number; locacao: number };
  propostas: number;
  conversoes: { total: number; vendas: number; locacoes: number; receita: number; receita_venda: number; receita_locacao: number };
  receita_unidade: { unidade: string; receita: number; receita_venda: number; receita_locacao: number; conversoes: number }[];
  trafego: {
    investimento: number; impressoes: number; cliques: number;
    leads: number; conversas: number; cpl: number; roas: number;
  };
  visitas_site: number;
  metas: {
    leads_meta: number; propostas_meta: number; vendas_meta: number;
    receita_meta: number; budget_meta: number; cpl_meta: number;
  } | null;
}

interface LeadsData {
  por_dia: { dia: string; total: number; venda: number; locacao: number }[];
  por_origem: { origem: string; total: number }[];
  por_tipo: { tipo: string; total: number }[];
}

export default function ResumoPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data } = useFetch<DashboardData>(`/api/dashboard?since=${since}&until=${until}`);
  const { data: leadsData } = useFetch<LeadsData>(`/api/leads?since=${since}&until=${until}`);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const m = data.metas;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Resumo Geral</h2>
        <DateFilter
          since={since}
          until={until}
          onSinceChange={setSince}
          onUntilChange={setUntil}
          onPreset={setPreset}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard
          label="Leads"
          value={fmtNum(data.leads.total)}
          subtitle={`Venda: ${data.leads.venda} | Locação: ${data.leads.locacao}`}
          icon={Users}
          iconColor="text-blue-500"
          meta={m?.leads_meta}
          status={getStatus(data.leads.total, m?.leads_meta || 0)}
        />
        <KpiCard
          label="Conversões"
          value={fmtNum(data.conversoes.total)}
          subtitle={`V: ${data.conversoes.vendas} | L: ${data.conversoes.locacoes}`}
          icon={Handshake}
          iconColor="text-green-500"
          meta={m?.vendas_meta}
          status={getStatus(data.conversoes.total, m?.vendas_meta || 0)}
        />
        <KpiCard
          label="Receita Venda"
          value={fmtMoney(data.conversoes.receita_venda)}
          subtitle={`${data.conversoes.vendas} conversões`}
          icon={DollarSign}
          iconColor="text-emerald-500"
        />
        <KpiCard
          label="Receita Locação"
          value={fmtMoney(data.conversoes.receita_locacao)}
          subtitle={`${data.conversoes.locacoes} conversões`}
          icon={DollarSign}
          iconColor="text-teal-500"
        />
        <KpiCard
          label="Investimento"
          value={fmtMoney(data.trafego.investimento)}
          icon={Megaphone}
          iconColor="text-orange-500"
          meta={m?.budget_meta}
          metaLabel={m ? `Budget: ${fmtMoney(m.budget_meta)}` : undefined}
        />
        <KpiCard
          label="CPL"
          value={fmtMoney(data.trafego.cpl)}
          subtitle={`${fmtNum(data.trafego.leads)} leads de tráfego`}
          icon={Target}
          iconColor="text-red-500"
          meta={m?.cpl_meta}
          metaLabel={m ? `Meta: ${fmtMoney(m.cpl_meta)}` : undefined}
          status={getStatus(data.trafego.cpl, m?.cpl_meta || 0, true)}
        />
      </div>

      {data.receita_unidade && data.receita_unidade.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {data.receita_unidade.map((u) => (
            <KpiCard
              key={u.unidade}
              label={u.unidade}
              value={fmtMoney(u.receita)}
              subtitle={`V: ${fmtMoney(u.receita_venda)} | L: ${fmtMoney(u.receita_locacao)}`}
              icon={MapPin}
              iconColor="text-violet-500"
              compact
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <KpiCard
          label="Conversas (WhatsApp)"
          value={fmtNum(data.trafego.conversas)}
          subtitle="Meta Ads → conversas iniciadas"
          icon={Users}
          iconColor="text-green-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {leadsData?.por_dia && (
          <LineChartCard
            title="Leads por Dia"
            data={leadsData.por_dia}
            xKey="dia"
            lines={[
              { key: "total", color: "#3b82f6", label: "Total" },
              { key: "venda", color: "#10b981", label: "Venda" },
              { key: "locacao", color: "#f59e0b", label: "Locação" },
            ]}
          />
        )}
        {leadsData?.por_origem && (
          <PieChartCard
            title="Leads por Origem"
            data={leadsData.por_origem.slice(0, 8).map((o) => ({
              name: o.origem,
              value: Number(o.total),
            }))}
          />
        )}
      </div>
    </div>
  );
}
