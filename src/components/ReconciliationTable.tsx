import React, { useState } from 'react';
import {
  PurchaseItem,
  calculateItemStatus,
  checkPriceDiscrepancy,
} from '../utils/reconciliation';
import {
  Check,
  AlertTriangle,
  Minus,
  Plus,
  Edit2,
  Trash2,
  Copy,
  ExternalLink,
  CheckCheck,
  PackageCheck,
  HelpCircle,
} from 'lucide-react';

interface ReconciliationTableProps {
  items: PurchaseItem[];
  priceBasis: 'discountPrice' | 'unitPrice' | 'unitPrice2';
  onUpdateItem: (id: string, updates: Partial<PurchaseItem>) => void;
  onDeleteItem: (id: string) => void;
  onSelectItemForDetail: (item: PurchaseItem) => void;
  highlightedItemId: string | null;
}

export const ReconciliationTable: React.FC<ReconciliationTableProps> = ({
  items,
  priceBasis,
  onUpdateItem,
  onDeleteItem,
  onSelectItemForDetail,
  highlightedItemId,
}) => {
  const [copiedBarcode, setCopiedBarcode] = useState<string | null>(null);

  const handleCopyBarcode = (barcode: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(barcode);
    setCopiedBarcode(barcode);
    setTimeout(() => setCopiedBarcode(null), 1500);
  };

  const handleStepQty = (item: PurchaseItem, delta: number) => {
    const nextQty = Math.max(0, item.receivedQty + delta);
    onUpdateItem(item.id, { receivedQty: nextQty });
  };

  const handleMarkAllReceived = (item: PurchaseItem) => {
    onUpdateItem(item.id, { receivedQty: item.expectedQty });
  };

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-xs">
        <PackageCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <h3 className="text-base font-semibold text-slate-900">未找到符合条件的进货商品</h3>
        <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
          请调整上方的过滤条件，或点击右上角“导入进货单”添加新的采购商品。
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-500 font-medium">
              <th className="py-3 px-3 w-12 text-center">序号</th>
              <th className="py-3 px-3 min-w-[170px]">品名 / 原名</th>
              <th className="py-3 px-3 min-w-[140px]">中文规格</th>
              <th className="py-3 px-3 min-w-[120px]">条码 / 货号</th>
              <th className="py-3 px-3 text-right">单价</th>
              <th className="py-3 px-3 text-right">优惠价</th>
              <th className="py-3 px-3 text-right">单价2</th>
              <th className="py-3 px-3 text-center min-w-[110px] bg-slate-100/70 font-semibold text-slate-700">
                应收 / 实收数量
              </th>
              <th className="py-3 px-3 text-center w-24">残损破损</th>
              <th className="py-3 px-3 min-w-[140px] bg-slate-100/70 font-semibold text-slate-700">
                实核单价 & 比对
              </th>
              <th className="py-3 px-3 text-center w-24">到货状态</th>
              <th className="py-3 px-3 min-w-[120px]">供应商</th>
              <th className="py-3 px-3 min-w-[160px]">核验备注</th>
              <th className="py-3 px-3 text-center w-20">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {items.map((item) => {
              const status = calculateItemStatus(item.expectedQty, item.receivedQty);
              const priceCheck = checkPriceDiscrepancy(item, priceBasis);
              const isHighlighted = highlightedItemId === item.id;
              const isQtyMismatch = item.receivedQty !== item.expectedQty;

              return (
                <tr
                  key={item.id}
                  id={`item-row-${item.id}`}
                  className={`hover:bg-slate-50/80 transition-colors ${
                    isHighlighted
                      ? 'bg-indigo-50/70 ring-1 ring-inset ring-indigo-400'
                      : ''
                  }`}
                >
                  {/* 1. 序号 */}
                  <td className="py-3 px-3 text-center font-mono-numbers text-slate-400">
                    {item.seq}
                  </td>

                  {/* 2. 品名 */}
                  <td className="py-3 px-3">
                    <div className="font-medium text-slate-900 line-clamp-2 max-w-[220px]" title={item.name}>
                      {item.name}
                    </div>
                  </td>

                  {/* 3. 中文 */}
                  <td className="py-3 px-3">
                    <span className="text-slate-800 line-clamp-2 max-w-[180px]" title={item.chineseName}>
                      {item.chineseName || '-'}
                    </span>
                  </td>

                  {/* 4. 条码 & 货号 */}
                  <td className="py-3 px-3">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="font-mono-numbers text-slate-800 font-medium tracking-tight">
                          {item.barcode || '-'}
                        </span>
                        {item.barcode && (
                          <button
                            onClick={(e) => handleCopyBarcode(item.barcode, e)}
                            className="text-slate-400 hover:text-slate-600 p-0.5"
                            title="复制条码"
                            aria-label={`复制条形码 ${item.barcode}`}
                          >
                            {copiedBarcode === item.barcode ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono-numbers">
                        货号: {item.itemNo || '-'}
                      </div>
                    </div>
                  </td>

                  {/* 5. 单价 */}
                  <td className="py-3 px-3 text-right font-mono-numbers text-slate-500">
                    ¥{item.unitPrice.toFixed(2)}
                  </td>

                  {/* 6. 优惠价 */}
                  <td className="py-3 px-3 text-right font-mono-numbers font-medium text-slate-900">
                    ¥{item.discountPrice.toFixed(2)}
                  </td>

                  {/* 7. 单价2 */}
                  <td className="py-3 px-3 text-right font-mono-numbers text-slate-500">
                    ¥{item.unitPrice2.toFixed(2)}
                  </td>

                  {/* 8. 应收 / 实收数量 (核心核验区) */}
                  <td className="py-2.5 px-3 bg-slate-50/50">
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleStepQty(item, -1)}
                          disabled={item.receivedQty <= 0}
                          className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white text-slate-700"
                          title="实收减1"
                          aria-label={`实收减1 ${item.name}`}
                        >
                          <Minus className="w-3 h-3" />
                        </button>

                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={item.receivedQty}
                          onChange={(e) => {
                            const val = Math.max(0, Number(e.target.value) || 0);
                            onUpdateItem(item.id, { receivedQty: val });
                          }}
                          className={`w-14 text-center py-1 font-mono-numbers font-bold text-sm rounded border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                            isQtyMismatch
                              ? item.receivedQty === 0
                                ? 'bg-amber-50/50 border-amber-300 text-amber-900'
                                : item.receivedQty > item.expectedQty
                                ? 'bg-purple-50 border-purple-300 text-purple-900'
                                : 'bg-indigo-50 border-indigo-200 text-indigo-900'
                              : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                          }`}
                          aria-label={`实收数量 ${item.name}`}
                        />

                        <button
                          onClick={() => handleStepQty(item, 1)}
                          className="w-6 h-6 flex items-center justify-center rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-700"
                          title="实收加1"
                          aria-label={`实收加1 ${item.name}`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <div className="flex items-center justify-between w-full text-[11px] px-1 text-slate-500 font-mono-numbers">
                        <span>应收: {item.expectedQty}</span>
                        {item.receivedQty !== item.expectedQty && (
                          <button
                            onClick={() => handleMarkAllReceived(item)}
                            className="text-indigo-600 hover:text-indigo-800 text-[10px] underline ml-1"
                            title="一键实收到齐"
                          >
                            对齐应收
                          </button>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* 9. 破损数量 */}
                  <td className="py-2.5 px-3 text-center">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={item.damagedQty || 0}
                      onChange={(e) => {
                        const val = Math.max(0, Number(e.target.value) || 0);
                        onUpdateItem(item.id, { damagedQty: val });
                      }}
                      className={`w-12 text-center py-1 font-mono-numbers text-xs rounded border focus:outline-none focus:ring-1 focus:ring-rose-500 ${
                        (item.damagedQty || 0) > 0
                          ? 'bg-rose-50 border-rose-300 text-rose-700 font-semibold'
                          : 'bg-white border-slate-200 text-slate-600'
                      }`}
                      aria-label={`破损数量 ${item.name}`}
                    />
                  </td>

                  {/* 10. 实核单价 & 价格比对 */}
                  <td className="py-2.5 px-3 bg-slate-50/50">
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="text-slate-400 font-mono">¥</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={item.actualBilledPrice}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            onUpdateItem(item.id, { actualBilledPrice: val });
                          }}
                          className={`w-20 px-1.5 py-0.5 font-mono-numbers text-xs rounded border text-right focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                            priceCheck.status === 'discrepancy'
                              ? 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                              : 'bg-white border-slate-200 text-slate-800'
                          }`}
                          aria-label={`实核单价 ${item.name}`}
                        />
                      </div>

                      {/* 价格偏差说明 */}
                      {priceCheck.status === 'discrepancy' ? (
                        <div className="text-[10px] text-amber-700 font-mono-numbers flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                          <span>
                            差额: {priceCheck.diff > 0 ? `+¥${priceCheck.diff}` : `-¥${Math.abs(priceCheck.diff)}`} ({priceCheck.diffPercent}%)
                          </span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-emerald-600 font-mono-numbers flex items-center gap-1">
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span>与基准价一致</span>
                        </div>
                      )}
                    </div>
                  </td>

                  {/* 11. 到货状态 */}
                  <td className="py-3 px-3 text-center">
                    {status === 'matched' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-medium">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>已齐套</span>
                      </span>
                    )}
                    {status === 'partial' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-indigo-700 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                        <span>部分到货</span>
                      </span>
                    )}
                    {status === 'pending' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                        <span>待核验</span>
                      </span>
                    )}
                    {status === 'excess' && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-purple-700 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 text-purple-600" />
                        <span>超收</span>
                      </span>
                    )}
                  </td>

                  {/* 12. 供应商 */}
                  <td className="py-3 px-3 text-slate-600 max-w-[130px] truncate" title={item.supplier}>
                    {item.supplier || '-'}
                  </td>

                  {/* 13. 核验备注 (可直接输入或打标签) */}
                  <td className="py-2.5 px-3">
                    <input
                      type="text"
                      value={item.notes || ''}
                      onChange={(e) => onUpdateItem(item.id, { notes: e.target.value })}
                      placeholder="添加核对备注 (破损/多送/补发等)..."
                      className="w-full text-xs px-2 py-1 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors text-slate-700 placeholder:text-slate-400"
                      aria-label={`核对备注 ${item.name}`}
                    />
                  </td>

                  {/* 14. 操作 */}
                  <td className="py-3 px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onSelectItemForDetail(item)}
                        className="p-1 text-slate-400 hover:text-indigo-600 rounded hover:bg-slate-100 transition-colors"
                        title="查看/编辑完整明细"
                        aria-label={`查看详情 ${item.name}`}
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => onDeleteItem(item.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                        title="删除该行"
                        aria-label={`删除 ${item.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
