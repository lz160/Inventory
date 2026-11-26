import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search,
  Plus,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Trash2,
  X,
  PencilLine,
  Check,
  FileSpreadsheet,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { useIms, isConflict40901 } from '../../context/ImsContext';
import { downloadImsXlsx, formatEur, formatQty } from '../../utils/imsApi';
import { getStockStatus, calculateVatMetrics } from '../../modules/inventory/validators';
import { G1Product, LowStockRow, StockStatus } from '../../modules/inventory/types';
import type { CategoryDef } from '../../modules/sales/category-rules';
import { InventoryImportModal } from './InventoryImportModal';
import { DbConnectionNotice } from './DbConnectionNotice';

type SubTab = 'all' | 'low-stock';
type ColumnPreset = 'standard' | 'pricing' | 'all';

interface InlineDraft {
  Surplus: string;
  Cena: string;
  Cena2: string;
  category: string;
}

export const InventoryModule: React.FC = () => {
  const { lang, t, apiCall, showToast, dbMode, dbContextReady, dbStatus, currentStore } = useIms();
  const skladBlocked = dbContextReady && dbMode === 'mssql' && !dbStatus.sklad.ok;
  const suppliersLoadedRef = useRef(false);

  const [subTab, setSubTab] = useState<SubTab>('all');
  const [columnPreset, setColumnPreset] = useState<ColumnPreset>('standard');

  // Filter & pagination state
  const [searchInput, setSearchInput] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [supplier, setSupplier] = useState('');
  const [stockFilter, setStockFilter] = useState<'' | StockStatus>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sortBy, setSortBy] = useState('Barcode');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Data state (never wiped on transient error)
  const [rows, setRows] = useState<G1Product[]>([]);
  const [total, setTotal] = useState(0);
  const [lowStockRows, setLowStockRows] = useState<LowStockRow[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [categories, setCategories] = useState<CategoryDef[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Inline Quick Edit state
  const [inlineBarcode, setInlineBarcode] = useState<string | null>(null);
  const [inlineDraft, setInlineDraft] = useState<InlineDraft | null>(null);
  const [savingInline, setSavingInline] = useState(false);
  const [flashBarcode, setFlashBarcode] = useState<string | null>(null);

  // Template & Excel Menu dropdown
  const [isExcelMenuOpen, setIsExcelMenuOpen] = useState(false);
  const excelMenuRef = useRef<HTMLDivElement>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Full Edit Modal state
  const [editingProduct, setEditingProduct] = useState<G1Product | null>(null);
  const [editForm, setEditForm] = useState<{
    Nazov: string;
    name_zh: string;
    Kod: string;
    Surplus: string;
    Cena: string;
    Cena2: string;
    Supplier: string;
    barcode2nd: string;
    conv2ndtobarcode: string;
    category: string;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<G1Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Create Modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [showCreateAdvanced, setShowCreateAdvanced] = useState(false);
  const [createForm, setCreateForm] = useState({
    Barcode: '',
    Nazov: '',
    Cena: '',
    Kod: '',
    Surplus: '',
    Cena2: '',
    Supplier: '',
    barcode2nd: '',
    conv2ndtobarcode: '',
  });
  const [createBarcodeError, setCreateBarcodeError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isExcelMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (excelMenuRef.current && !excelMenuRef.current.contains(e.target as Node)) {
        setIsExcelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isExcelMenuOpen]);

  const loadSuppliers = useCallback(async () => {
    try {
      const list = await apiCall<string[]>('/api/g1/suppliers');
      setSuppliers(list);
      suppliersLoadedRef.current = true;
    } catch {
      // non-fatal
    }
  }, [apiCall]);

  useEffect(() => {
    if (!currentStore) return;
    let disposed = false;
    setCategories([]);
    apiCall<CategoryDef[]>('/api/g1/categories').then(
      (list) => { if (!disposed) setCategories(list); },
      (error) => { if (!disposed) showToast(error.message, 'error'); },
    );
    return () => { disposed = true; };
  }, [apiCall, currentStore?.id, showToast]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const params = new URLSearchParams();
      if (appliedQ.trim()) params.set('q', appliedQ.trim());
      if (supplier) params.set('supplier', supplier);
      if (stockFilter) params.set('stock', stockFilter);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);

      const data = await apiCall<{ rows: G1Product[]; total: number }>(`/api/g1/products?${params.toString()}`);
      setRows(data.rows);
      setTotal(data.total);
      if (!suppliersLoadedRef.current) {
        loadSuppliers();
      }
    } catch (err: any) {
      const msg = err?.message || '加载库存列表失败';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [appliedQ, supplier, stockFilter, page, pageSize, sortBy, sortDir, apiCall, showToast, loadSuppliers]);

  const loadLowStock = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiCall<{ rows: LowStockRow[]; total: number }>('/api/g1/low-stock');
      setLowStockRows(data.rows);
    } catch (err: any) {
      const msg = err?.message || '加载低库存告警失败';
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [apiCall, showToast]);

  useEffect(() => {
    if (!dbContextReady || skladBlocked) return;
    if (subTab === 'all') {
      loadProducts();
    } else {
      loadLowStock();
    }
  }, [dbContextReady, skladBlocked, subTab, loadProducts, loadLowStock]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
    setPage(1);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedQ(searchInput);
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setAppliedQ('');
    setSupplier('');
    setStockFilter('');
    setPage(1);
  };

  // Inline Quick Edit Handlers
  const startInlineEdit = (product: G1Product) => {
    setInlineBarcode(product.Barcode);
    setInlineDraft({
      Surplus: String(product.Surplus ?? 0),
      Cena: String(product.Cena ?? 0),
      Cena2: String(product.Cena2 ?? 0),
      category: product.category || '',
    });
  };

  const cancelInlineEdit = () => {
    setInlineBarcode(null);
    setInlineDraft(null);
  };

  const saveInlineEdit = async (product: G1Product) => {
    if (!inlineDraft || savingInline) return;
    const surplusVal = Number(inlineDraft.Surplus);
    const cenaVal = Number(inlineDraft.Cena);
    const cena2Val = Number(inlineDraft.Cena2);

    if (!Number.isFinite(surplusVal)) {
      showToast(lang === 'zh' ? '库存数量必须为有效数字' : 'Zásoba musí byť platné číslo', 'error');
      return;
    }
    if (!Number.isFinite(cenaVal) || cenaVal < 0 || !Number.isFinite(cena2Val) || cena2Val < 0) {
      showToast(lang === 'zh' ? '售价与进货价必须为非负数字' : 'Ceny musia byť nezáporné', 'error');
      return;
    }

    setSavingInline(true);
    try {
      const updated = await apiCall<G1Product>(
        `/api/g1/products/${encodeURIComponent(product.Barcode)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            Surplus: surplusVal,
            Cena: cenaVal,
            Cena2: cena2Val,
          }),
        }
      );

      let nextRow = updated;
      if ((product.category || '') !== inlineDraft.category) {
        await apiCall(`/api/g1/products/${encodeURIComponent(product.Barcode)}/category`, {
          method: 'PATCH',
          body: JSON.stringify({ category: inlineDraft.category || null }),
        });
        const catObj = categories.find((c) => c.code === inlineDraft.category);
        nextRow = {
          ...updated,
          category: inlineDraft.category || null,
          category_name_zh: catObj?.name_zh || null,
          category_name_sk: catObj?.name_sk || null,
        };
      }

      setRows((prev) => prev.map((r) => (r.Barcode === product.Barcode ? nextRow : r)));
      setInlineBarcode(null);
      setInlineDraft(null);
      setFlashBarcode(product.Barcode);
      setTimeout(() => setFlashBarcode((cur) => (cur === product.Barcode ? null : cur)), 1400);
      showToast(lang === 'zh' ? `已快速更新 ${product.Nazov}` : 'Rýchlo uložené', 'success');
    } catch (err: any) {
      showToast(err?.message || '快捷保存失败', 'error');
    } finally {
      setSavingInline(false);
    }
  };

  const handleInlineKeyDown = (e: React.KeyboardEvent, product: G1Product) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveInlineEdit(product);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
    }
  };

  // Full Edit Modal Handlers
  const openEditModal = (product: G1Product) => {
    setEditingProduct(product);
    setEditForm({
      Nazov: product.Nazov || '',
      name_zh: product.name_zh || '',
      Kod: product.Kod || '',
      Surplus: String(product.Surplus ?? 0),
      Cena: String(product.Cena ?? 0),
      Cena2: String(product.Cena2 ?? 0),
      Supplier: product.Supplier || '',
      barcode2nd: product.barcode2nd || '',
      conv2ndtobarcode: String(product.conv2ndtobarcode ?? 0),
      category: product.category || '',
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct || !editForm) return;
    setSavingEdit(true);
    try {
      await apiCall<G1Product>(`/api/g1/products/${encodeURIComponent(editingProduct.Barcode)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          Nazov: editForm.Nazov,
          Kod: editForm.Kod,
          Surplus: Number(editForm.Surplus),
          Cena: Number(editForm.Cena),
          Cena2: Number(editForm.Cena2),
          Supplier: editForm.Supplier,
          barcode2nd: editForm.barcode2nd,
          conv2ndtobarcode: Number(editForm.conv2ndtobarcode || 0),
        }),
      });

      const nameChanged = (editingProduct.name_zh || '') !== editForm.name_zh;
      if ((editingProduct.category || '') !== editForm.category || nameChanged) {
        await apiCall(`/api/g1/products/${encodeURIComponent(editingProduct.Barcode)}/category`, {
          method: 'PATCH',
          body: JSON.stringify({
            category: editForm.category || null,
            ...(nameChanged ? { name_zh: editForm.name_zh } : {}),
          }),
        });
      }

      showToast(lang === 'zh' ? '商品已保存' : 'Produkt uložený', 'success');
      setEditingProduct(null);
      setEditForm(null);
      loadProducts();
      loadSuppliers();
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error');
      if (err?.httpStatus === 404) {
        setEditingProduct(null);
        loadProducts();
      }
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiCall(`/api/g1/products/${encodeURIComponent(deleteTarget.Barcode)}`, {
        method: 'DELETE',
      });
      showToast(lang === 'zh' ? `已删除商品 ${deleteTarget.Nazov}` : 'Produkt vymazaný', 'success');
      setDeleteTarget(null);
      setEditingProduct(null);
      setEditForm(null);
      loadProducts();
    } catch (err: any) {
      showToast(err?.message || '删除失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateBarcodeError(null);
    setCreating(true);
    try {
      const payload: Record<string, any> = {
        Barcode: createForm.Barcode,
        Nazov: createForm.Nazov,
      };
      if (createForm.Cena !== '') payload.Cena = Number(createForm.Cena);
      if (createForm.Kod !== '') payload.Kod = createForm.Kod;
      if (createForm.Surplus !== '') payload.Surplus = Number(createForm.Surplus);
      if (createForm.Cena2 !== '') payload.Cena2 = Number(createForm.Cena2);
      if (createForm.Supplier !== '') payload.Supplier = createForm.Supplier;
      if (createForm.barcode2nd !== '') payload.barcode2nd = createForm.barcode2nd;
      if (createForm.conv2ndtobarcode !== '') payload.conv2ndtobarcode = Number(createForm.conv2ndtobarcode);

      await apiCall<G1Product>('/api/g1/products', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      showToast(lang === 'zh' ? '商品新建成功' : 'Produkt vytvorený', 'success');
      setIsCreateOpen(false);
      setCreateForm({
        Barcode: '',
        Nazov: '',
        Cena: '',
        Kod: '',
        Surplus: '',
        Cena2: '',
        Supplier: '',
        barcode2nd: '',
        conv2ndtobarcode: '',
      });
      loadProducts();
      loadSuppliers();
    } catch (err: any) {
      if (isConflict40901(err)) {
        setCreateBarcodeError(err.message);
      } else {
        showToast(err?.message || '新建商品失败', 'error');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleExport = async () => {
    setIsExcelMenuOpen(false);
    try {
      const params = new URLSearchParams();
      if (appliedQ.trim()) params.set('q', appliedQ.trim());
      if (supplier) params.set('supplier', supplier);
      if (stockFilter) params.set('stock', stockFilter);
      params.set('sortBy', sortBy);
      params.set('sortDir', sortDir);
      await downloadImsXlsx(
        `/api/g1/export?${params.toString()}`,
        `inventory_export_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      showToast(lang === 'zh' ? '库存 XLSX 导出成功' : 'Export XLSX hotový', 'success');
    } catch (err: any) {
      showToast(err?.message || '导出失败', 'error');
    }
  };

  const handleDownloadImportTemplate = async () => {
    setIsExcelMenuOpen(false);
    try {
      await downloadImsXlsx(
        '/api/g1/import-template',
        `inventory_import_template_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      showToast(
        lang === 'zh' ? '标准库存导入模板下载成功' : 'Šablóna importu stiahnutá',
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || '模板下载失败', 'error');
    }
  };

  const renderStatusTag = (surplus: number | null | undefined, warningAt: number | null | undefined) => {
    const status = getStockStatus(surplus, warningAt);
    if (status === 'out') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0 text-rose-600" />
          <span>{t('invStockOut')}</span>
        </span>
      );
    }
    if (status === 'low') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
          <span>{t('invStockLow')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
        <span>{t('invStockIn')}</span>
      </span>
    );
  };

  const renderCategoryCell = (p: G1Product) => {
    const primary = lang === 'sk' ? p.category_name_sk || p.category_name_zh : p.category_name_zh || p.category_name_sk;
    const secondary = lang === 'sk' ? p.category_name_zh : p.category_name_sk;
    if (!primary) {
      return <span className="text-slate-400">—</span>;
    }
    return (
      <div className="min-w-0">
        <div className="text-slate-800 font-medium truncate">{primary}</div>
        {secondary && secondary !== primary && (
          <div className="text-[11px] text-slate-400 truncate">{secondary}</div>
        )}
      </div>
    );
  };

  const renderMarginDisplay = (cena: number, cena2: number) => {
    const vat = calculateVatMetrics(cena, cena2);
    const ratePct = vat.netMarginRate === null ? null : vat.netMarginRate * 100;
    const rateTone =
      ratePct === null
        ? 'text-slate-400'
        : ratePct < 10
        ? 'text-rose-700'
        : ratePct < 22
        ? 'text-amber-700'
        : 'text-emerald-700';

    return (
      <div className="text-right font-mono-numbers">
        <div className={`font-semibold ${rateTone}`}>
          {ratePct === null ? '—' : `${ratePct.toFixed(1)}%`}
        </div>
        <div className="text-[11px] text-slate-400">{formatEur(vat.netMargin)}</div>
      </div>
    );
  };

  const editVatPreview = editForm
    ? calculateVatMetrics(Number(editForm.Cena || 0), Number(editForm.Cena2 || 0))
    : null;

  const colCount = columnPreset === 'standard' ? 10 : columnPreset === 'pricing' ? 10 : 13;

  if (!dbContextReady) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-xs text-slate-500">
        {t('dbChecking')}
      </div>
    );
  }

  if (skladBlocked) {
    return <DbConnectionNotice targets={[{ name: 'SKLAD', status: dbStatus.sklad }]} />;
  }

  return (
    <div className="space-y-4">
      {/* Sub-navigation + Column Preset + Toolbar Actions */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubTab('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                subTab === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t('invAllListTab')}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('low-stock')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                subTab === 'low-stock'
                  ? 'bg-amber-600 text-white shadow-2xs'
                  : 'text-amber-800 hover:bg-amber-100/70'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{t('invLowStockTab')}</span>
            </button>
          </div>

          {subTab === 'all' && (
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 ml-1.5 mr-0.5 shrink-0" />
              {(
                [
                  ['standard', t('invPresetStandard')],
                  ['pricing', t('invPresetPricing')],
                  ['all', t('invPresetAll')],
                ] as const
              ).map(([presetKey, presetLabel]) => (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => setColumnPreset(presetKey)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    columnPreset === presetKey
                      ? 'bg-white text-indigo-700 font-semibold shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {presetLabel}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setCreateBarcodeError(null);
              setIsCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('invCreateBtn')}</span>
          </button>
          <div className="relative" ref={excelMenuRef}>
            <button
              type="button"
              aria-expanded={isExcelMenuOpen}
              onClick={() => setIsExcelMenuOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>{t('invTemplateExportBtn')}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {isExcelMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-56 bg-white rounded-xl border border-slate-200 shadow-lg py-1.5 z-40 text-xs">
                <button
                  type="button"
                  onClick={handleExport}
                  className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-slate-700 hover:bg-slate-50 font-medium"
                >
                  <Download className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  <span>{t('exportXlsx')}</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadImportTemplate}
                  className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-slate-700 hover:bg-slate-50 font-medium"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>{t('invDownloadTemplate')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsExcelMenuOpen(false);
                    setIsImportModalOpen(true);
                  }}
                  className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-indigo-700 hover:bg-indigo-50 font-semibold border-t border-slate-100 mt-1 pt-2"
                >
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                  <span>{t('invBatchImportBtn')}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error banner (non-destructive) */}
      {errorMsg && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs text-rose-800">
          <span className="font-medium">{errorMsg}</span>
          <button
            type="button"
            onClick={() => (subTab === 'all' ? loadProducts() : loadLowStock())}
            className="px-2.5 py-1 rounded bg-white border border-rose-300 font-semibold hover:bg-rose-100 whitespace-nowrap"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {subTab === 'all' ? (
        <>
          {/* Multi-filter Search Bar */}
          <form
            onSubmit={handleSearchSubmit}
            className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-center"
          >
            <div className="lg:col-span-6 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('invSearchPlaceholder')}
                className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="lg:col-span-2">
              <select
                value={supplier}
                onChange={(e) => {
                  setSupplier(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('invSupplierAll')}</option>
                {suppliers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="lg:col-span-2">
              <select
                value={stockFilter}
                onChange={(e) => {
                  setStockFilter(e.target.value as any);
                  setPage(1);
                }}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('invStockAll')}</option>
                <option value="in">{t('invStockIn')}</option>
                <option value="low">{t('invStockLow')}</option>
                <option value="out">{t('invStockOut')}</option>
              </select>
            </div>

            <div className="lg:col-span-2 flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
              >
                {lang === 'zh' ? '查询' : 'Hľadať'}
              </button>
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-2.5 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 whitespace-nowrap inline-flex items-center gap-1"
                title={t('reset')}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('reset')}</span>
              </button>
            </div>
          </form>

          {/* Desktop High-Density Template Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 tracking-wide">
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSort('Nazov')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColName')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSort('Barcode')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColBarcode')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSort('Kod')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColKod')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('Surplus')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColSurplus')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('Cena')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColCena')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleSort('Cena2')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColCena2')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => handleSort('Supplier')}
                        className="inline-flex items-center gap-1 hover:text-slate-900 whitespace-nowrap"
                      >
                        <span>{t('invColSupplier')}</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    {columnPreset !== 'pricing' && (
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('invColCategory')}</th>
                    )}
                    {columnPreset !== 'pricing' && (
                      <th className="py-2.5 px-3 whitespace-nowrap">{t('invColStatus')}</th>
                    )}
                    {columnPreset !== 'standard' && (
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">
                        {t('invVatNetPrice')}
                      </th>
                    )}
                    {columnPreset !== 'standard' && (
                      <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('invVatNetRate')}</th>
                    )}
                    {columnPreset === 'all' && (
                      <th className="py-2.5 px-3 whitespace-nowrap">barcode2nd / Conv</th>
                    )}
                    <th className="py-2.5 px-3 text-right whitespace-nowrap">{t('invColActions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {loading && rows.length === 0 ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="animate-pulse">
                        <td colSpan={colCount} className="py-3 px-4">
                          <div className="h-4 bg-slate-100 rounded w-full" />
                        </td>
                      </tr>
                    ))
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={colCount} className="py-12 text-center text-slate-500">
                        <div>{t('noData')}</div>
                        {(appliedQ || supplier || stockFilter) && (
                          <button
                            type="button"
                            onClick={handleResetFilters}
                            className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
                          >
                            {t('reset')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ) : (
                    rows.map((p) => {
                      const isInline = inlineBarcode === p.Barcode && inlineDraft !== null;
                      const status = getStockStatus(
                        isInline ? Number(inlineDraft!.Surplus) : p.Surplus,
                        p.WarningAt
                      );
                      const isLow = status === 'low';
                      const isFlashed = flashBarcode === p.Barcode;
                      const previewCena = isInline ? Number(inlineDraft!.Cena || 0) : p.Cena;
                      const previewCena2 = isInline ? Number(inlineDraft!.Cena2 || 0) : p.Cena2;
                      const previewVat = calculateVatMetrics(previewCena, previewCena2);

                      return (
                        <tr
                          key={p.Barcode}
                          className={`transition-colors ${
                            isFlashed
                              ? 'bg-indigo-50/70'
                              : isInline
                              ? 'bg-indigo-50/30'
                              : isLow
                              ? 'bg-amber-50/60 hover:bg-amber-100/60'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* 1. 品名 (Nazov) */}
                          <td className="py-2.5 px-3 max-w-[260px]">
                            <button
                              type="button"
                              onClick={() => openEditModal(p)}
                              className="font-medium text-slate-900 truncate block max-w-full text-left hover:text-indigo-700"
                              title={p.Nazov}
                            >
                              {(lang === 'zh' && p.name_zh) || p.Nazov}
                            </button>
                          </td>

                          {/* 2. 条码 (Barcode) */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-mono-numbers font-medium text-slate-800">
                            {p.Barcode}
                          </td>

                          {/* 3. KOD */}
                          <td className="py-2.5 px-3 whitespace-nowrap font-mono-numbers text-slate-600">
                            {p.Kod || '—'}
                          </td>

                          {/* 4. 数量 (Surplus / WarningAt) */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {isInline ? (
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <input
                                  type="number"
                                  step="0.01"
                                  aria-label={`Surplus ${p.Barcode}`}
                                  value={inlineDraft!.Surplus}
                                  onChange={(e) =>
                                    setInlineDraft({ ...inlineDraft!, Surplus: e.target.value })
                                  }
                                  onKeyDown={(e) => handleInlineKeyDown(e, p)}
                                  className="w-20 px-2 py-1 text-right font-mono-numbers text-xs border border-indigo-400 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <span
                                  className="text-[11px] font-mono-numbers text-slate-400"
                                  title={
                                    lang === 'zh'
                                      ? '警戒线由实物盘点(M3)维护'
                                      : 'Limit sa mení v inventúre (M3)'
                                  }
                                >
                                  / {p.WarningAt ?? 0}
                                </span>
                              </div>
                            ) : (
                              <div className="font-mono-numbers">
                                <span className="font-semibold text-slate-900">
                                  {formatQty(p.Surplus ?? 0)}
                                </span>
                                {(p.WarningAt ?? 0) > 0 && (
                                  <span
                                    className="text-[11px] text-slate-400 ml-1"
                                    title={
                                      lang === 'zh'
                                        ? `警戒线 WarningAt: ${p.WarningAt ?? 0}`
                                        : `Limit: ${p.WarningAt ?? 0}`
                                    }
                                  >
                                    / {p.WarningAt ?? 0}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* 5. 单价 (Cena) */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {isInline ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                aria-label={`Cena ${p.Barcode}`}
                                value={inlineDraft!.Cena}
                                onChange={(e) =>
                                  setInlineDraft({ ...inlineDraft!, Cena: e.target.value })
                                }
                                onKeyDown={(e) => handleInlineKeyDown(e, p)}
                                className="w-20 px-2 py-1 text-right font-mono-numbers text-xs border border-indigo-400 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            ) : (
                              <span className="font-mono-numbers font-semibold text-slate-900">
                                {formatEur(p.Cena)}
                              </span>
                            )}
                          </td>

                          {/* 6. 成本（单价2） (Cena2) */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {isInline ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                aria-label={`Cena2 ${p.Barcode}`}
                                value={inlineDraft!.Cena2}
                                onChange={(e) =>
                                  setInlineDraft({ ...inlineDraft!, Cena2: e.target.value })
                                }
                                onKeyDown={(e) => handleInlineKeyDown(e, p)}
                                className="w-20 px-2 py-1 text-right font-mono-numbers text-xs border border-indigo-400 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            ) : (
                              <span className="font-mono-numbers text-slate-600">
                                {formatEur(p.Cena2)}
                              </span>
                            )}
                          </td>

                          {/* 7. 供应商 (Supplier) */}
                          <td className="py-2.5 px-3 max-w-[160px] truncate text-slate-700" title={p.Supplier || ''}>
                            {p.Supplier || '—'}
                          </td>

                          {/* Bilingual Category */}
                          {columnPreset !== 'pricing' && (
                            <td className="py-2.5 px-3 max-w-[170px]">
                              {isInline ? (
                                <select
                                  value={inlineDraft!.category}
                                  onChange={(e) =>
                                    setInlineDraft({ ...inlineDraft!, category: e.target.value })
                                  }
                                  aria-label={`Category ${p.Barcode}`}
                                  className="w-full px-2 py-1 text-xs border border-indigo-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                  <option value="">{lang === 'zh' ? '未归类' : 'Nezaradené'}</option>
                                  {categories.map((c) => (
                                    <option key={c.code} value={c.code}>
                                      {lang === 'sk' ? `${c.name_sk} / ${c.name_zh}` : `${c.name_zh} / ${c.name_sk}`}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                renderCategoryCell(p)
                              )}
                            </td>
                          )}

                          {/* Status */}
                          {columnPreset !== 'pricing' && (
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {renderStatusTag(
                                isInline ? Number(inlineDraft!.Surplus) : p.Surplus,
                                p.WarningAt
                              )}
                            </td>
                          )}

                          {/* Net Price (excl. VAT) */}
                          {columnPreset !== 'standard' && (
                            <td className="py-2.5 px-3 text-right font-mono-numbers text-slate-600 whitespace-nowrap">
                              {formatEur(previewVat.netPrice)}
                            </td>
                          )}

                          {/* Net Margin % & EUR */}
                          {columnPreset !== 'standard' && (
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              {renderMarginDisplay(previewCena, previewCena2)}
                            </td>
                          )}

                          {/* Optional Secondary Barcode */}
                          {columnPreset === 'all' && (
                            <td className="py-2.5 px-3 font-mono-numbers text-[11px] text-slate-500 whitespace-nowrap">
                              {p.barcode2nd ? `${p.barcode2nd} (×${p.conv2ndtobarcode ?? 0})` : '—'}
                            </td>
                          )}

                          {/* Quick Edit / Full Detail Actions */}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {isInline ? (
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  disabled={savingInline}
                                  onClick={() => saveInlineEdit(p)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-indigo-600 text-white text-[11px] font-semibold hover:bg-indigo-700 disabled:opacity-50"
                                  title={t('save')}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>{t('save')}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelInlineEdit}
                                  className="p-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200"
                                  title={t('cancel')}
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => startInlineEdit(p)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100"
                                  title={t('invQuickEdit')}
                                >
                                  <PencilLine className="w-3 h-3" />
                                  <span>{t('invQuickEdit')}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(p)}
                                  className="px-2 py-1 rounded-md text-[11px] font-medium text-slate-600 hover:bg-slate-100"
                                  title={t('invEditTitle')}
                                >
                                  {t('invDetailEdit')}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile Card Layout (< 768px) */}
            <div className="md:hidden divide-y divide-slate-200">
              {loading && rows.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">{t('loading')}</div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">{t('noData')}</div>
              ) : (
                rows.map((p) => {
                  const isInline = inlineBarcode === p.Barcode && inlineDraft !== null;
                  const status = getStockStatus(
                    isInline ? Number(inlineDraft!.Surplus) : p.Surplus,
                    p.WarningAt
                  );
                  const previewCena = isInline ? Number(inlineDraft!.Cena || 0) : p.Cena;
                  const previewCena2 = isInline ? Number(inlineDraft!.Cena2 || 0) : p.Cena2;
                  const vat = calculateVatMetrics(previewCena, previewCena2);
                  const catName =
                    lang === 'sk'
                      ? p.category_name_sk || p.category_name_zh
                      : p.category_name_zh || p.category_name_sk;

                  return (
                    <div
                      key={p.Barcode}
                      className={`p-3.5 space-y-2.5 ${
                        status === 'low' ? 'bg-amber-50/60' : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-900 truncate">
                              {(lang === 'zh' && p.name_zh) || p.Nazov}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className="font-mono-numbers text-slate-700">{p.Barcode}</span>
                            {p.Kod && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-numbers">{p.Kod}</span>
                              </>
                            )}
                            {p.Supplier && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{p.Supplier}</span>
                              </>
                            )}
                            {catName && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-600">{catName}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {renderStatusTag(
                          isInline ? Number(inlineDraft!.Surplus) : p.Surplus,
                          p.WarningAt
                        )}
                      </div>

                      {isInline ? (
                        <div className="space-y-2 pt-1 border-t border-slate-200/70 text-xs">
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-0.5">
                                {t('invColSurplus')}
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                value={inlineDraft!.Surplus}
                                onChange={(e) =>
                                  setInlineDraft({ ...inlineDraft!, Surplus: e.target.value })
                                }
                                className="w-full px-2 py-1.5 rounded-md border border-indigo-400 font-mono-numbers text-right"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-0.5">
                                Cena (VAT)
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={inlineDraft!.Cena}
                                onChange={(e) =>
                                  setInlineDraft({ ...inlineDraft!, Cena: e.target.value })
                                }
                                className="w-full px-2 py-1.5 rounded-md border border-indigo-400 font-mono-numbers text-right"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-0.5">
                                Cena2
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={inlineDraft!.Cena2}
                                onChange={(e) =>
                                  setInlineDraft({ ...inlineDraft!, Cena2: e.target.value })
                                }
                                className="w-full px-2 py-1.5 rounded-md border border-indigo-400 font-mono-numbers text-right"
                              />
                            </div>
                          </div>
                          <div>
                            <select
                              value={inlineDraft!.category}
                              onChange={(e) =>
                                setInlineDraft({ ...inlineDraft!, category: e.target.value })
                              }
                              className="w-full px-2.5 py-1.5 rounded-md border border-indigo-300 bg-white text-xs"
                            >
                              <option value="">{lang === 'zh' ? '未归类' : 'Nezaradené'}</option>
                              {categories.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {c.name_zh} / {c.name_sk}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-[11px] font-mono-numbers text-slate-600">
                              {t('invVatNetRate')}:{' '}
                              <strong>
                                {vat.netMarginRate === null
                                  ? '—'
                                  : `${(vat.netMarginRate * 100).toFixed(1)}%`}
                              </strong>
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={cancelInlineEdit}
                                className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-semibold"
                              >
                                {t('cancel')}
                              </button>
                              <button
                                type="button"
                                disabled={savingInline}
                                onClick={() => saveInlineEdit(p)}
                                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold"
                              >
                                {t('save')}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                          <div className="grid grid-cols-3 gap-3 font-mono-numbers">
                            <div>
                              <div className="text-[10px] text-slate-400">{t('invColStockThreshold')}</div>
                              <div className="font-semibold text-slate-900">
                                {formatQty(p.Surplus ?? 0)}{' '}
                                <span className="text-slate-400">/ {p.WarningAt ?? 0}</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">Cena / Cena2</div>
                              <div className="font-semibold text-slate-900">
                                {formatEur(p.Cena)}{' '}
                                <span className="text-slate-400 text-[11px]">/ {formatEur(p.Cena2)}</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-slate-400">{t('invVatNetRate')}</div>
                              <div className="font-semibold text-emerald-700">
                                {vat.netMarginRate === null
                                  ? '—'
                                  : `${(vat.netMarginRate * 100).toFixed(1)}%`}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => startInlineEdit(p)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 font-semibold text-[11px]"
                            >
                              {t('invQuickEdit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(p)}
                              className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-700 font-medium text-[11px]"
                            >
                              {t('invDetailEdit')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Pagination Footer */}
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center gap-3">
                <span className="font-mono-numbers">
                  {t('invTotalPrefix')} <strong className="text-slate-900">{total}</strong> {t('invTotalSuffix')}
                </span>
                <label className="inline-flex items-center gap-1.5">
                  <span>{t('invPageSize')}</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value));
                      setPage(1);
                    }}
                    className="border border-slate-300 rounded px-2 py-1 bg-white text-xs font-mono-numbers"
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-mono-numbers px-2">
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="p-1.5 rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-50"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Low Stock Alert View */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-amber-50/70 border-b border-amber-200 text-[11px] font-semibold text-amber-900 uppercase">
                  <th className="py-2.5 px-3">{t('invColBarcode')} / Kod</th>
                  <th className="py-2.5 px-3">{t('invColName')} · Supplier</th>
                  <th className="py-2.5 px-3">{t('invColCategory')}</th>
                  <th className="py-2.5 px-3 text-right">{t('invColSurplus')}</th>
                  <th className="py-2.5 px-3 text-right">{t('invColThreshold')}</th>
                  <th className="py-2.5 px-3 text-right">{t('invColGap')}</th>
                  <th className="py-2.5 px-3">{t('invColStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {lowStockRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-500">
                      {loading ? t('loading') : t('noData')}
                    </td>
                  </tr>
                ) : (
                  lowStockRows.map((p) => (
                    <tr key={p.Barcode} className="bg-amber-50/40 hover:bg-amber-50">
                      <td className="py-2.5 px-3 font-mono-numbers">
                        <div className="font-medium text-slate-700">{p.Barcode}</div>
                        {p.Kod && <div className="text-[11px] text-slate-400">{p.Kod}</div>}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{p.Nazov}</div>
                        {p.Supplier && <div className="text-[11px] text-slate-400">{p.Supplier}</div>}
                      </td>
                      <td className="py-2.5 px-3">{renderCategoryCell(p)}</td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers font-semibold">
                        {formatQty(p.Surplus)}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers">{p.WarningAt}</td>
                      <td className="py-2.5 px-3 text-right font-mono-numbers font-bold text-rose-700">
                        +{formatQty(p.Gap)}
                      </td>
                      <td className="py-2.5 px-3">{renderStatusTag(p.Surplus, p.WarningAt)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Batch Import Modal */}
      <InventoryImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImported={() => {
          loadProducts();
          loadSuppliers();
        }}
      />

      {/* Full Edit Modal (Barcode readonly, NO WarningAt, Left Delete button) */}
      {editingProduct && editForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-xl w-full shadow-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">{t('invEditTitle')}</h3>
              <button
                type="button"
                onClick={() => {
                  setEditingProduct(null);
                  setEditForm(null);
                }}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">
                    Barcode ({lang === 'zh' ? '只读' : 'Len na čítanie'})
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={editingProduct.Barcode}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-500 font-mono-numbers"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kod</label>
                  <input
                    type="text"
                    value={editForm.Kod}
                    onChange={(e) => setEditForm({ ...editForm, Kod: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Nazov *</label>
                  <input
                    type="text"
                    required
                    value={editForm.Nazov}
                    onChange={(e) => setEditForm({ ...editForm, Nazov: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
                <label className="sm:col-span-2 block font-semibold text-slate-700">
                  {lang === 'zh' ? '中文品名' : 'Čínsky názov produktu'}
                  <input
                    type="text"
                    maxLength={256}
                    value={editForm.name_zh}
                    onChange={(e) => setEditForm({ ...editForm, name_zh: e.target.value })}
                    className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 font-normal"
                  />
                </label>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Surplus</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.Surplus}
                    onChange={(e) => setEditForm({ ...editForm, Surplus: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Supplier</label>
                  <input
                    type="text"
                    value={editForm.Supplier}
                    onChange={(e) => setEditForm({ ...editForm, Supplier: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('invColCena')}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.Cena}
                    onChange={(e) => setEditForm({ ...editForm, Cena: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">{t('invColCena2')}</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editForm.Cena2}
                    onChange={(e) => setEditForm({ ...editForm, Cena2: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">barcode2nd</label>
                  <input
                    type="text"
                    value={editForm.barcode2nd}
                    onChange={(e) => setEditForm({ ...editForm, barcode2nd: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">conv2ndtobarcode</label>
                  <input
                    type="number"
                    step="1"
                    value={editForm.conv2ndtobarcode}
                    onChange={(e) => setEditForm({ ...editForm, conv2ndtobarcode: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">{t('invColCategory')}</label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="">{lang === 'zh' ? '未归类' : 'Nezaradené'}</option>
                    {categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name_zh} / {c.name_sk}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {editVatPreview && (
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 text-[11px] grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <div className="text-slate-500">{t('invVatNetPrice')}</div>
                    <div className="font-mono-numbers font-bold text-slate-900">
                      {formatEur(editVatPreview.netPrice)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">{t('invVatGross')}</div>
                    <div className="font-mono-numbers font-bold text-slate-900">
                      {formatEur(editVatPreview.grossMarginWithVat)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">{t('invVatNetMargin')}</div>
                    <div className="font-mono-numbers font-bold text-slate-900">
                      {formatEur(editVatPreview.netMargin)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">{t('invVatNetRate')}</div>
                    <div className="font-mono-numbers font-bold text-slate-900">
                      {editVatPreview.netMarginRate === null
                        ? '—'
                        : `${(editVatPreview.netMarginRate * 100).toFixed(1)}%`}
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(editingProduct)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{t('delete')}</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProduct(null);
                      setEditForm(null);
                    }}
                    className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200"
                  >
                    {t('cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={savingEdit}
                    className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {savingEdit ? '...' : t('save')}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Second Confirmation Delete Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-5 shadow-xl space-y-4">
            <h4 className="text-sm font-bold text-rose-700">{t('invDeleteConfirmTitle')}</h4>
            <p className="text-xs text-slate-600">{t('invDeleteConfirmDesc')}</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
              <div className="font-bold text-slate-900">{deleteTarget.Nazov}</div>
              <div className="font-mono-numbers text-slate-500 mt-0.5">{deleteTarget.Barcode}</div>
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
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Product Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-lg w-full shadow-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">{t('invCreateTitle')}</h3>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Barcode *</label>
                <input
                  type="text"
                  required
                  value={createForm.Barcode}
                  onChange={(e) => {
                    setCreateForm({ ...createForm, Barcode: e.target.value });
                    if (createBarcodeError) setCreateBarcodeError(null);
                  }}
                  className={`w-full px-3 py-2 rounded-lg border font-mono-numbers ${
                    createBarcodeError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-300'
                  }`}
                />
                {createBarcodeError && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600">{createBarcodeError}</p>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Nazov *</label>
                <input
                  type="text"
                  required
                  value={createForm.Nazov}
                  onChange={(e) => setCreateForm({ ...createForm, Nazov: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cena (EUR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.Cena}
                    onChange={(e) => setCreateForm({ ...createForm, Cena: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Cena2 (EUR)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.Cena2}
                    onChange={(e) => setCreateForm({ ...createForm, Cena2: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Surplus</label>
                  <input
                    type="number"
                    step="0.01"
                    value={createForm.Surplus}
                    onChange={(e) => setCreateForm({ ...createForm, Surplus: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Kod</label>
                  <input
                    type="text"
                    value={createForm.Kod}
                    onChange={(e) => setCreateForm({ ...createForm, Kod: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Supplier</label>
                <input
                  type="text"
                  value={createForm.Supplier}
                  onChange={(e) => setCreateForm({ ...createForm, Supplier: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setShowCreateAdvanced((v) => !v)}
                  className="text-[11px] text-indigo-600 hover:underline font-semibold"
                >
                  {showCreateAdvanced
                    ? '- 收起第二条码/换算率'
                    : '+ 展开第二条码 (barcode2nd / conv2ndtobarcode)'}
                </button>
                {showCreateAdvanced && (
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <input
                      type="text"
                      placeholder="barcode2nd"
                      value={createForm.barcode2nd}
                      onChange={(e) => setCreateForm({ ...createForm, barcode2nd: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                    />
                    <input
                      type="number"
                      placeholder="conv2ndtobarcode"
                      value={createForm.conv2ndtobarcode}
                      onChange={(e) =>
                        setCreateForm({ ...createForm, conv2ndtobarcode: e.target.value })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                    />
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3 py-2 rounded-lg font-semibold bg-slate-100 text-slate-700"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {creating ? '...' : t('save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
