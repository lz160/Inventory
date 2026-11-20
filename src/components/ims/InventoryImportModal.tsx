import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  Download,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import { useIms } from '../../context/ImsContext';
import { downloadImsXlsx, formatEur, formatQty } from '../../utils/imsApi';
import {
  parseInventoryWorkbook,
  ParsedWorkbookRow,
} from '../../modules/inventory/excelTemplate';
import {
  InventoryImportItemInput,
  InventoryImportMode,
  InventoryImportResult,
} from '../../modules/inventory/types';

interface InventoryImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void;
}

export const InventoryImportModal: React.FC<InventoryImportModalProps> = ({
  isOpen,
  onClose,
  onImported,
}) => {
  const { lang, t, apiCall, showToast } = useIms();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<InventoryImportMode>('upsert');
  const [fileName, setFileName] = useState<string>('');
  const [parsedRows, setParsedRows] = useState<ParsedWorkbookRow[]>([]);
  const [validItems, setValidItems] = useState<InventoryImportItemInput[]>([]);
  const [parseErrorCount, setParseErrorCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<InventoryImportResult | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setFileName('');
    setParsedRows([]);
    setValidItems([]);
    setParseErrorCount(0);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleDownloadTemplate = async () => {
    try {
      await downloadImsXlsx(
        '/api/g1/import-template',
        `inventory_import_template_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      showToast(
        lang === 'zh' ? '标准库存导入模板已下载' : 'Šablóna importu stiahnutá',
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || '模板下载失败', 'error');
    }
  };

  const handleFileChange = async (file: File | undefined) => {
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseInventoryWorkbook(buf);
      setParsedRows(parsed.parsedRows);
      setValidItems(parsed.validItems);
      setParseErrorCount(parsed.errorCount);
      if (parsed.parsedRows.length === 0) {
        showToast(
          lang === 'zh'
            ? '未在表格中识别到有效商品行，请检查表头与示例模板'
            : 'V súbore neboli nájdené žiadne platné riadky',
          'error'
        );
      }
    } catch (err: any) {
      showToast(
        err?.message || (lang === 'zh' ? '解析 Excel 文件失败' : 'Chyba čítania Excel súboru'),
        'error'
      );
    }
  };

  const handleCommitImport = async () => {
    if (validItems.length === 0) return;
    setSubmitting(true);
    try {
      const res = await apiCall<InventoryImportResult>('/api/g1/import', {
        method: 'POST',
        body: JSON.stringify({
          mode,
          items: validItems.slice(0, 500),
        }),
      });
      setResult(res);
      showToast(
        lang === 'zh'
          ? `导入完成：新建 ${res.created} 条，更新 ${res.updated} 条，跳过 ${res.skipped} 条`
          : `Import hotový: +${res.created}, upravené ${res.updated}, preskočené ${res.skipped}`,
        res.errors.length > 0 ? 'info' : 'success'
      );
      onImported();
    } catch (err: any) {
      showToast(err?.message || '批量导入失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-slate-200 max-w-3xl w-full shadow-xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">{t('invImportTitle')}</h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 text-slate-400 hover:text-slate-700"
            aria-label={t('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 space-y-4 overflow-y-auto text-xs flex-1">
          {/* Step 1: Download template */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-lg border border-slate-200 bg-slate-50">
            <div>
              <div className="font-semibold text-slate-800">{t('invImportStep1')}</div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {lang === 'zh'
                  ? '导出列表的 .xlsx 文件与本模板字段完全对齐，修改后可直接上传更新；WarningAt 将保留由盘点模块维护。'
                  : 'Stiahnutý export aj vzorová šablóna používajú rovnaké stĺpce; existujúce WarningAt sa zachováva.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-indigo-600" />
              <span>{t('invDownloadTemplate')}</span>
            </button>
          </div>

          {/* Step 2: Mode + File Picker */}
          <div className="space-y-3">
            <div className="font-semibold text-slate-800">{t('invImportStep2')}</div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  mode === 'upsert'
                    ? 'border-indigo-500 bg-indigo-50/50 text-indigo-900'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'upsert'}
                  onChange={() => setMode('upsert')}
                />
                <span className="font-medium leading-snug">{t('invImportModeUpsert')}</span>
              </label>

              <label
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  mode === 'update_only'
                    ? 'border-indigo-500 bg-indigo-50/50 text-indigo-900'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'update_only'}
                  onChange={() => setMode('update_only')}
                />
                <span className="font-medium leading-snug">{t('invImportModeUpdate')}</span>
              </label>

              <label
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  mode === 'create_only'
                    ? 'border-indigo-500 bg-indigo-50/50 text-indigo-900'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'create_only'}
                  onChange={() => setMode('create_only')}
                />
                <span className="font-medium leading-snug">{t('invImportModeCreate')}</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => handleFileChange(e.target.files?.[0])}
                className="hidden"
                id="ims-inventory-import-file"
              />
              <label
                htmlFor="ims-inventory-import-file"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-indigo-400 bg-indigo-50/40 text-indigo-700 font-semibold hover:bg-indigo-50 cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>
                  {fileName
                    ? fileName
                    : lang === 'zh'
                    ? '选择库存 Excel 文件 (.xlsx)'
                    : 'Vybrať Excel súbor (.xlsx)'}
                </span>
              </label>
              {fileName && (
                <button
                  type="button"
                  onClick={resetState}
                  className="text-slate-500 hover:text-slate-800 underline text-[11px]"
                >
                  {t('reset')}
                </button>
              )}
            </div>
          </div>

          {/* Preview Breakdown */}
          {parsedRows.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-4 px-3.5 py-2.5 rounded-lg border border-slate-200 bg-slate-50 text-xs">
                <span className="font-mono-numbers">
                  {lang === 'zh' ? '解析行数' : 'Riadky'}: <strong>{parsedRows.length}</strong>
                </span>
                <span className="font-mono-numbers text-emerald-700">
                  {lang === 'zh' ? '待提交有效行' : 'Platné'}: <strong>{validItems.length}</strong>
                </span>
                <span className="font-mono-numbers text-rose-700">
                  {lang === 'zh' ? '格式异常' : 'Chyby'}: <strong>{parseErrorCount}</strong>
                </span>
                {validItems.length > 500 && (
                  <span className="text-amber-700 font-semibold">
                    {lang === 'zh' ? '超过 500 行，仅导入前 500 条' : 'Max 500 riadkov na dávku'}
                  </span>
                )}
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 text-slate-600">
                    <tr>
                      <th className="py-2 px-2.5">#</th>
                      <th className="py-2 px-2.5">{t('invColBarcode')}</th>
                      <th className="py-2 px-2.5">{t('invColName')}</th>
                      <th className="py-2 px-2.5">Kod / Supplier</th>
                      <th className="py-2 px-2.5">{t('invColCategory')}</th>
                      <th className="py-2 px-2.5 text-right">{t('invColSurplus')}</th>
                      <th className="py-2 px-2.5 text-right">Cena</th>
                      <th className="py-2 px-2.5 text-right">Cena2</th>
                      <th className="py-2 px-2.5 whitespace-nowrap">{t('invColStatus')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.slice(0, 100).map((row) => (
                      <tr
                        key={`${row.rowNumber}-${row.item?.Barcode || 'err'}`}
                        className={row.error ? 'bg-rose-50/60' : 'hover:bg-slate-50'}
                      >
                        <td className="py-1.5 px-2.5 font-mono-numbers text-slate-400">
                          {row.rowNumber}
                        </td>
                        <td className="py-1.5 px-2.5 font-mono-numbers font-medium text-slate-800 whitespace-nowrap">
                          {row.item?.Barcode || '—'}
                        </td>
                        <td className="py-1.5 px-2.5 max-w-[160px] truncate text-slate-800">
                          {row.item?.Nazov || '—'}
                        </td>
                        <td className="py-1.5 px-2.5 text-slate-500 max-w-[140px] truncate">
                          {[row.item?.Kod, row.item?.Supplier].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="py-1.5 px-2.5 text-slate-600 whitespace-nowrap">
                          {row.item?.category || '—'}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono-numbers whitespace-nowrap">
                          {row.item?.Surplus !== undefined ? formatQty(row.item.Surplus) : '—'}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono-numbers whitespace-nowrap">
                          {row.item?.Cena !== undefined ? formatEur(row.item.Cena) : '—'}
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono-numbers whitespace-nowrap">
                          {row.item?.Cena2 !== undefined ? formatEur(row.item.Cena2) : '—'}
                        </td>
                        <td className="py-1.5 px-2.5 whitespace-nowrap">
                          {row.error ? (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-medium whitespace-nowrap">
                              <AlertCircle className="w-3 h-3 shrink-0" />
                              <span>{row.error}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium whitespace-nowrap">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              <span>{lang === 'zh' ? '就绪' : 'OK'}</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Server Commit Result Summary */}
          {result && (
            <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
              <div className="font-semibold text-slate-900">
                {lang === 'zh' ? '数据库写入结果' : 'Výsledok zápisu'}
              </div>
              <div className="flex flex-wrap gap-4 text-xs font-mono-numbers">
                <span className="text-emerald-700">
                  {lang === 'zh' ? '新建' : 'Vytvorené'}: <strong>{result.created}</strong>
                </span>
                <span className="text-indigo-700">
                  {lang === 'zh' ? '更新' : 'Aktualizované'}: <strong>{result.updated}</strong>
                </span>
                <span className="text-slate-600">
                  {lang === 'zh' ? '跳过' : 'Preskočené'}: <strong>{result.skipped}</strong>
                </span>
                <span className="text-rose-700">
                  {lang === 'zh' ? '失败' : 'Chyby'}: <strong>{result.errors.length}</strong>
                </span>
              </div>
              {result.errors.length > 0 && (
                <ul className="text-[11px] text-rose-700 space-y-1 max-h-28 overflow-y-auto pt-1 border-t border-slate-200">
                  {result.errors.map((err, i) => (
                    <li key={i}>
                      #{err.rowNumber} ({err.barcode}): {err.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={handleClose}
            className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-100"
          >
            {t('close')}
          </button>
          <button
            type="button"
            disabled={validItems.length === 0 || submitting}
            onClick={handleCommitImport}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{t('invImportConfirm')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
