import React, { useState, useRef, useEffect } from 'react';
import { Scan, CornerDownLeft, Check, AlertCircle } from 'lucide-react';
import { PurchaseItem } from '../utils/reconciliation';

interface QuickScanViewProps {
  items: PurchaseItem[];
  onScanMatch: (item: PurchaseItem, stepQty: number) => void;
  onOpenItemModal: (item: PurchaseItem) => void;
  lastScannedItem: { item: PurchaseItem; message: string; timestamp: number } | null;
  onBackToOrders?: () => void;
}

export const QuickScanView: React.FC<QuickScanViewProps> = ({
  items,
  onScanMatch,
  onOpenItemModal,
  lastScannedItem,
  onBackToOrders,
}) => {
  const [query, setQuery] = useState('');
  const [matchError, setMatchError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto focus input on mount & global shortcut
  useEffect(() => {
    inputRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleExecuteScan = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return;

    // Exact barcode match first
    const exactBarcode = items.find(
      (it) => it.barcode && it.barcode.toLowerCase() === cleanQuery
    );
    if (exactBarcode) {
      onScanMatch(exactBarcode, 1);
      onOpenItemModal(exactBarcode);
      setMatchError(null);
      setQuery('');
      return;
    }

    // Exact itemNo match
    const exactItemNo = items.find(
      (it) => it.itemNo && it.itemNo.toLowerCase() === cleanQuery
    );
    if (exactItemNo) {
      onScanMatch(exactItemNo, 1);
      onOpenItemModal(exactItemNo);
      setMatchError(null);
      setQuery('');
      return;
    }

    // Fuzzy match across chineseName, name, barcode, itemNo
    const matched = items.filter((it) => {
      const matchBarcode = it.barcode && it.barcode.toLowerCase().includes(cleanQuery);
      const matchItemNo = it.itemNo && it.itemNo.toLowerCase().includes(cleanQuery);
      const matchName = it.name && it.name.toLowerCase().includes(cleanQuery);
      const matchChinese = it.chineseName && it.chineseName.toLowerCase().includes(cleanQuery);
      return matchBarcode || matchItemNo || matchName || matchChinese;
    });

    if (matched.length > 0) {
      // Pick first match (or priority to uncompleted item)
      const target = matched.find((it) => it.receivedQty < it.expectedQty) || matched[0];
      onScanMatch(target, 1);
      onOpenItemModal(target);
      setMatchError(null);
      setQuery('');
    } else {
      setMatchError(`未找到条码、货号或品名包含 "${query.trim()}" 的商品`);
      setTimeout(() => setMatchError(null), 3500);
    }
  };

  return (
    <div className="h-[calc(100vh-7rem)] max-h-[calc(100vh-7rem)] overflow-hidden flex flex-col justify-between relative w-full pb-20 select-none">
      {/* div:nth-of-type(1): Top Header & Center Feedback Area */}
      <div className="w-full flex flex-col flex-1 overflow-hidden">
        {/* Top Header */}
        <div className="w-full flex items-center justify-center sm:justify-end gap-2 mb-2 shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/60">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              <span>极速扫码激活</span>
            </span>
            <span className="text-[11px] text-slate-400">
              共 {items.length} 款
            </span>
          </div>
        </div>

        {/* Center Display / Scan Results (Strictly no scrolling needed) */}
        <div className="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto w-full text-center px-4 my-auto overflow-hidden">
          {matchError ? (
            <div className="w-full text-xs text-rose-600 bg-rose-50 border border-rose-200 p-3.5 rounded-xl flex items-center gap-2.5 text-left shadow-xs">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <div className="overflow-hidden">
                <p className="font-semibold truncate">{matchError}</p>
                <p className="text-[10px] text-rose-500 mt-0.5">请核对条码或直接输入货号/品名，回车重试</p>
              </div>
            </div>
          ) : lastScannedItem ? (
            <div className="w-full bg-white border border-indigo-200 p-4 rounded-xl shadow-xs text-left space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <Check className="w-3 h-3" />
                  <span>核验录入成功</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono-numbers">
                  {new Date(lastScannedItem.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div className="overflow-hidden">
                <h3 className="text-sm font-bold text-slate-900 truncate">
                  {lastScannedItem.item.chineseName || lastScannedItem.item.name}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono-numbers mt-0.5 truncate">
                  条码: {lastScannedItem.item.barcode || '-'} · 货号: {lastScannedItem.item.itemNo || '-'} · 供方: {lastScannedItem.item.supplier || '-'}
                </p>
              </div>
              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-indigo-700 font-medium">
                  {lastScannedItem.message}
                </span>
                <button
                  type="button"
                  onClick={() => onOpenItemModal(lastScannedItem.item)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition-colors"
                >
                  <span>打开商品窗口</span>
                  <CornerDownLeft className="w-3 h-3" />
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5 py-4">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto shadow-inner">
                <Scan className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  PDA 快速扫码就绪
                </h2>
                <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 leading-relaxed">
                  扫码框已固定在页面底端。扫码后直接弹出免滑动商品窗口。
                </p>
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-lg text-[10px] text-slate-600 font-mono">
                <span>快捷键：按 <kbd className="px-1 py-0.5 bg-white border border-slate-200 rounded font-semibold text-slate-800 shadow-2xs">F2</kbd> 聚焦输入框</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* div:nth-of-type(2): 固定在底部菜单上方的输入框区域 (Fixed above bottom nav) */}
      <div className="fixed bottom-[52px] sm:bottom-[56px] left-0 right-0 bg-white/95 backdrop-blur-md border-t border-slate-200 p-3 sm:p-3.5 shadow-xl z-40 transition-all">
        <div className="max-w-4xl mx-auto w-full space-y-2">
          {/* form:nth-of-type(1) */}
          <form onSubmit={handleExecuteScan} className="w-full relative flex items-center">
            <div className="absolute left-4 text-slate-400 pointer-events-none flex items-center">
              <Scan className="w-5 h-5 text-indigo-600" />
            </div>

            {/* input:nth-of-type(1) */}
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (matchError) setMatchError(null);
              }}
              placeholder="请扫描或输入商品条码、货号、品名，回车立即弹出商品窗口 (按 F2 聚焦)..."
              className="w-full pl-12 pr-28 py-3.5 sm:py-4 bg-slate-50 border-2 border-slate-300 hover:border-slate-400 focus:border-indigo-600 focus:bg-white rounded-xl text-base text-slate-900 placeholder:text-slate-400 focus:outline-none transition-all font-medium shadow-inner"
              autoComplete="off"
              autoFocus
              aria-label="快速扫码查找输入框"
            />

            <button
              type="submit"
              className="absolute right-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1 shadow-xs"
            >
              <span>查找</span>
              <CornerDownLeft className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
