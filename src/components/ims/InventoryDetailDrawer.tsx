import React, { useEffect, useState } from 'react';
import { X, Trash2, AlertTriangle, CheckCircle2, XCircle, Lock } from 'lucide-react';
import { useIms } from '../../context/ImsContext';
import { formatEur, formatQty } from '../../utils/imsApi';
import type { CategoryDef } from '../../modules/sales/category-rules';
import type { G1Product } from '../../modules/inventory/types';
import { calculateVatMetrics, getStockStatus } from '../../modules/inventory/validators';
import {
  buildEditProductPatch,
  createInitialEditForm,
  EditProductFormState,
  hasCostData,
  resolveProductDisplayLines,
} from '../../modules/inventory/viewHelpers';

interface InventoryDetailDrawerProps {
  product: G1Product | null;
  categories: CategoryDef[];
  suppliers: string[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

type DrawerSection = 'general' | 'pricing' | 'stock';

export const InventoryDetailDrawer: React.FC<InventoryDetailDrawerProps> = ({
  product,
  categories,
  suppliers,
  onClose,
  onSaved,
  onDeleted,
}) => {
  const { lang, t, apiCall, showToast } = useIms();
  const [form, setForm] = useState<EditProductFormState | null>(null);
  const [activeSection, setActiveSection] = useState<DrawerSection>('general');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (product) {
      setForm(createInitialEditForm(product));
      setActiveSection('general');
      setConfirmDeleteOpen(false);
    } else {
      setForm(null);
    }
  }, [product]);

