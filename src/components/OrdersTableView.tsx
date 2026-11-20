import React from 'react';
import { PurchaseOrder, isOrderCompleted, sortPurchaseOrders } from '../utils/reconciliation';
import { ExportDropdown } from './ExportDropdown';
import {
  FileText,
  Download,
  ArrowRight,
  Plus,
  CheckCircle2,
  Clock,
  AlertCircle,
  PackageCheck,
  Building2,
  Calendar,
} from 'lucide-react';

interface OrdersTableViewProps {
  orders: PurchaseOrder[];
  onSelectOrder: (order: PurchaseOrder) => void;
  onExportOrderPos: (order: PurchaseOrder) => void;
  onExportOrderAudit: (order: PurchaseOrder) => void;
  onAddNewOrder: () => void;
  onDeleteOrder: (orderId: string) => void;
}

export const OrdersTableView: React.FC<OrdersTableViewProps> = ({
  orders,
  onSelectOrder,
  onExportOrderPos,
  onExportOrderAudit,
  onAddNewOrder,
  onDeleteOrder,
}) => {
  const sortedOrders = sortPurchaseOrders(orders);
  const uncompletedCount = orders.filter((o) => !isOrderCompleted(o)).length;

  const [mobileViewMode, setMobileViewMode] = React.useState<'cards' | 'table'>('cards');

  return (
    <div className="space-y-4">
      {/* Top Header Summary Strip */}
      <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="w-full sm:w-auto">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm sm:text-base font-bold text-slate-900">需要核对的进货单列表</h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              待核对未完成: {uncompletedCount}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 mt-1">
            排序规则：未完成在上面，已完成在下面（按完成时间早到晚排序）。点击货单直接转跳对应货物信息。
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          {/* Mobile view switch (only on small screens < 640px) */}
          <div className="sm:hidden flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setMobileViewMode('cards')}
              className={`px-2 py-1 rounded font-medium transition-colors ${
                mobileViewMode === 'cards'
                  ? 'bg-white text-indigo-700 font-bold shadow-2xs'
                  : 'text-slate-600'
              }`}
            >
              PDA卡片
            </button>
            <button
              type="button"
              onClick={() => setMobileViewMode('table')}
              className={`px-2 py-1 rounded font-medium transition-colors ${
                mobileViewMode === 'table'
                  ? 'bg-white text-indigo-700 font-bold shadow-2xs'
                  : 'text-slate-600'
              }`}
            >
              横向表格
            </button>
          </div>

          <button
            type="button"
            onClick={onAddNewOrder}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-2xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span>新建/导入新货单</span>
          </button>
        </div>
      </div>

      {/* MOBILE PDA CARD VIEW: Optimized for Handheld Screens (< 640px) */}
      {mobileViewMode === 'cards' && (
        <div className="sm:hidden space-y-3">
          {sortedOrders.map((order) => {
            const isDone = isOrderCompleted(order);
            const totalExpected = order.items.reduce((s, it) => s + it.expectedQty, 0);
            const totalReceived = order.items.reduce((s, it) => s + it.receivedQty, 0);
            const diffQty = totalReceived - totalExpected;
            const matchedItemCount = order.items.filter((it) => it.receivedQty >= it.expectedQty).length;
            const progressPct =
              totalExpected > 0 ? Math.min(100, Math.round((totalReceived / totalExpected) * 100)) : 0;

            return (
              <div
                key={order.id}
                onClick={() => onSelectOrder(order)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  !isDone
                    ? 'bg-white border-amber-200/90 shadow-xs hover:border-indigo-300'
                    : 'bg-white border-slate-200/90 shadow-2xs'
                }`}
              >
                {/* Top: Status & Title */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      <h3 className="text-sm font-bold text-slate-900 truncate">
                        {order.title}
                      </h3>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>供方: {order.supplier || '未填'}</span>
                      <span className="text-slate-300">·</span>
                      <span>建单: {order.createdAt}</span>
                    </div>
                  </div>

                  <div className="shrink-0">
                    {isDone ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                        已完成齐套
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                        待清点
                      </span>
                    )}
                  </div>
                </div>

                {/* Middle: Counts & Progress */}
                <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 my-2.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono-numbers">
                    <span className="text-slate-600">
                      进度: <strong className={isDone ? 'text-emerald-700' : 'text-indigo-600'}>{progressPct}%</strong>
                      <span className="text-slate-400 font-normal ml-1">({matchedItemCount}/{order.items.length}款齐套)</span>
                    </span>
                    <span className="text-slate-800">
                      实收 <strong className="font-bold text-slate-900">{totalReceived}</strong> / {totalExpected} 件
                      {diffQty !== 0 && (
                        <span className={`ml-1 text-[11px] font-semibold ${diffQty > 0 ? 'text-purple-600' : 'text-rose-600'}`}>
                          ({diffQty > 0 ? `+${diffQty}` : diffQty})
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isDone ? 'bg-emerald-500' : 'bg-indigo-600'
                      }`}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>

                  {order.completedAt && (
                    <div className="text-[10px] text-slate-400 font-mono-numbers">
                      完成时间: {order.completedAt}
                    </div>
                  )}
                </div>

                {/* Bottom: Touch Button to Drill-in */}
                <div className="flex items-center justify-between pt-1 gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectOrder(order);
                    }}
                    className="flex-1 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>点击进入核验货物 ({order.items.length}款)</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  <div onClick={(e) => e.stopPropagation()}>
                    <ExportDropdown
                      onExportPos={() => onExportOrderPos(order)}
                      onExportAudit={() => onExportOrderAudit(order)}
                      variant="icon-only"
                      align="right"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* FULL TABLE VIEW: Always displayed on sm+ screens (1280x720 & Desktop), or when toggled on mobile */}
      <div className={`${mobileViewMode === 'cards' ? 'hidden sm:block' : 'block'} bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse min-w-[560px]">
            <thead>
              <tr className="bg-slate-50/80 text-slate-600 border-b border-slate-200 font-semibold select-none">
                <th className="py-3 px-3 text-center w-12">状态</th>
                <th className="py-3 px-3">货单名称 / 批次</th>
                <th className="py-3 px-3">供应商</th>
                <th className="py-3 px-3 text-center">品类种类</th>
                <th className="py-3 px-3 text-right">应收件数</th>
                <th className="py-3 px-3 text-right">实收件数</th>
                <th className="py-3 px-3 text-center w-24">核对进度</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedOrders.map((order) => {
                const isDone = isOrderCompleted(order);
                const totalExpected = order.items.reduce((s, it) => s + it.expectedQty, 0);
                const totalReceived = order.items.reduce((s, it) => s + it.receivedQty, 0);
                const diffQty = totalReceived - totalExpected;
                const matchedItemCount = order.items.filter((it) => it.receivedQty >= it.expectedQty).length;
                const progressPct =
                  totalExpected > 0 ? Math.min(100, Math.round((totalReceived / totalExpected) * 100)) : 0;

                return (
                  <tr
                    key={order.id}
                    onClick={() => onSelectOrder(order)}
                    className={`cursor-pointer transition-colors group ${
                      !isDone
                        ? 'bg-amber-50/20 hover:bg-indigo-50/50'
                        : 'bg-white hover:bg-slate-50'
                    }`}
                  >
                    {/* Status Icon */}
                    <td className="py-3 px-3 text-center">
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" />
                      ) : (
                        <Clock className="w-4 h-4 text-amber-600 mx-auto" />
                      )}
                    </td>

                    {/* Order Title */}
                    <td className="py-3 px-3 font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[220px]" title={order.title}>
                          {order.title}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-normal mt-0.5 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <span>建单: {order.createdAt}</span>
                      </div>
                    </td>

                    {/* Supplier */}
                    <td className="py-3 px-3 text-slate-700">
                      <div className="flex items-center gap-1">
                        <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[140px]">{order.supplier || '未填'}</span>
                      </div>
                    </td>

                    {/* Item count */}
                    <td className="py-3 px-3 text-center font-mono-numbers text-slate-800 font-medium">
                      {order.items.length} 款
                      <div className="text-[10px] text-slate-400 font-normal">
                        ({matchedItemCount} 款齐套)
                      </div>
                    </td>

                    {/* Expected Qty */}
                    <td className="py-3 px-3 text-right font-mono-numbers font-medium text-slate-700">
                      {totalExpected} 件
                    </td>

                    {/* Received Qty */}
                    <td className="py-3 px-3 text-right font-mono-numbers font-bold text-slate-900">
                      {totalReceived} 件
                      {diffQty !== 0 && (
                        <div
                          className={`text-[10px] font-medium ${
                            diffQty > 0 ? 'text-purple-600' : 'text-rose-600'
                          }`}
                        >
                          {diffQty > 0 ? `+${diffQty}` : diffQty} 件
                        </div>
                      )}
                    </td>

                    {/* Circular Progress Ring */}
                    <td className="py-3 px-3 text-center">
                      <div className="inline-flex items-center justify-center relative w-10 h-10 mx-auto">
                        <svg className="w-10 h-10 -rotate-90 transform" viewBox="0 0 36 36">
                          <circle
                            cx="18"
                            cy="18"
                            r="14"
                            className="text-slate-100"
                            strokeWidth="3.5"
                            stroke="currentColor"
                            fill="transparent"
                          />
                          <circle
                            cx="18"
                            cy="18"
                            r="14"
                            className={`transition-all duration-500 ${
                              isDone ? 'text-emerald-500' : 'text-indigo-600'
                            }`}
                            strokeWidth="3.5"
                            strokeDasharray={87.96}
                            strokeDashoffset={87.96 - (Math.min(100, Math.max(0, progressPct)) / 100) * 87.96}
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="transparent"
                          />
                        </svg>
                        <span
                          className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold font-mono-numbers ${
                            isDone ? 'text-emerald-700' : 'text-slate-800'
                          }`}
                        >
                          {progressPct}%
                        </span>
                      </div>
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
