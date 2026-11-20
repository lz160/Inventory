import React from 'react';
import { PurchaseItem, OrderMetrics, checkPriceDiscrepancy, calculateItemStatus } from '../utils/reconciliation';
import { ExportDropdown } from './ExportDropdown';
import { AlertTriangle, CheckCircle2, PackageX, TrendingDown, TrendingUp, DollarSign, ArrowRight } from 'lucide-react';

interface AuditReportViewProps {
  items: PurchaseItem[];
  metrics: OrderMetrics;
  priceBasis: 'discountPrice' | 'unitPrice' | 'unitPrice2';
  onNavigateToItem: (itemId: string) => void;
  onExportPos: () => void;
  onExportAudit: () => void;
}

export const AuditReportView: React.FC<AuditReportViewProps> = ({
  items,
  metrics,
  priceBasis,
  onNavigateToItem,
  onExportPos,
  onExportAudit,
}) => {
  // Categorize items
  const shortageItems = items.filter((item) => item.receivedQty < item.expectedQty);
  const excessItems = items.filter((item) => item.receivedQty > item.expectedQty);
  const damagedItems = items.filter((item) => (item.damagedQty || 0) > 0);
  const priceDiscrepancyItems = items.filter(
    (item) => checkPriceDiscrepancy(item, priceBasis).status === 'discrepancy'
  );

  // Group by supplier
  const supplierStats: Record<
    string,
    { expectedQty: number; receivedQty: number; damagedQty: number; itemsCount: number }
  > = {};

  items.forEach((item) => {
    const s = item.supplier || '未指定供应商';
    if (!supplierStats[s]) {
      supplierStats[s] = { expectedQty: 0, receivedQty: 0, damagedQty: 0, itemsCount: 0 };
    }
    supplierStats[s].expectedQty += item.expectedQty;
    supplierStats[s].receivedQty += item.receivedQty;
    supplierStats[s].damagedQty += item.damagedQty || 0;
    supplierStats[s].itemsCount += 1;
  });

  return (
    <div className="space-y-6">
      {/* Top Summary Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">进货差异核对与损益审计</h2>
            <p className="text-xs text-slate-500 mt-1">
              自动比对进货单与实际入库差异，重点归集缺货少发、超量入库、破损残损与采购单价偏离
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ExportDropdown
              onExportPos={onExportPos}
              onExportAudit={onExportAudit}
              label="导出汇总表格 (.xlsx)"
              align="right"
            />
          </div>
        </div>

        {/* 4 Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-100 text-xs">
          <div className="p-3 bg-slate-50 rounded-lg">
            <span className="text-slate-500 block mb-1">少发/未到款数</span>
            <span className="text-lg font-bold font-mono-numbers text-rose-600">
              {shortageItems.length} 款
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              总计少发 {shortageItems.reduce((acc, it) => acc + (it.expectedQty - it.receivedQty), 0)} 件
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg">
            <span className="text-slate-500 block mb-1">超发到货款数</span>
            <span className="text-lg font-bold font-mono-numbers text-purple-600">
              {excessItems.length} 款
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              多送入库 {excessItems.reduce((acc, it) => acc + (it.receivedQty - it.expectedQty), 0)} 件
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg">
            <span className="text-slate-500 block mb-1">破损残损品类</span>
            <span className="text-lg font-bold font-mono-numbers text-amber-600">
              {damagedItems.length} 款
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              破损总数 {metrics.totalDamagedQty} 件
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg">
            <span className="text-slate-500 block mb-1">价格不符条目</span>
            <span className="text-lg font-bold font-mono-numbers text-indigo-600">
              {priceDiscrepancyItems.length} 款
            </span>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              总金额偏差 {metrics.amountDifference > 0 ? `+¥${metrics.amountDifference.toFixed(2)}` : metrics.amountDifference < 0 ? `-¥${Math.abs(metrics.amountDifference).toFixed(2)}` : '¥0.00'}
            </span>
          </div>
        </div>
      </div>

      {/* Grid of Discrepancies */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Shortage Items */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>少发 / 未送达明细 ({shortageItems.length})</span>
            </h3>
            <span className="text-[11px] text-slate-400">需督促供应商补发或扣减对账</span>
          </div>

          {shortageItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-lg">
              无少发或缺件商品，全单已齐套
            </div>
          ) : (
            <div className="space-y-2">
              {shortageItems.map((item) => {
                const diff = item.expectedQty - item.receivedQty;
                return (
                  <div
                    key={item.id}
                    onClick={() => onNavigateToItem(item.id)}
                    className="p-2.5 rounded-lg border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 cursor-pointer transition-colors flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-900 line-clamp-1">
                        {item.chineseName || item.name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-numbers">
                        条码: {item.barcode || '-'} · 货号: {item.itemNo || '-'} · 供方: {item.supplier || '-'}
                      </div>
                      {item.notes && (
                        <div className="text-[10px] text-slate-400">备注: {item.notes}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <span className="text-rose-600 font-bold font-mono-numbers block">
                        少发 -{diff} 件
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono-numbers">
                        实收 {item.receivedQty} / 应收 {item.expectedQty}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Price Discrepancies */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>价格异常 / 单价偏离明细 ({priceDiscrepancyItems.length})</span>
            </h3>
            <span className="text-[11px] text-slate-400">发票实开单价与约定单价不符</span>
          </div>

          {priceDiscrepancyItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-lg">
              所有商品实核单价均与基准价格一致
            </div>
          ) : (
            <div className="space-y-2">
              {priceDiscrepancyItems.map((item) => {
                const check = checkPriceDiscrepancy(item, priceBasis);
                const subtotalDiff = (check.diff * item.receivedQty).toFixed(2);
                return (
                  <div
                    key={item.id}
                    onClick={() => onNavigateToItem(item.id)}
                    className="p-2.5 rounded-lg border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 cursor-pointer transition-colors flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-slate-900 line-clamp-1">
                        {item.chineseName || item.name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-numbers">
                        约定基准价: ¥{check.benchmarkPrice.toFixed(2)} → 实核单价: ¥{item.actualBilledPrice.toFixed(2)}
                      </div>
                      {item.notes && (
                        <div className="text-[10px] text-slate-400">备注: {item.notes}</div>
                      )}
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <span className={`font-bold font-mono-numbers block ${check.diff > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {check.diff > 0 ? `+¥${check.diff}` : `-¥${Math.abs(check.diff)}`} / 件
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono-numbers">
                        总差额: {Number(subtotalDiff) > 0 ? `+¥${subtotalDiff}` : `¥${subtotalDiff}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Supplier Quality & Fulfillment Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <h3 className="text-xs font-bold text-slate-900 mb-3">
          按供应商到货履行率统计
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 px-3">供应商名称</th>
                <th className="py-2 px-3 text-center">品类数</th>
                <th className="py-2 px-3 text-right">应送总件数</th>
                <th className="py-2 px-3 text-right">实收到货数</th>
                <th className="py-2 px-3 text-center">破损件数</th>
                <th className="py-2 px-3 text-center">履行达成率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {Object.entries(supplierStats).map(([supplier, stat]) => {
                const rate = stat.expectedQty > 0 ? Math.round((stat.receivedQty / stat.expectedQty) * 100) : 0;
                return (
                  <tr key={supplier} className="hover:bg-slate-50/50">
                    <td className="py-2 px-3 font-semibold text-slate-900">{supplier}</td>
                    <td className="py-2 px-3 text-center font-mono-numbers">{stat.itemsCount} 款</td>
                    <td className="py-2 px-3 text-right font-mono-numbers text-slate-600">{stat.expectedQty}</td>
                    <td className="py-2 px-3 text-right font-mono-numbers font-medium text-slate-900">{stat.receivedQty}</td>
                    <td className="py-2 px-3 text-center font-mono-numbers text-rose-600">{stat.damagedQty}</td>
                    <td className="py-2 px-3 text-center font-mono-numbers">
                      <span className={rate >= 100 ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                        {rate}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
