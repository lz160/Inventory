import React, { useState } from 'react';
import { X, Upload, FileText, Sparkles, AlertCircle, Copy, Check, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';
import { parseImportText, PurchaseItem, getSamplePurchaseItems } from '../utils/reconciliation';
import { getAuthHeaders } from '../utils/imsApi';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportItems: (
    newItems: PurchaseItem[],
    batchTitle: string,
    mode: 'new_order' | 'replace' | 'append'
  ) => Promise<boolean>;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportItems,
}) => {
  const [activeTab, setActiveTab] = useState<'text' | 'ai'>('text');
  const [batchTitle, setBatchTitle] = useState('20261109-新进货批次单');
  const [rawText, setRawText] = useState('');
  const [importMode, setImportMode] = useState<'new_order' | 'replace' | 'append'>('new_order');
  const [copiedTemplate, setCopiedTemplate] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const standardHeader = '序号\t品名\t中文\t单价\t优惠价\t条码\t数量\t货号\t单价2\t供应商';

  const handleCopyHeader = () => {
    navigator.clipboard.writeText(standardHeader);
    setCopiedTemplate(true);
    setTimeout(() => setCopiedTemplate(false), 2000);
  };

  const handleLoadSample = () => {
    const sample = getSamplePurchaseItems();
    const rows = sample.map(
      (item) =>
        `${item.seq}\t${item.name}\t${item.chineseName}\t${item.unitPrice}\t${item.discountPrice}\t${item.barcode}\t${item.expectedQty}\t${item.itemNo}\t${item.unitPrice2}\t${item.supplier}`
    );
    setRawText(`${standardHeader}\n${rows.join('\n')}`);
    setBatchTitle('亚太免税美妆采购进货单');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fileNameLower = file.name.toLowerCase();
    if (fileNameLower.endsWith('.xlsx') || fileNameLower.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const buffer = event.target?.result as ArrayBuffer;
          const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          if (firstSheetName) {
            const worksheet = workbook.Sheets[firstSheetName];
            const tsv = XLSX.utils.sheet_to_csv(worksheet, { FS: '\t' });
            setRawText(tsv);
            setBatchTitle(file.name.replace(/\.[^/.]+$/, ''));
          }
        } catch (err: any) {
          alert('解析Excel文件失败，请确保文件格式完整有效');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        if (content) {
          setRawText(content);
          setBatchTitle(file.name.replace(/\.[^/.]+$/, ''));
        }
      };
      reader.readAsText(file);
    }
  };

  const handleConfirmTextImport = async () => {
    const parsed = parseImportText(rawText);
    if (parsed.length === 0) {
      alert('未能解析出有效的进货单商品，请确认已粘贴或输入包含 序号、品名、单价、条码、数量 等列的文本');
      return;
    }
    setIsImporting(true);
    setImportError(null);
    try {
      if (await onImportItems(parsed, batchTitle || '新建进货批次', importMode)) onClose();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : '进货单导入失败');
    } finally {
      setIsImporting(false);
    }
  };

  const handleAiParse = async () => {
    if (!rawText.trim()) {
      setImportError('请先在下方输入或粘贴进货单文本或不规则表格');
      return;
    }
    setIsImporting(true);
    setImportError(null);
    try {
      const headers = getAuthHeaders({ 'Content-Type': 'application/json' });
      const res = await fetch('/api/parse-invoice', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: rawText }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'AI解析失败');
      }
      if (Array.isArray(data.items) && data.items.length > 0) {
        const mapped: PurchaseItem[] = data.items.map((it: any, idx: number) => ({
          id: `ai-item-${Date.now()}-${idx}`,
          seq: it.seq || idx + 1,
          name: it.name || `商品-${idx + 1}`,
          chineseName: it.chineseName || '',
          unitPrice: Number(it.unitPrice) || 0,
          discountPrice: Number(it.discountPrice) || Number(it.unitPrice) || 0,
          barcode: String(it.barcode || ''),
          expectedQty: Number(it.expectedQty) || 0,
          itemNo: String(it.itemNo || ''),
          unitPrice2: Number(it.unitPrice2) || 0,
          supplier: String(it.supplier || ''),
          receivedQty: 0,
          damagedQty: 0,
          actualBilledPrice: Number(it.discountPrice) || Number(it.unitPrice) || 0,
          notes: '',
        }));
        if (await onImportItems(mapped, batchTitle || 'AI智能识别进货单', importMode)) onClose();
      } else {
        throw new Error('未识别到有效的商品条目');
      }
    } catch (err: any) {
      setImportError(err.message || 'AI解析失败，建议直接使用文本格式快速粘贴导入');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">导入进货单数据</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              支持直接从 Excel / 微信 / 供应商对账单中复制粘贴，或上传 CSV 文件
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isImporting}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab & Batch title */}
        <div className="px-5 pt-3 pb-2 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-lg">
            <button
              onClick={() => setActiveTab('text')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'text'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 inline mr-1" />
              表格/文本粘贴导入 (推荐)
            </button>
            <button
              onClick={() => setActiveTab('ai')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'ai'
                  ? 'bg-white text-indigo-700 shadow-2xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 inline mr-1 text-indigo-600" />
              AI 智能规整识别
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 whitespace-nowrap">批次名称:</span>
            <input
              type="text"
              value={batchTitle}
              onChange={(e) => setBatchTitle(e.target.value)}
              className="text-xs bg-white border border-slate-200 px-2.5 py-1 rounded-md text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="进货单批次名称"
            />
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {/* Template Info Card */}
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-lg p-3 text-slate-700">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-indigo-900 text-xs">标准10列模板规范:</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyHeader}
                  className="text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1"
                >
                  {copiedTemplate ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedTemplate ? '已复制表头' : '复制表头'}</span>
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={handleLoadSample}
                  className="text-indigo-600 hover:text-indigo-800 font-medium underline"
                >
                  填入示例数据
                </button>
              </div>
            </div>
            <div className="bg-white/80 p-2 rounded border border-indigo-100/60 font-mono text-[11px] text-slate-600 overflow-x-auto whitespace-nowrap">
              序号 · 品名 · 中文 · 单价 · 优惠价 · 条码 · 数量 · 货号 · 单价2 · 供应商
            </div>
          </div>

          {/* Textarea */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-slate-500">
              <label htmlFor="import-raw-text" className="font-medium text-slate-700">
                {activeTab === 'text'
                  ? '粘贴进货单数据 (支持从 Excel 整块复制 Ctrl+C / Ctrl+V):'
                  : '粘贴非结构化进货单文本或不规范发票信息:'}
              </label>
              <label className="cursor-pointer text-indigo-600 hover:text-indigo-800 font-medium inline-flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" />
                <span>上传 Excel/CSV 文件</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt,.tsv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>

            <textarea
              id="import-raw-text"
              rows={8}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder={`示例格式：\n1\tSK-II神仙水230ml\t神仙水\t1540\t1180\t4979004070008\t24\tSKI-FTE\t1150\t日韩美妆社\n2\t小棕瓶50ml\t特润修护\t890\t620\t0887167485488\t50\tEL-ANR\t610\t亚太免税仓`}
              className="w-full p-3 font-mono text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 focus:bg-white text-slate-800"
            />
          </div>

          {/* Import Mode Switch */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1">
            <span className="font-medium text-slate-700">导入模式:</span>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="importMode"
                value="new_order"
                checked={importMode === 'new_order'}
                onChange={() => setImportMode('new_order')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-semibold text-indigo-900">创建为独立新单据 (与现有单据一起核对)</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span>替换当前激活单据</span>
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="importMode"
                value="append"
                checked={importMode === 'append'}
                onChange={() => setImportMode('append')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              <span>追加至当前单据末尾</span>
            </label>
          </div>

          {importError && (
            <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 p-2.5 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{importError}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-[11px] text-slate-400">
            已就绪，点击下方按钮完成数据录入
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
            >
              取消
            </button>
            {activeTab === 'text' ? (
              <button
                type="button"
                onClick={handleConfirmTextImport}
                disabled={isImporting || !rawText.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors shadow-xs"
              >
                {isImporting ? '正在保存进货单…' : '确认导入进货单'}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleAiParse}
                disabled={isImporting || !rawText.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors shadow-xs inline-flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isImporting ? '正在智能提取中...' : '开始AI智能解析'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
