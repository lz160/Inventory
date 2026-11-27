import React, { useState, useEffect } from 'react';
import { X, Save, AlertTriangle, Check, DollarSign, Package, CheckCheck, Plus, Minus } from 'lucide-react';
import { checkPriceDiscrepancy, calculateItemStatus } from '../utils/reconciliation';
import type { ReceivingChanges, ReceivingLine } from '../modules/receiving/types';

interface ItemDetailDrawerProps {
  item: ReceivingLine;
  onClose: () => void;
  onSave: (item: ReceivingLine, updates: ReceivingChanges) => Promise<boolean>;
  priceBasis: 'discountPrice' | 'unitPrice' | 'unitPrice2';
}

export const ItemDetailDrawer: React.FC<ItemDetailDrawerProps> = ({
  item,
  onClose,
  onSave,
  priceBasis,
}) => {
  const [formData, setFormData] = useState(item);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFormData(item);
  }, [item]);

  // Support ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!saving && e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  const handleChange = <Key extends keyof ReceivingChanges>(field: Key, val: ReceivingChanges[Key]) => {
    setFormData((prev) => ({ ...prev, [field]: val }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const changes: ReceivingChanges = {};
    if (formData.receivedQty !== item.receivedQty) changes.receivedQty = formData.receivedQty;
    if (formData.damagedQty !== item.damagedQty) changes.damagedQty = formData.damagedQty;
    if (formData.actualBilledPrice !== item.actualBilledPrice) changes.actualBilledPrice = formData.actualBilledPrice;
    if (formData.notes !== item.notes) changes.notes = formData.notes;
    if (!Object.keys(changes).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (await onSave(item, changes)) onClose();
    } finally {
      setSaving(false);
    }
  };

  const priceCheck = checkPriceDiscrepancy(formData, priceBasis);
  const status = calculateItemStatus(formData.expectedQty, formData.receivedQty);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/60 backdrop-blur-xs select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-2 overflow-hidden mr-2">
            <span className="font-mono text-xs font-bold px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded shrink-0">
              #{formData.seq}
            </span>
            <h3 className="text-sm font-bold text-slate-900 truncate">
              {formData.chineseName || formData.name}
            </h3>
            {/* Status Badge */}
            {status === 'matched' && (
              <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded shrink-0">
                已齐套
              </span>
            )}
            {status === 'partial' && (
              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded shrink-0">
                部分到货
              </span>
            )}
            {status === 'pending' && (
              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded shrink-0">
                待核验
              </span>
            )}
            {status === 'excess' && (
              <span className="text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded shrink-0">
                超收多送
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
              disabled={saving}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 shrink-0"
            aria-label="关闭详情弹窗"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body (Strictly non-scrollable, fits entirely in view) */}
        <form id="item-detail-form" onSubmit={handleSave} className="p-4 space-y-3 text-xs overflow-hidden">
          {/* Row 1: Core Product Meta Tags (Compact 1-line strip) */}
          <div className="bg-slate-50 px-3 py-2 rounded-lg border border-slate-100 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-600">
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-slate-400">条码:</span>
              <span className="font-mono font-semibold text-slate-800">{formData.barcode || '-'}</span>
            </div>
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-slate-400">货号:</span>
              <span className="font-mono font-semibold text-slate-800">{formData.itemNo || '-'}</span>
            </div>
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-slate-400">供方:</span>
              <span className="text-slate-800 font-medium">{formData.supplier || '-'}</span>
            </div>
          </div>

          {/* Row 2: Price Verification Row (Compact) */}
          <div className="bg-slate-50/80 px-3 py-2 rounded-lg border border-slate-200 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-slate-500 text-[11px]">基准优惠价:</span>
              <strong className="font-mono-numbers text-indigo-700 text-xs">
                ¥{formData.discountPrice.toFixed(2)}
              </strong>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="actual-billed-price-input" className="text-slate-600 text-[11px] font-medium whitespace-nowrap">
                实核单价:
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2 text-slate-400 font-mono-numbers text-xs">¥</span>
                <input
                  id="actual-billed-price-input"
                  type="number"
                  step="0.01"
                  value={formData.actualBilledPrice}
                  onChange={(e) => handleChange('actualBilledPrice', parseFloat(e.target.value) || 0)}
                  className="w-24 pl-5 pr-2 py-1 bg-white border border-slate-300 rounded font-mono-numbers text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {priceCheck.status === 'discrepancy' ? (
                <span className="text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap">
                  {priceCheck.diff > 0 ? `+¥${priceCheck.diff}` : `-¥${Math.abs(priceCheck.diff)}`}
                </span>
              ) : (
                <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap">
                  一致
                </span>
              )}
            </div>
          </div>

          {/* Row 3: Inbound Quantities Stepper (Large Touch Targets for PDA) */}
          <div className="bg-indigo-50/40 p-3 rounded-xl border border-indigo-100 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 font-medium">到货件数核验</span>
              <span className="font-mono-numbers text-slate-700 text-xs">
                应收: <strong className="text-slate-900 text-sm font-bold">{formData.expectedQty}</strong> 件
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              {/* Stepper Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleChange('receivedQty', Math.max(0, formData.receivedQty - 1))}
                  disabled={formData.receivedQty <= 0}
                  className="w-10 h-9 flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-30 text-slate-800 font-bold active:scale-95 shadow-2xs"
                  aria-label="实收数量减1"
                >
                  <Minus className="w-4 h-4" />
                </button>

                <div className="flex flex-col items-center justify-center px-2 py-0.5 bg-white border border-slate-300 rounded-lg min-w-[65px]">
                  <span className="text-[9px] text-slate-400 leading-tight">实收件数</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={formData.receivedQty}
                    onChange={(e) => handleChange('receivedQty', Math.max(0, Number(e.target.value) || 0))}
                    className="w-12 text-center text-sm font-bold font-mono-numbers text-slate-900 bg-transparent focus:outline-none"
                    aria-label="实收数量"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => handleChange('receivedQty', formData.receivedQty + 1)}
                  className="w-10 h-9 flex items-center justify-center rounded-lg border border-indigo-400 bg-indigo-600 text-white font-bold hover:bg-indigo-700 active:scale-95 shadow-2xs"
                  aria-label="实收数量加1"
                >
                  <Plus className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => handleChange('receivedQty', formData.receivedQty + 5)}
                  className="h-9 px-2 flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-mono-numbers text-xs font-semibold active:scale-95"
                  title="加5件"
                >
                  +5
                </button>
              </div>

              {/* Mark Full button */}
              <button
                type="button"
                onClick={() => handleChange('receivedQty', formData.expectedQty)}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-1 active:scale-95 ${
                  formData.receivedQty === formData.expectedQty
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs'
                }`}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>对齐全收</span>
              </button>
            </div>

            {/* Damaged and Notes Row */}
            <div className="pt-2 border-t border-indigo-100/80 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 text-[11px]">残损破损:</span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.damagedQty || 0}
                  onChange={(e) => handleChange('damagedQty', Math.max(0, Number(e.target.value) || 0))}
                  className="w-16 px-2 py-0.5 bg-white border border-slate-300 rounded font-mono-numbers text-xs font-semibold text-rose-700 focus:outline-none"
                  aria-label="残损数量"
                />
              </div>

              <div className="flex-1 flex items-center gap-1.5 max-w-[220px]">
                <input
                  type="text"
                  value={formData.notes || ''}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  placeholder="可输入备注信息..."
                  className="w-full px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400"
                />
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 shrink-0">
          <div className="text-[11px] text-slate-500 font-mono-numbers">
            实收差额:{' '}
            <strong className={formData.receivedQty - formData.expectedQty === 0 ? 'text-emerald-700 font-bold' : formData.receivedQty > formData.expectedQty ? 'text-purple-700 font-bold' : 'text-rose-700 font-bold'}>
              {formData.receivedQty - formData.expectedQty > 0
                ? `+${formData.receivedQty - formData.expectedQty}`
                : formData.receivedQty - formData.expectedQty}{' '}
              件
            </strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
            >
              关闭 (ESC)
            </button>
            <button
              type="submit"
              disabled={saving}
              form="item-detail-form"
              className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 inline-flex items-center gap-1.5 shadow-xs active:scale-95"
            >
              <Save className="w-3.5 h-3.5" />
              <span>保存核验 (Enter)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
