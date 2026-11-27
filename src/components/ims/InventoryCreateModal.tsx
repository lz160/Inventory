import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useIms, isConflict40901 } from '../../context/ImsContext';
import type { CategoryDef } from '../../modules/sales/category-rules';
import type { G1Product } from '../../modules/inventory/types';
import {
  buildCreateProductBody,
  createEmptyProductForm,
  CreateProductFormState,
} from '../../modules/inventory/viewHelpers';

interface InventoryCreateModalProps {
  isOpen: boolean;
  categories: CategoryDef[];
  suppliers: string[];
  onClose: () => void;
  onCreated: () => void;
}

export const InventoryCreateModal: React.FC<InventoryCreateModalProps> = ({
  isOpen,
  categories,
  suppliers,
  onClose,
  onCreated,
}) => {
  const { lang, t, apiCall, showToast } = useIms();
  const [form, setForm] = useState<CreateProductFormState>(createEmptyProductForm);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleClose = () => {
    setBarcodeError(null);
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setBarcodeError(null);
    setSubmitting(true);
    try {
      await apiCall<G1Product>('/api/g1/products', {
        method: 'POST',
        body: JSON.stringify(buildCreateProductBody(form)),
      });
      showToast(lang === 'zh' ? '商品新建成功' : 'Produkt vytvorený', 'success');
      setForm(createEmptyProductForm());
      setShowAdvanced(false);
      onCreated();
      onClose();
    } catch (err: any) {
      if (isConflict40901(err)) {
        setBarcodeError(err.message);
      } else {
        showToast(err?.message || '新建商品失败', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('invCreateTitle')}
        className="bg-white rounded-xl border border-slate-200 max-w-lg w-full shadow-xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">{t('invCreateTitle')}</h3>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t('close')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3.5 text-xs max-h-[82vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Barcode *</label>
              <input
                type="text"
                required
                maxLength={13}
                value={form.Barcode}
                onChange={(e) => {
                  setForm({ ...form, Barcode: e.target.value });
                  if (barcodeError) setBarcodeError(null);
                }}
                className={`w-full px-3 py-2 rounded-lg border font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                  barcodeError ? 'border-rose-500 ring-1 ring-rose-500' : 'border-slate-300'
                }`}
              />
              {barcodeError && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600">{barcodeError}</p>
              )}
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
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nazov *</label>
            <input
              type="text"
              required
              value={form.Nazov}
              onChange={(e) => setForm({ ...form, Nazov: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Cena (EUR)</label>
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
              <label className="block font-semibold text-slate-700 mb-1">Cena2 (EUR)</label>
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
              <label className="block font-semibold text-slate-700 mb-1">Surplus</label>
              <input
                type="number"
                step="0.01"
                value={form.Surplus}
                onChange={(e) => setForm({ ...form, Surplus: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">{t('invColSupplier')}</label>
              <input
                type="text"
                list="inv-create-suppliers"
                value={form.Supplier}
                onChange={(e) => setForm({ ...form, Supplier: e.target.value })}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <datalist id="inv-create-suppliers">
                {suppliers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">{t('invColCategory')}</label>
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
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[11px] text-indigo-600 hover:underline font-semibold"
            >
              {showAdvanced
                ? lang === 'zh'
                  ? '- 收起第二条码与效期选项'
                  : '- Skryť rozšírené polia'
                : lang === 'zh'
                ? '+ 展开第二条码与效期 (barcode2nd / ExpiryDate)'
                : '+ Rozbaliť sekundárny kód a dátum spotreby'}
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-2">
                <input
                  type="text"
                  maxLength={13}
                  placeholder="barcode2nd"
                  value={form.barcode2nd}
                  onChange={(e) => setForm({ ...form, barcode2nd: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                />
                <input
                  type="number"
                  step="1"
                  placeholder="conv2ndtobarcode"
                  value={form.conv2ndtobarcode}
                  onChange={(e) => setForm({ ...form, conv2ndtobarcode: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                />
                <input
                  type="text"
                  placeholder="ExpiryDate (YYYY-MM-DD)"
                  value={form.ExpiryDate}
                  onChange={(e) => setForm({ ...form, ExpiryDate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-numbers"
                />
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-lg font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? '...' : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
