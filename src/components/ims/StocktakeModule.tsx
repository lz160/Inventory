import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  ScanBarcode,
  CheckCircle2,
  Clock,
  Trash2,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { useIms } from '../../context/ImsContext';
import { downloadImsXlsx, formatQty } from '../../utils/imsApi';
import { G1Product } from '../../modules/inventory/types';
import { parsePipeProductName } from '../../modules/inventory/viewHelpers';
import { StocktakeHead, StocktakeLine, StocktakeListRow } from '../../modules/stocktake/types';
import { DbConnectionNotice } from './DbConnectionNotice';

export const StocktakeModule: React.FC = () => {
  const { lang, t, apiCall, showToast, dbMode, dbContextReady, dbStatus } = useIms();
  const dbBlocked = dbContextReady && dbMode === 'mssql' && (!dbStatus.sklad.ok || !dbStatus.saledata.ok);

  const [sessions, setSessions] = useState<StocktakeListRow[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ stocktake: StocktakeHead; lines: StocktakeLine[] } | null>(null);
  const [newOrderName, setNewOrderName] = useState('');
  const [loading, setLoading] = useState(false);

  // Scan & Count state (§6.5)
  const scanInputRef = useRef<HTMLInputElement>(null);
  const countedInputRef = useRef<HTMLInputElement>(null);
  const [scanBarcode, setScanBarcode] = useState('');
  const [hitProduct, setHitProduct] = useState<G1Product | null>(null);
  const [countedQty, setCountedQty] = useState('');
  const [warningAt, setWarningAt] = useState('');
  const [notes, setNotes] = useState('');
  const [submittingLine, setSubmittingLine] = useState(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<StocktakeHead | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiCall<{ rows: StocktakeListRow[] }>('/api/stocktakes');
      setSessions(data.rows);
      if (data.rows.length > 0 && selectedId === null) {
        setSelectedId(data.rows[0].Id);
      }
    } catch (err: any) {
      showToast(err?.message || '加载盘点单列表失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [apiCall, showToast, selectedId]);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const data = await apiCall<{ stocktake: StocktakeHead; lines: StocktakeLine[] }>(`/api/stocktakes/${id}`);
      setDetail(data);
    } catch (err: any) {
      showToast(err?.message || '加载盘点详情失败', 'error');
    }
  }, [apiCall, showToast]);

  useEffect(() => {
    if (!dbContextReady || dbBlocked) return;
    loadSessions();
  }, [dbContextReady, dbBlocked, loadSessions]);

  useEffect(() => {
    if (selectedId !== null) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  // Auto-focus scan input when an open stocktake is active (§6.5 #1)
  useEffect(() => {
    if (detail?.stocktake.Status === 'open') {
      setTimeout(() => scanInputRef.current?.focus(), 60);
    }
  }, [detail?.stocktake.Id, detail?.stocktake.Status]);

  const handleCreateStocktake = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await apiCall<StocktakeHead & { lines: StocktakeLine[] }>('/api/stocktakes', {
        method: 'POST',
        body: JSON.stringify({ name: newOrderName.trim() || undefined }),
      });
      setNewOrderName('');
      showToast(lang === 'zh' ? `已创建 ${created.Name}` : `Vytvorená ${created.Name}`, 'success');
      await loadSessions();
      setSelectedId(created.Id);
    } catch (err: any) {
      showToast(err?.message || '新建盘点单失败', 'error');
    }
  };

  const handleLookupBarcode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const bc = scanBarcode.trim();
    if (!bc) return;
    try {
      const product = await apiCall<G1Product>(`/api/g1/products/${encodeURIComponent(bc)}`);
      setHitProduct(product);
      setCountedQty(String(product.Surplus ?? 0));
      setWarningAt(String(product.WarningAt ?? 0));
      setTimeout(() => countedInputRef.current?.select(), 30);
    } catch (err: any) {
      setHitProduct(null);
      showToast(err?.message || `条码 ${bc} 未找到`, 'error');
    }
  };

  const handleSubmitLine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || detail.stocktake.Status !== 'open') return;
    const bc = (hitProduct?.Barcode || scanBarcode).trim();
    if (!bc) return;
    setSubmittingLine(true);
    try {
      const body: Record<string, any> = {
        barcode: bc,
        countedQty: Number(countedQty),
        notes: notes.trim() || undefined,
      };
      if (warningAt.trim() !== '') {
        body.warningAt = Number(warningAt);
      }

      const savedLine = await apiCall<StocktakeLine>(`/api/stocktakes/${detail.stocktake.Id}/lines`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      showToast(
        lang === 'zh'
          ? `已录行并立即更新库存: ${savedLine.Barcode} -> ${formatQty(savedLine.CountedQty)}`
          : `Zapísané & g1 aktualizované: ${savedLine.Barcode} -> ${formatQty(savedLine.CountedQty)}`,
        'success'
      );

      setScanBarcode('');
      setHitProduct(null);
      setCountedQty('');
      setWarningAt('');
      setNotes('');
      await Promise.all([loadDetail(detail.stocktake.Id), loadSessions()]);
      setTimeout(() => scanInputRef.current?.focus(), 40);
    } catch (err: any) {
      showToast(err?.message || '录行失败', 'error');
    } finally {
      setSubmittingLine(false);
    }
  };

  const handleSubmitStocktake = async () => {
    if (!detail) return;
    try {
      await apiCall(`/api/stocktakes/${detail.stocktake.Id}/submit`, { method: 'POST' });
      showToast(lang === 'zh' ? '盘点单已提交锁定' : 'Inventúra odoslaná', 'success');
      await Promise.all([loadDetail(detail.stocktake.Id), loadSessions()]);
    } catch (err: any) {
      showToast(err?.message || '提交失败', 'error');
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deleteTarget) return;
    try {
      await apiCall(`/api/stocktakes/${deleteTarget.Id}`, { method: 'DELETE' });
      showToast(lang === 'zh' ? `已删除盘点单 ${deleteTarget.Name}` : `Inventúra vymazaná`, 'success');
      const deletedId = deleteTarget.Id;
      setDeleteTarget(null);
      if (selectedId === deletedId) {
        setSelectedId(null);
        setDetail(null);
      }
      await loadSessions();
    } catch (err: any) {
      showToast(err?.message || '删除失败', 'error');
    }
  };

  const handleExport = async () => {
    if (!detail) return;
    try {
      await downloadImsXlsx(
        `/api/stocktakes/${detail.stocktake.Id}/export`,
        `${detail.stocktake.Name}_variance.xlsx`
      );
      showToast(lang === 'zh' ? '盘点差异 XLSX 导出成功' : 'Export hotový', 'success');
    } catch (err: any) {
      showToast(err?.message || '导出失败', 'error');
    }
  };

  const previewVariance =
    hitProduct && countedQty !== '' && Number.isFinite(Number(countedQty))
      ? Number(countedQty) - Number(hitProduct.Surplus ?? 0)
      : null;

  const renderVarianceBadge = (v: number) => {
    if (Math.abs(v) < 1e-6) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono-numbers font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
          0
        </span>
      );
    }
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono-numbers font-bold border whitespace-nowrap ${
          v > 0
            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
            : 'bg-amber-50 text-amber-800 border-amber-200'
        }`}
      >
        {v > 0 ? `+${formatQty(v)}` : formatQty(v)}
      </span>
    );
  };

  if (!dbContextReady) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-xs text-slate-500">
        {t('dbChecking')}
      </div>
    );
  }

  if (dbBlocked) {
    return (
      <DbConnectionNotice
        targets={[
          { name: 'SKLAD', status: dbStatus.sklad },
          { name: 'SaleData', status: dbStatus.saledata },
        ]}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Left Sidebar: Stocktake List & Create */}
      <div className="lg:col-span-4 space-y-3">
        <form onSubmit={handleCreateStocktake} className="bg-white rounded-xl border border-slate-200 p-3.5 space-y-2.5">
          <div className="text-xs font-bold text-slate-800">{t('stkCreateBtn')}</div>
          <input
            type="text"
            value={newOrderName}
            onChange={(e) => setNewOrderName(e.target.value)}
            placeholder={t('stkNamePlaceholder')}
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" />
            <span>{t('stkCreateBtn')}</span>
          </button>
        </form>

        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
            {t('stkListTitle')}
          </div>
          <div className="divide-y divide-slate-100 max-h-[520px] overflow-y-auto">
            {sessions.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500">
                {loading ? t('loading') : t('noData')}
              </div>
            ) : (
              sessions.map((s) => {
                const isSelected = selectedId === s.Id;
                return (
                  <button
                    key={s.Id}
                    type="button"
                    onClick={() => setSelectedId(s.Id)}
                    className={`w-full text-left px-3.5 py-3 transition-colors ${
                      isSelected ? 'bg-indigo-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900 truncate">{s.Name}</span>
                      {s.Status === 'submitted' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 whitespace-nowrap">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{t('stkStatusSubmitted')}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap">
                          <Clock className="w-3 h-3" />
                          <span>{t('stkStatusOpen')}</span>
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 font-mono-numbers">
                      <span>{s.CountDate.slice(0, 10)} · {s.CreatedBy}</span>
                      <span>
                        {s.LineCount} {t('stkLinesCount')} · {s.DiffCount} {t('stkDiffCount')}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right Main Panel: Active Stocktake Scan & Variance Report */}
      <div className="lg:col-span-8 space-y-3">
        {!detail ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-xs text-slate-500">
            {t('noData')}
          </div>
        ) : (
          <>
            {/* Header Info */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">{detail.stocktake.Name}</h2>
                  {detail.stocktake.Status === 'submitted' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t('stkStatusSubmitted')}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{t('stkStatusOpen')}</span>
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1 font-mono-numbers">
                  {detail.stocktake.CountDate.slice(0, 10)} · {detail.stocktake.CreatedBy} ·{' '}
                  {detail.lines.length} {t('stkLinesCount')}
                  {detail.stocktake.SyncedToG1 && ` · ${detail.stocktake.SyncedToG1.slice(0, 19).replace('T', ' ')}`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {detail.stocktake.Status === 'open' && (
                  <button
                    type="button"
                    disabled={detail.lines.length === 0}
                    onClick={handleSubmitStocktake}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 whitespace-nowrap"
                  >
                    {t('stkSubmitOrderBtn')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('exportXlsx')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(detail.stocktake)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('stkDeleteOrderBtn')}</span>
                </button>
              </div>
            </div>

            {/* Active Scan Input Panel (open status only) */}
            {detail.stocktake.Status === 'open' && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                <form onSubmit={handleLookupBarcode} className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-700">
                    {t('stkScanLabel')}
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <ScanBarcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        ref={scanInputRef}
                        type="text"
                        value={scanBarcode}
                        onChange={(e) => setScanBarcode(e.target.value)}
                        placeholder={t('stkScanPlaceholder')}
                        className="w-full pl-9 pr-3 py-2.5 text-sm font-mono-numbers border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 whitespace-nowrap"
                    >
                      {lang === 'zh' ? '查货' : 'Hľadať'}
                    </button>
                  </div>
                </form>

                {/* Product Hit Preview + Count Entry */}
                {hitProduct && (
                  <form
                    onSubmit={handleSubmitLine}
                    className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        {(() => {
                          const parsed = parsePipeProductName(hitProduct.Nazov);
                          return (
                            <>
                              <div className="text-sm font-bold text-slate-900">{parsed.primary || '—'}</div>
                              {parsed.secondary && (
                                <div className="text-xs text-slate-500 mt-0.5">{parsed.secondary}</div>
                              )}
                            </>
                          );
                        })()}
                        <div className="text-xs font-mono-numbers text-slate-500 mt-0.5">
                          {hitProduct.Barcode} · {t('stkSystemQty')}:{' '}
                          <strong className="text-slate-900">{formatQty(hitProduct.Surplus ?? 0)}</strong>
                        </div>
                      </div>
                      {previewVariance !== null && (
                        <div className="text-right">
                          <div className="text-[10px] text-slate-500 mb-0.5">{t('stkLiveVariance')}</div>
                          {renderVarianceBadge(previewVariance)}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {t('stkCountedLabel')} *
                        </label>
                        <input
                          ref={countedInputRef}
                          type="number"
                          step="0.01"
                          min="0"
                          required
                          value={countedQty}
                          onChange={(e) => setCountedQty(e.target.value)}
                          className="w-full px-3 py-2.5 text-lg font-bold font-mono-numbers border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {t('stkWarningLabel')}
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={warningAt}
                          onChange={(e) => setWarningAt(e.target.value)}
                          className="w-full px-3 py-2.5 text-lg font-bold font-mono-numbers border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {t('stkNotesLabel')}
                        </label>
                        <input
                          type="text"
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submittingLine}
                      className="w-full py-2.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {t('stkSubmitLineBtn')} (Enter)
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Lines / Variance Report Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase">
                      <th className="py-2.5 px-3">{t('stkColVariance')}</th>
                      <th className="py-2.5 px-3">{t('invColBarcode')}</th>
                      <th className="py-2.5 px-3">{t('invColName')}</th>
                      <th className="py-2.5 px-3 text-right">{t('stkColQtyCompare')}</th>
                      <th className="py-2.5 px-3 text-right">WarningAt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {detail.lines.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-10 text-center text-slate-500">
                          {t('noData')}
                        </td>
                      </tr>
                    ) : (
                      detail.lines.map((line) => (
                        <tr key={line.Barcode} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3">{renderVarianceBadge(line.Variance)}</td>
                          <td className="py-2.5 px-3 font-mono-numbers text-slate-700">{line.Barcode}</td>
                          <td className="py-2.5 px-3 font-medium text-slate-900">
                            {(() => {
                              const parsed = parsePipeProductName(line.Nazov);
                              return (
                                <>
                                  <div>{parsed.primary || '—'}</div>
                                  {parsed.secondary && (
                                    <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                                      {parsed.secondary}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
                            {line.Notes && <div className="text-[11px] text-slate-500">{line.Notes}</div>}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-numbers whitespace-nowrap">
                            <span className="text-slate-500">{formatQty(line.SystemQty)}</span>
                            <span className="mx-1 text-slate-400">→</span>
                            <strong className="text-slate-900">{formatQty(line.CountedQty)}</strong>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono-numbers text-slate-600">
                            {line.WarningAt ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete Second Confirmation Modal (§6.5 #7) */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-5 shadow-xl space-y-4">
            <div className="flex items-center gap-2 text-rose-700">
              <AlertTriangle className="w-5 h-5" />
              <h4 className="text-sm font-bold">{t('stkDeleteConfirmTitle')}</h4>
            </div>
            <p className="text-xs text-slate-600">{t('stkDeleteConfirmDesc')}</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-bold text-slate-900">
              {deleteTarget.Name}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirmed}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
