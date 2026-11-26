import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Scan, Search, CornerDownLeft, Check, AlertCircle, ExternalLink, Package } from 'lucide-react';
import { PurchaseItem, calculateItemStatus } from '../utils/reconciliation';

interface ScannerBarProps {
  items: PurchaseItem[];
  onScanMatch: (item: PurchaseItem, addQty: number) => void;
  onOpenItemModal: (item: PurchaseItem) => void;
  lastScannedItem: { item: PurchaseItem; message: string; timestamp: number } | null;
}

export const ScannerBar: React.FC<ScannerBarProps> = ({
  items,
  onScanMatch,
  onOpenItemModal,
  lastScannedItem,
}) => {
  const [query, setQuery] = useState('');
  const [stepQty, setStepQty] = useState<number>(1);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [multipleMatchesModal, setMultipleMatchesModal] = useState<PurchaseItem[] | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Global keydown shortcut: Press '/' or 'F2' to focus scanner
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2' || (e.key === '/' && (e.target as HTMLElement).tagName !== 'INPUT')) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter matched items dynamically as user types
  const matchedSuggestions = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (!clean) return [];

    return items.filter((item) => {
      const matchBarcode = item.barcode && item.barcode.toLowerCase().includes(clean);
      const matchItemNo = item.itemNo && item.itemNo.toLowerCase().includes(clean);
      const matchName = item.name && item.name.toLowerCase().includes(clean);
      const matchChinese = item.chineseName && item.chineseName.toLowerCase().includes(clean);
      const matchSupplier = item.supplier && item.supplier.toLowerCase().includes(clean);
      const matchSeq = String(item.seq) === clean;
      return matchBarcode || matchItemNo || matchName || matchChinese || matchSupplier || matchSeq;
    });
  }, [items, query]);

  // Execute scan / search submission
  const handleExecuteScan = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) return;

    setIsDropdownOpen(false);

    // Exact matches first
    const exactBarcode = items.find(
      (item) => item.barcode && item.barcode.toLowerCase() === cleanQuery.toLowerCase()
    );
    if (exactBarcode) {
      onScanMatch(exactBarcode, stepQty);
      setMatchError(null);
      setQuery('');
      return;
    }

    const exactItemNo = items.find(
      (item) => item.itemNo && item.itemNo.toLowerCase() === cleanQuery.toLowerCase()
    );
    if (exactItemNo) {
      onScanMatch(exactItemNo, stepQty);
      setMatchError(null);
      setQuery('');
      return;
    }

    // Fuzzy matches
    const matches = matchedSuggestions;

    if (matches.length === 1) {
      // Single match: directly open product info window!
      const target = matches[0];
      onScanMatch(target, stepQty);
      setMatchError(null);
      setQuery('');
    } else if (matches.length > 1) {
      // Multiple matches: show selection window for user to pick
      setMultipleMatchesModal(matches);
      setMatchError(null);
    } else {
      setMatchError(`未找到条码、货号或品名包含 "${cleanQuery}" 的进货商品`);
      setTimeout(() => setMatchError(null), 3500);
    }
  };

  const handleSelectSuggestion = (item: PurchaseItem) => {
    setIsDropdownOpen(false);
    setQuery('');
    onScanMatch(item, stepQty);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-3 relative">
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Scanner Input Group */}
        <form onSubmit={handleExecuteScan} className="flex-1 relative flex items-center">
          <div className="absolute left-3 text-slate-400 pointer-events-none flex items-center">
            <Scan className="w-5 h-5 text-indigo-600" />
          </div>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsDropdownOpen(true);
              if (matchError) setMatchError(null);
            }}
            onFocus={() => {
              if (query.trim()) setIsDropdownOpen(true);
            }}
            placeholder="输入商品条码、货号、品名或中文查找，回车立即弹出商品信息窗口 (按F2聚焦)..."
            className="w-full pl-11 pr-24 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors font-medium"
            autoComplete="off"
            aria-label="查找商品输入框"
          />
          <div className="absolute right-2 flex items-center gap-1.5">
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-2xs"
              title="按Enter或点击立即查找并弹出商品信息窗口"
            >
              <span>查找核验</span>
              <CornerDownLeft className="w-3 h-3" />
            </button>
          </div>
        </form>

        {/* Step Quantity Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-500 whitespace-nowrap">扫码默认录入:</span>
          <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200">
            {[1, 5, 10].map((qty) => (
              <button
                key={qty}
                type="button"
                onClick={() => setStepQty(qty)}
                className={`px-2.5 py-1 text-xs font-mono-numbers font-medium rounded-md transition-colors ${
                  stepQty === qty
                    ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                +{qty}
              </button>
            ))}
          </div>

          <div className="hidden sm:block text-xs text-slate-400 pl-2 border-l border-slate-200">
            快捷键: <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] text-slate-600 font-mono">F2</kbd> 聚焦扫码
          </div>
        </div>
      </div>

      {/* Real-time Search Dropdown Suggestions (Opens as user types) */}
      {isDropdownOpen && query.trim().length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute left-3 right-3 lg:right-72 top-[60px] z-30 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-slate-100"
        >
          <div className="px-3 py-2 bg-slate-50 text-[11px] font-semibold text-slate-500 flex items-center justify-between">
            <span>匹配到 {matchedSuggestions.length} 款商品 (点击或回车弹出商品窗口):</span>
            <span className="text-slate-400 font-normal">ESC 关闭下拉</span>
          </div>

          {matchedSuggestions.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              未找到匹配的商品，按回车可尝试模糊检索
            </div>
          ) : (
            matchedSuggestions.map((item) => {
              const status = calculateItemStatus(item.expectedQty, item.receivedQty);
              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectSuggestion(item)}
                  className="px-3 py-2.5 hover:bg-indigo-50/60 cursor-pointer flex items-center justify-between gap-3 text-xs transition-colors"
                >
                  <div className="flex items-center gap-2.5 overflow-hidden">
                    <span className="font-mono text-slate-400 text-[11px] w-6 shrink-0 text-center">
                      #{item.seq}
                    </span>
                    <div className="overflow-hidden">
                      <div className="font-semibold text-slate-900 truncate">
                        {item.chineseName || item.name}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono-numbers">
                        条码: {item.barcode || '-'} · 货号: {item.itemNo || '-'} · 优惠价: ¥{item.discountPrice.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] font-mono-numbers text-slate-600">
                      实收 <strong className="text-slate-900">{item.receivedQty}</strong> / {item.expectedQty}
                    </span>
                    <span className="text-indigo-600 font-medium text-[11px] flex items-center gap-0.5">
                      <span>核验</span>
                      <ExternalLink className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Real-time Feedback Toast / Banner */}
      {matchError && (
        <div className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
          <span>{matchError}</span>
        </div>
      )}

      {lastScannedItem && !matchError && (
        <div className="mt-2 text-xs bg-indigo-50/80 border border-indigo-100 text-indigo-900 px-3 py-2 rounded-lg flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-semibold text-slate-900 truncate">
              {lastScannedItem.item.chineseName || lastScannedItem.item.name}
            </span>
            <span className="text-slate-500 font-mono text-[11px]">
              [{lastScannedItem.item.barcode || lastScannedItem.item.itemNo}]
            </span>
            <span className="text-indigo-700">· {lastScannedItem.message}</span>
          </div>
          <button
            onClick={() => onOpenItemModal(lastScannedItem.item)}
            className="text-indigo-600 hover:text-indigo-800 font-semibold underline text-[11px] shrink-0"
          >
            打开商品信息窗口
          </button>
        </div>
      )}

      {/* Multiple Matches Selection Modal (If query matched multiple items on submit) */}
      {multipleMatchesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  找到 {multipleMatchesModal.length} 款匹配商品
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  关键词同时匹配到多款商品，请点击目标商品打开信息窗口
                </p>
              </div>
              <button
                onClick={() => setMultipleMatchesModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <div className="p-3 flex-1 overflow-y-auto divide-y divide-slate-100 text-xs">
              {multipleMatchesModal.map((item) => (
                <div
                  key={item.id}
                  onClick={() => {
                    setMultipleMatchesModal(null);
                    setQuery('');
                    onOpenItemModal(item);
                  }}
                  className="p-3 hover:bg-indigo-50/60 cursor-pointer rounded-lg flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="space-y-0.5 overflow-hidden">
                    <div className="font-bold text-slate-900 truncate">
                      #{item.seq} {item.chineseName || item.name}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono-numbers">
                      条码: {item.barcode || '-'} · 货号: {item.itemNo || '-'} · 优惠价: ¥{item.discountPrice.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-mono-numbers font-semibold block text-slate-800">
                      实收: {item.receivedQty} / {item.expectedQty}
                    </span>
                    <span className="text-[11px] text-indigo-600 font-medium">查看商品窗口 →</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-right">
              <button
                onClick={() => setMultipleMatchesModal(null)}
                className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
