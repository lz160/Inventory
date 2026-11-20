import React, { useState, useRef, useEffect } from 'react';
import { Download, ChevronDown, FileSpreadsheet, FileCheck } from 'lucide-react';

export interface ExportDropdownProps {
  onExportPos: () => void;
  onExportAudit: () => void;
  label?: string;
  variant?: 'primary' | 'secondary' | 'icon-only' | 'compact';
  align?: 'left' | 'right';
  className?: string;
}

export const ExportDropdown: React.FC<ExportDropdownProps> = ({
  onExportPos,
  onExportAudit,
  label = '导出文件 (.xlsx)',
  variant = 'secondary',
  align = 'right',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleSelectPos = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    onExportPos();
  };

  const handleSelectAudit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    onExportAudit();
  };

  const getButtonStyles = () => {
    switch (variant) {
      case 'primary':
        return 'px-3 py-1.5 sm:px-3.5 sm:py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 active:bg-indigo-800 transition-colors shadow-2xs';
      case 'compact':
        return 'px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors';
      case 'icon-only':
        return 'p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors';
      case 'secondary':
      default:
        return 'px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-2xs transition-colors';
    }
  };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={containerRef}>
      {variant === 'icon-only' ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
          className={`${getButtonStyles()} inline-flex items-center gap-0.5`}
          title="导出 Excel 文件 (点击选择模板)"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <Download className="w-3.5 h-3.5" />
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
          className={`${getButtonStyles()} inline-flex items-center gap-1.5`}
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          <span>{label}</span>
          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}

      {isOpen && (
        <div
          className={`absolute z-50 mt-1.5 w-72 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 focus:outline-none transition-all ${
            align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'
          }`}
          role="menu"
          aria-orientation="vertical"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 border-b border-slate-100 text-[11px] font-semibold text-slate-500">
            选择导出模板 (.xlsx 格式)
          </div>

          <div className="p-1 space-y-1">
            {/* Template 1: POS Import File */}
            <button
              type="button"
              onClick={handleSelectPos}
              className="w-full text-left p-2 rounded-lg hover:bg-indigo-50/80 active:bg-indigo-100 transition-colors flex items-start gap-2.5 group"
              role="menuitem"
            >
              <div className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0 mt-0.5">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-900 group-hover:text-indigo-900 flex items-center justify-between">
                  <span>1. POS 系统导入模板</span>
                  <span className="text-[10px] text-indigo-600 font-mono font-medium">10列</span>
                </div>
                <div className="text-[11px] text-slate-500 group-hover:text-slate-600 mt-0.5 leading-tight">
                  模板同导入规范，<strong className="text-slate-700 font-medium">“数量”列填实到数量</strong>，便于直接导入POS入库
                </div>
              </div>
            </button>

            {/* Template 2: Audit & Reconciliation Result */}
            <button
              type="button"
              onClick={handleSelectAudit}
              className="w-full text-left p-2 rounded-lg hover:bg-indigo-50/80 active:bg-indigo-100 transition-colors flex items-start gap-2.5 group"
              role="menuitem"
            >
              <div className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0 mt-0.5">
                <FileCheck className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-slate-900 group-hover:text-indigo-900 flex items-center justify-between">
                  <span>2. 进货差异核对表</span>
                  <span className="text-[10px] text-emerald-600 font-mono font-medium">17列</span>
                </div>
                <div className="text-[11px] text-slate-500 group-hover:text-slate-600 mt-0.5 leading-tight">
                  显示<strong className="text-slate-700 font-medium">到货数量与货单差异</strong>、破损数、单价偏差与对账状态
                </div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
