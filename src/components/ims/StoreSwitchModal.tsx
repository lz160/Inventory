import React, { useState } from 'react';
import { X, Store, Loader2, Check, LogOut, ArrowRightLeft } from 'lucide-react';
import { useIms } from '../../context/ImsContext';

interface StoreSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const StoreSwitchModal: React.FC<StoreSwitchModalProps> = ({ isOpen, onClose }) => {
  const {
    lang,
    t,
    user,
    availableStores,
    currentStore,
    selectStore,
    logout,
    showToast,
  } = useIms();
  const [switchingId, setSwitchingId] = useState<number | null>(null);

  if (!isOpen || !user) return null;

  const handleSelect = async (storeId: number, storeName: string) => {
    if (currentStore?.id === storeId) {
      onClose();
      return;
    }
    setSwitchingId(storeId);
    try {
      await selectStore(storeId);
      showToast(
        lang === 'zh' ? `已切换至门店 ${storeName}` : `Prepnuté na predajňu ${storeName}`,
        'success'
      );
      onClose();
    } catch (err: any) {
      showToast(err?.message || '切换门店失败', 'error');
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('authSwitchModalTitle')}
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{t('authSwitchModalTitle')}</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {user.displayName} ({user.username})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            aria-label={t('close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
          {availableStores.map((s) => {
            const isCurrent = currentStore?.id === s.id;
            const isLoading = switchingId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                data-testid={`switch-store-option-${s.storeCode}`}
                disabled={switchingId !== null}
                onClick={() => handleSelect(s.id, s.storeName)}
                className={`flex items-center justify-between w-full px-3.5 py-2.5 rounded-xl border text-left transition-colors ${
                  isCurrent
                    ? 'bg-indigo-50/70 border-indigo-500 text-indigo-950'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-indigo-300'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Store
                    className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-indigo-600' : 'text-slate-400'}`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">
                      {s.storeName}
                      {isCurrent && (
                        <span className="ml-1.5 text-[11px] font-medium text-indigo-600">
                          · {t('storeCurrentBadge')}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono-numbers text-slate-500">{s.storeCode}</div>
                  </div>
                </div>
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
                ) : isCurrent ? (
                  <Check className="w-4 h-4 text-indigo-600 shrink-0" />
                ) : (
                  <span className="text-[11px] font-semibold text-indigo-600 shrink-0">
                    {t('storeSwitchAction')}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <button
            type="button"
            data-testid="modal-back-store-select-btn"
            onClick={async () => {
              await selectStore(null);
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            <span>{t('authBackToSelectStore')}</span>
          </button>

          <button
            type="button"
            data-testid="modal-logout-btn"
            onClick={async () => {
              await logout();
              onClose();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('authLogoutBtn')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