  useEffect(() => {
    if (!product) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmDeleteOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [product, confirmDeleteOpen, onClose]);

  if (!product || !form) return null;

  const liveStatus = getStockStatus(
    form.Surplus === '' ? 0 : Number(form.Surplus),
    product.WarningAt
  );
  const costNum = form.Cena2 === '' ? 0 : Number(form.Cena2);
  const hasValidCost = hasCostData(costNum);
  const vatPreview = calculateVatMetrics(
    Number(form.Cena || 0),
    costNum
  );
  const headerNameLines = resolveProductDisplayLines(product.Nazov, product.name_zh, lang);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await apiCall<G1Product>(`/api/g1/products/${encodeURIComponent(product.Barcode)}`, {
        method: 'PATCH',
        body: JSON.stringify(buildEditProductPatch(form)),
      });

      const nameChanged = (product.name_zh || '') !== form.name_zh.trim();
      const catChanged = (product.category || '') !== form.category;
      if (catChanged || nameChanged) {
        await apiCall(`/api/g1/products/${encodeURIComponent(product.Barcode)}/category`, {
          method: 'PATCH',
          body: JSON.stringify({
            category: form.category || null,
            ...(nameChanged ? { name_zh: form.name_zh.trim() } : {}),
          }),
        });
      }

      showToast(lang === 'zh' ? '商品主数据已保存' : 'Produkt uložený', 'success');
      onSaved();
      onClose();
    } catch (err: any) {
      showToast(err?.message || '保存失败', 'error');
      if (err?.httpStatus === 404) {
        onSaved();
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiCall(`/api/g1/products/${encodeURIComponent(product.Barcode)}`, {
        method: 'DELETE',
      });
      showToast(lang === 'zh' ? `已删除商品 ${product.Nazov}` : 'Produkt vymazaný', 'success');
      setConfirmDeleteOpen(false);
      onDeleted();
      onClose();
    } catch (err: any) {
      showToast(err?.message || '删除失败', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const renderStatusInline = () => {
    if (liveStatus === 'out') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 text-rose-600" />
          <span>{t('invStockOut')}</span>
        </span>
      );
    }
    if (liveStatus === 'low') {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
          <span>{t('invStockLow')}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        <span>{t('invStockIn')}</span>
      </span>
    );
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-slate-900/35 backdrop-blur-2xs flex justify-end"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t('invEditTitle')}
          data-testid="inventory-detail-drawer"
          className="bg-white w-full max-w-2xl h-full border-l border-slate-200 shadow-2xl flex flex-col"
        >
          {/* Drawer Header */}
          <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-4 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="font-mono-numbers text-slate-700 font-medium">{product.Barcode}</span>
                {product.Kod && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-numbers">{product.Kod}</span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                {renderStatusInline()}
              </div>
              <h3 className="text-base font-bold text-slate-900 truncate mt-1">
                {headerNameLines.line1 || '—'}
              </h3>
              {headerNameLines.line2 && (
                <p className="text-xs text-slate-500 truncate mt-0.5">{headerNameLines.line2}</p>
              )}
              {headerNameLines.line3 && (
                <p className="text-xs text-slate-400 truncate mt-0.5">{headerNameLines.line3}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Section Segmented Switch */}
          <div className="px-5 py-2.5 border-b border-slate-200 bg-slate-50/70 shrink-0">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
              {(
                [
                  ['general', lang === 'zh' ? '基础与分类' : 'Základné údaje'],
                  ['pricing', lang === 'zh' ? '价格与 VAT 毛利' : 'Ceny a DPH'],
                  ['stock', lang === 'zh' ? '库存与包装参数' : 'Zásoba a balenie'],
                ] as const
              ).map(([secKey, secLabel]) => (
                <button
                  key={secKey}
                  type="button"
                  onClick={() => setActiveSection(secKey)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                    activeSection === secKey
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {secLabel}
                </button>
              ))}
            </div>
          </div>

          {/* Form Body */}
          <form onSubmit={handleSave} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-xs">
              {activeSection === 'general' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-600 mb-1">
                        Barcode ({lang === 'zh' ? '主键只读' : 'Len na čítanie'})
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={product.Barcode}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-500 font-mono-numbers"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Kod</label>
                      <input
                        type="text"
                        value={form.Kod}
                        onChange={(e) => setForm({ ...form, Kod: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? 'POS 原始品名 (Nazov) *' : 'Názov produktu (Nazov) *'}
                      </label>
                      <input
                        type="text"
                        required
                        value={form.Nazov}
                        onChange={(e) => setForm({ ...form, Nazov: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '中文品名 (门店扩展名称)' : 'Čínsky názov produktu'}
                      </label>
                      <input
                        type="text"
                        maxLength={256}
                        value={form.name_zh}
                        onChange={(e) => setForm({ ...form, name_zh: e.target.value })}
                        placeholder={lang === 'zh' ? '选填：便于中文店员识别' : 'Voliteľné'}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {t('invColSupplier')} (Supplier)
                      </label>
                      <input
                        type="text"
                        list="inv-drawer-suppliers"
                        value={form.Supplier}
                        onChange={(e) => setForm({ ...form, Supplier: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <datalist id="inv-drawer-suppliers">
                        {suppliers.map((s) => (
                          <option key={s} value={s} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {t('invColCategory')}
                      </label>
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">{lang === 'zh' ? '未归类' : 'Nezaradené'}</option>
                        {categories.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name_zh} / {c.name_sk}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '采购原产地 (PurchaseCountry)' : 'Krajina pôvodu'}
                      </label>
                      <input
                        type="text"
                        value={form.PurchaseCountry}
                        onChange={(e) => setForm({ ...form, PurchaseCountry: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '保质期 / 效期 (ExpiryDate)' : 'Dátum spotreby (ExpiryDate)'}
                      </label>
                      <input
                        type="text"
                        placeholder="YYYY-MM-DD"
                        value={form.ExpiryDate}
                        onChange={(e) => setForm({ ...form, ExpiryDate: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'pricing' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {t('invColCena')} — Cena (EUR, 含 23% VAT)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.Cena}
                        onChange={(e) => setForm({ ...form, Cena: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {t('invColCena2')} — Cena2 (EUR, 不含税)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.Cena2}
                        onChange={(e) => setForm({ ...form, Cena2: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '原售价 (PovCena, EUR)' : 'Pôvodná cena (PovCena)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.PovCena}
                        onChange={(e) => setForm({ ...form, PovCena: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '参考采购价 (PurchasePrice, EUR)' : 'Nákupná cena (PurchasePrice)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={form.PurchasePrice}
                        onChange={(e) => setForm({ ...form, PurchasePrice: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '税率档位 (DPHtype)' : 'Sadzba DPH (DPHtype)'}
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={form.DPHtype}
                        onChange={(e) => setForm({ ...form, DPHtype: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-end pb-1.5">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={form.VIPnoDiscount}
                          onChange={(e) => setForm({ ...form, VIPnoDiscount: e.target.checked })}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-medium text-slate-700">
                          {lang === 'zh' ? '不参与 VIP 折扣 (VIPnoDiscount)' : 'Bez VIP zľavy (VIPnoDiscount)'}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Live VAT 23% Breakdown */}
                  <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-600">
                      {t('invVatPreview')}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                      <div>
                        <div className="text-[11px] text-slate-500">{t('invVatNetPrice')}</div>
                        <div className="font-mono-numbers text-sm font-bold text-slate-900 mt-0.5">
                          {formatEur(vatPreview.netPrice)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">{t('invVatGross')}</div>
                        <div className="font-mono-numbers text-sm font-bold text-slate-900 mt-0.5">
                          {formatEur(vatPreview.grossMarginWithVat)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">{t('invVatNetMargin')}</div>
                        <div
                          className={`font-mono-numbers text-sm font-bold mt-0.5 ${
                            !hasValidCost ? 'text-rose-600' : 'text-slate-900'
                          }`}
                        >
                          {!hasValidCost ? 'error' : formatEur(vatPreview.netMargin)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-500">{t('invVatNetRate')}</div>
                        <div
                          className={`font-mono-numbers text-sm font-bold mt-0.5 ${
                            !hasValidCost
                              ? 'text-rose-600'
                              : vatPreview.netMarginRate === null
                              ? 'text-slate-400'
                              : vatPreview.netMarginRate * 100 < 10
                              ? 'text-rose-700'
                              : vatPreview.netMarginRate * 100 < 22
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {!hasValidCost
                            ? 'error'
                            : vatPreview.netMarginRate === null
                            ? '—'
                            : `${(vatPreview.netMarginRate * 100).toFixed(1)}%`}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeSection === 'stock' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {t('invColSurplus')} (Surplus)
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={form.Surplus}
                        onChange={(e) => setForm({ ...form, Surplus: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="flex items-center gap-1 font-semibold text-slate-500 mb-1">
                        <Lock className="w-3 h-3" />
                        <span>
                          {t('invColThreshold')} (WarningAt · {lang === 'zh' ? '盘点维护' : 'Inventúra M3'})
                        </span>
                      </label>
                      <input
                        type="text"
                        readOnly
                        value={formatQty(product.WarningAt)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-500 font-mono-numbers"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '货架库存 (Shelves)' : 'Regálová zásoba (Shelves)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={form.Shelves}
                        onChange={(e) => setForm({ ...form, Shelves: e.target.value })}
                        placeholder="—"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '基础规格量 (Mnozstvo)' : 'Základné množstvo (Mnozstvo)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={form.Mnozstvo}
                        onChange={(e) => setForm({ ...form, Mnozstvo: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '第二条码 (barcode2nd)' : 'Sekundárny kód (barcode2nd)'}
                      </label>
                      <input
                        type="text"
                        maxLength={13}
                        value={form.barcode2nd}
                        onChange={(e) => setForm({ ...form, barcode2nd: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '箱规换算系数 (conv2ndtobarcode)' : 'Konverzia balenia (conv2ndtobarcode)'}
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={form.conv2ndtobarcode}
                        onChange={(e) => setForm({ ...form, conv2ndtobarcode: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Dozen</label>
                      <input
                        type="number"
                        step="1"
                        value={form.Dozen}
                        onChange={(e) => setForm({ ...form, Dozen: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Box</label>
                      <input
                        type="number"
                        step="1"
                        value={form.Box}
                        onChange={(e) => setForm({ ...form, Box: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">
                        {lang === 'zh' ? '菜单包装标识 (menupackage)' : 'Balenie (menupackage)'}
                      </label>
                      <input
                        type="text"
                        value={form.menupackage}
                        onChange={(e) => setForm({ ...form, menupackage: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-end pb-1.5">
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={form.Reserved}
                          onChange={(e) => setForm({ ...form, Reserved: e.target.checked })}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="font-medium text-slate-700">
                          {lang === 'zh' ? '预留锁定 (Reserved)' : 'Rezervované (Reserved)'}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Read-only G1 System Metadata */}
                  <div className="bg-slate-50 rounded-lg border border-slate-200 px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-500">
                    <span>
                      InstallDate:{' '}
                      <strong className="font-mono-numbers text-slate-700">
                        {product.InstallDate ? product.InstallDate.slice(0, 10) : '—'}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      LastInstallQty:{' '}
                      <strong className="font-mono-numbers text-slate-700">
                        {formatQty(product.LastInstallQty)}
                      </strong>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 whitespace-nowrap"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('delete')}</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 whitespace-nowrap"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                >
                  {saving ? '...' : t('save')}
                </button>
              </div>
            </div>
          </form>
        </aside>
      </div>

      {/* Delete Confirmation Modal */}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-5 shadow-xl space-y-4">
            <h4 className="text-sm font-bold text-rose-700">{t('invDeleteConfirmTitle')}</h4>
            <p className="text-xs text-slate-600">{t('invDeleteConfirmDesc')}</p>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs">
              <div className="font-bold text-slate-900">{headerNameLines.line1 || '—'}</div>
              {headerNameLines.line2 && (
                <div className="text-slate-600 mt-0.5">{headerNameLines.line2}</div>
              )}
              <div className="font-mono-numbers text-slate-500 mt-0.5">{product.Barcode}</div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
