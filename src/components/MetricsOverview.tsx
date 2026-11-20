import React from 'react';
import { OrderMetrics } from '../utils/reconciliation';
import { CheckCircle2, AlertTriangle, PackageX, DollarSign, ArrowUpDown } from 'lucide-react';

interface MetricsOverviewProps {
  metrics: OrderMetrics;
  priceBasis: 'discountPrice' | 'unitPrice' | 'unitPrice2';
  onChangePriceBasis: (basis: 'discountPrice' | 'unitPrice' | 'unitPrice2') => void;
  activeFilter: 'all' | 'discrepancy' | 'pending' | 'partial' | 'matched';
  onChangeFilter: (filter: 'all' | 'discrepancy' | 'pending' | 'partial' | 'matched') => void;
}

export const MetricsOverview: React.FC<MetricsOverviewProps> = ({
  metrics,
  priceBasis,
  onChangePriceBasis,
  activeFilter,
  onChangeFilter,
}) => {
  const priceBasisLabel = {
    discountPrice: '优惠价 (优先)',
    unitPrice: '单价',
    unitPrice2: '单价2 (备用/含税)',
  }[priceBasis];

  return (
    <div className="space-y-4">
      {/* 4-KPI Grid: 2x2 on Mobile/PDA, 4-in-line on 1280x720 & Desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* KPI 1: 总体核对进度与种类 */}
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">品类核对进度</span>
            <span className="text-xs font-mono-numbers font-semibold text-indigo-600">
              {metrics.progressPercent}%
            </span>
          </div>

          <div className="my-2.5">
            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
              <div
                className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, metrics.progressPercent)}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>
              已齐套 <strong className="font-mono-numbers text-slate-900">{metrics.matchedItems}</strong> / {metrics.totalItems} 种
            </span>
            <span className="text-slate-400">·</span>
            <span>
              未到 <strong className="font-mono-numbers text-slate-900">{metrics.pendingItems}</strong> 种
            </span>
          </div>
        </div>

        {/* KPI 2: 到货件数与差异核对 */}
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">数量核对 (件数)</span>
            <span className="text-xs text-slate-400">实收 / 应收</span>
          </div>

          <div className="my-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono-numbers text-slate-900">
              {metrics.totalReceivedQty}
            </span>
            <span className="text-sm font-mono-numbers text-slate-400">
              / {metrics.totalExpectedQty} 件
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
            <span className={metrics.qtyDifference === 0 ? 'text-slate-500' : metrics.qtyDifference > 0 ? 'text-amber-600 font-medium' : 'text-rose-600 font-medium'}>
              差异: <span className="font-mono-numbers">{metrics.qtyDifference > 0 ? `+${metrics.qtyDifference}` : metrics.qtyDifference}</span> 件
            </span>
            {metrics.totalDamagedQty > 0 && (
              <span className="text-rose-600 font-medium font-mono-numbers">
                残损: {metrics.totalDamagedQty} 件
              </span>
            )}
          </div>
        </div>

        {/* KPI 3: 采购金额与实核偏差 */}
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">实核入库金额</span>
            <span className="text-xs text-slate-400">应付: ¥{metrics.totalExpectedAmount.toLocaleString()}</span>
          </div>

          <div className="my-1 flex items-baseline gap-1">
            <span className="text-xs text-slate-500">¥</span>
            <span className="text-2xl font-bold font-mono-numbers text-slate-900">
              {metrics.totalActualAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
            <span className={metrics.amountDifference === 0 ? 'text-slate-500' : metrics.amountDifference > 0 ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>
              金额差: <span className="font-mono-numbers">{metrics.amountDifference > 0 ? `+¥${metrics.amountDifference.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : metrics.amountDifference < 0 ? `-¥${Math.abs(metrics.amountDifference).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '¥0.00'}</span>
            </span>
            <span className="text-xs text-slate-400">
              基准: {priceBasis === 'discountPrice' ? '优惠价' : priceBasis === 'unitPrice' ? '单价' : '单价2'}
            </span>
          </div>
        </div>

        {/* KPI 4: 异常与关注重点 */}
        <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">异常核实提示</span>
            <span className="text-xs text-slate-400">
              {metrics.priceDiscrepancyCount + (metrics.qtyDifference !== 0 ? 1 : 0)} 项提示
            </span>
          </div>

          <div className="my-1.5 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${metrics.priceDiscrepancyCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span className="text-xs text-slate-700">
                价格异常: <strong className="font-mono-numbers text-slate-900">{metrics.priceDiscrepancyCount}</strong> 款
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${metrics.excessItems > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} />
              <span className="text-xs text-slate-700">
                超收: <strong className="font-mono-numbers text-slate-900">{metrics.excessItems}</strong> 款
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 text-slate-500">
            <span>
              部分到货: <strong className="font-mono-numbers text-slate-800">{metrics.partialItems}</strong> 款
            </span>
            <span>
              破损品类: <strong className="font-mono-numbers text-slate-800">{metrics.totalDamagedQty > 0 ? '有' : '无'}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Control Bar: Filters & Price Basis Setting */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs">
        {/* Interactive Filter Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-100/90 rounded-lg overflow-x-auto">
          <button
            onClick={() => onChangeFilter('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            全部品类 ({metrics.totalItems})
          </button>
          <button
            onClick={() => onChangeFilter('discrepancy')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeFilter === 'discrepancy'
                ? 'bg-white text-rose-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            异常与差异 ({metrics.partialItems + metrics.pendingItems + metrics.excessItems + metrics.priceDiscrepancyCount})
          </button>
          <button
            onClick={() => onChangeFilter('pending')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeFilter === 'pending'
                ? 'bg-white text-amber-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            未到货 ({metrics.pendingItems})
          </button>
          <button
            onClick={() => onChangeFilter('partial')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeFilter === 'partial'
                ? 'bg-white text-indigo-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            部分到货 ({metrics.partialItems})
          </button>
          <button
            onClick={() => onChangeFilter('matched')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              activeFilter === 'matched'
                ? 'bg-white text-emerald-700 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            已齐套 ({metrics.matchedItems})
          </button>
        </div>

        {/* Price Basis Selector */}
        <div className="flex items-center gap-2 self-end sm:self-auto px-2">
          <label htmlFor="price-basis-select" className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-1">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <span>价格核对基准:</span>
          </label>
          <select
            id="price-basis-select"
            value={priceBasis}
            onChange={(e) => onChangePriceBasis(e.target.value as any)}
            className="text-xs bg-slate-50 border border-slate-200 text-slate-800 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
          >
            <option value="discountPrice">按【优惠价】比对 (默认推荐)</option>
            <option value="unitPrice">按【单价】比对</option>
            <option value="unitPrice2">按【单价2】比对 (备用/含税)</option>
          </select>
        </div>
      </div>
    </div>
  );
};
