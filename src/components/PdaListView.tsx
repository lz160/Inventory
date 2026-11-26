import React, { useState } from 'react';
import { calculateItemStatus, checkPriceDiscrepancy } from '../utils/reconciliation';
import type { ReceivingChanges, ReceivingLine } from '../modules/receiving/types';
import { Check, Minus, Plus, CheckCheck, AlertTriangle, ExternalLink, Package, FileText } from 'lucide-react';

interface PdaListViewProps {
  items: ReceivingLine[];
  priceBasis: 'discountPrice' | 'unitPrice' | 'unitPrice2';
  onUpdateItem: (item: ReceivingLine, updates: ReceivingChanges) => Promise<boolean>;
  onAdjustQuantity: (id: string, delta: number) => void;
  onSelectItemForDetail: (item: ReceivingLine) => void;
  highlightedItemId: string | null;
}

export const PdaListView: React.FC<PdaListViewProps> = ({
  items,
  priceBasis,
  onUpdateItem,
  onAdjustQuantity,
  onSelectItemForDetail,
  highlightedItemId,
}) => {
  const handleMarkAll = (item: ReceivingLine) => {
    void onUpdateItem(item, { receivedQty: item.expectedQty });
  };

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
        <Package className="w-10 h-10 text-slate-300 mx-auto mb-2" />
        <p className="text-sm font-semibold text-slate-800">暂无符合条件的商品</p>
        <p className="text-xs text-slate-400 mt-1">请扫码或检查上方单据勾选与过滤状态</p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const status = calculateItemStatus(item.expectedQty, item.receivedQty);
        const priceCheck = checkPriceDiscrepancy(item, priceBasis);
        const isHighlighted = highlightedItemId === item.id;
        const diffQty = item.receivedQty - item.expectedQty;

        return (
          <div
            key={item.id}
            id={`pda-item-${item.id}`}
            className={`bg-white rounded-xl border p-3 transition-all ${
              isHighlighted
                ? 'border-indigo-500 ring-2 ring-indigo-400/50 bg-indigo-50/40 shadow-md'
                : 'border-slate-200/90 shadow-2xs hover:border-slate-300'
            }`}
          >
            {/* Top row: Order badge, seq, barcode, and status */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2 mb-2 text-xs">
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="font-mono text-slate-400 font-bold shrink-0">
                  #{item.seq}
                </span>
                {item.orderTitle && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 truncate max-w-[130px]" title={item.orderTitle}>
                    {item.orderTitle}
                  </span>
                )}
                <span className="font-mono-numbers text-slate-600 font-medium text-[11px] truncate">
                  {item.barcode || item.itemNo}
                </span>
              </div>

              {/* Status Badge */}
              <div className="shrink-0">
                {status === 'matched' && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>已齐套</span>
                  </span>
                )}
                {status === 'partial' && (
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                    部分 ({item.receivedQty}/{item.expectedQty})
                  </span>
                )}
                {status === 'pending' && (
                  <span className="text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                    未到 (待验)
                  </span>
                )}
                {status === 'excess' && (
                  <span className="text-[11px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>超收 +{diffQty}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Middle row: Product name & price info */}
            <div className="flex items-start justify-between gap-2 mb-3">
              <div
                onClick={() => onSelectItemForDetail(item)}
                className="cursor-pointer group flex-1"
              >
                <h4 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors leading-snug line-clamp-1">
                  {item.chineseName || item.name}
                </h4>
                {item.chineseName && item.name !== item.chineseName && (
                  <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                    {item.name}
                  </p>
                )}
                <div className="text-[11px] text-slate-500 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>货号: <strong className="font-mono text-slate-700">{item.itemNo || '-'}</strong></span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono-numbers">优惠价: <strong className="text-indigo-700">¥{item.discountPrice.toFixed(2)}</strong></span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono-numbers text-slate-400">单价: ¥{item.unitPrice.toFixed(2)}</span>
                  <span className="text-slate-300">·</span>
                  <span className="font-mono-numbers text-slate-400">单价2: ¥{item.unitPrice2.toFixed(2)}</span>
                  <span className="text-slate-300">·</span>
                  <span className="text-slate-500">供应商: {item.supplier || '-'}</span>
                  {priceCheck.status === 'discrepancy' && (
                    <span className="text-amber-700 font-semibold font-mono-numbers bg-amber-50 border border-amber-200/60 px-1.5 py-0.2 rounded ml-1">
                      实核: ¥{item.actualBilledPrice.toFixed(2)} ({priceCheck.diff > 0 ? `+¥${priceCheck.diff}` : `-¥${Math.abs(priceCheck.diff)}`})
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSelectItemForDetail(item)}
                className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 shrink-0 self-center"
                title="打开商品详情窗口"
                aria-label={`打开商品详情 ${item.chineseName || item.name}`}
              >
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>

            {/* Bottom row: Big Touch Buttons for PDA Stepper Operation */}
            <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200/80">
              {/* Stepper Group */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onAdjustQuantity(item.id, -1)}
                  disabled={item.receivedQty <= 0}
                  className="w-10 h-10 flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white text-slate-800 font-bold active:scale-95 shadow-2xs"
                  aria-label={`实收减1 ${item.name}`}
                >
                  <Minus className="w-4 h-4" />
                </button>

                <div className="flex flex-col items-center justify-center px-3 py-1 bg-white border border-slate-300 rounded-lg min-w-[70px]">
                  <span className="text-[10px] text-slate-400 leading-tight">实收件数</span>
                  <ReceivedQuantityInput item={item} onUpdateItem={onUpdateItem} />
                </div>

                <button
                  type="button"
                  onClick={() => onAdjustQuantity(item.id, 1)}
                  className="w-10 h-10 flex items-center justify-center rounded-lg border border-indigo-300 bg-indigo-600 text-white font-bold hover:bg-indigo-700 active:scale-95 shadow-2xs"
                  aria-label={`实收加1 ${item.name}`}
                >
                  <Plus className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => onAdjustQuantity(item.id, 5)}
                  className="h-10 px-2.5 flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-mono-numbers text-xs font-semibold active:scale-95"
                  title="加5件"
                >
                  +5
                </button>
              </div>

              {/* Expected and Align Button */}
              <div className="text-right flex flex-col items-end gap-1">
                <div className="text-xs text-slate-500 font-mono-numbers">
                  应收: <strong className="text-slate-900 text-sm">{item.expectedQty}</strong> 件
                </div>

                {item.receivedQty !== item.expectedQty && (
                  <button
                    type="button"
                    onClick={() => handleMarkAll(item)}
                    className="px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-indigo-100 hover:bg-indigo-200 rounded-md transition-colors flex items-center gap-1 active:scale-95"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>对齐全收</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

function ReceivedQuantityInput({
  item, onUpdateItem,
}: {
  item: ReceivingLine;
  onUpdateItem: PdaListViewProps['onUpdateItem'];
}) {
  const [draft, setDraft] = useState<{ value: string; item: ReceivingLine } | null>(null);
  return (
    <input
      type="number"
      min="0"
      step="any"
      value={draft?.value ?? item.receivedQty}
      onFocus={() => setDraft({ value: String(item.receivedQty), item })}
      onChange={(e) => setDraft({ value: e.target.value, item: draft?.item ?? item })}
      onBlur={() => {
        if (!draft) return;
        const quantity = Math.max(0, Number(draft.value));
        if (Number.isFinite(quantity) && quantity !== draft.item.receivedQty) {
          void onUpdateItem(draft.item, { receivedQty: quantity });
        }
        setDraft(null);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className="w-12 text-center text-base font-bold font-mono-numbers text-slate-900 bg-transparent focus:outline-none"
      aria-label={`实收数量 ${item.name}`}
    />
  );
}
