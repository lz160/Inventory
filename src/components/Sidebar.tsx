import React, { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Scan,
  FileCheck2,
  Package,
  ClipboardCheck,
  TrendingUp,
  Settings,
  ChevronUp,
  ChevronDown,
  KeyRound,
  LogOut,
  Store,
} from 'lucide-react';
import { useIms } from '../context/ImsContext';

export type AppActiveView = 'orders' | 'items' | 'scan' | 'report';
export type AppWorkspaceTab = 'receiving' | 'inventory' | 'stocktake' | 'sales' | 'settings';

type NavGroupKey = 'receiving' | 'ims' | 'settings' | null;

interface BottomNavProps {
  currentBatchTitle?: string;
  activeOrdersCount: number;
  totalOrdersCount?: number;
  workspace: AppWorkspaceTab;
  setWorkspace: (workspace: AppWorkspaceTab) => void;
  activeView: AppActiveView;
  setActiveView: (view: AppActiveView) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  onOpenStoreSwitch?: () => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeOrdersCount,
  workspace,
  setWorkspace,
  activeView,
  setActiveView,
  onOpenStoreSwitch,
}) => {
  const { t, hasPerm, user, currentStore, selectStore, logout } = useIms();
  const [openGroup, setOpenGroup] = useState<NavGroupKey>(null);
  const navRef = useRef<HTMLElement>(null);

  const canReceiving = hasPerm('receiving');
  const canInventory = hasPerm('inventory');
  const canStocktake = hasPerm('stocktake');
  const canImsGroup = canInventory || canStocktake;
  const canSales = hasPerm('sales');
  const canSettings = Boolean(user);

  const isReceivingGroupActive =
    workspace === 'receiving' && (activeView === 'orders' || activeView === 'items' || activeView === 'report');
  const isScanActive = workspace === 'receiving' && activeView === 'scan';
  const isImsGroupActive = workspace === 'inventory' || workspace === 'stocktake';
  const isSalesActive = workspace === 'sales';
  const isSettingsActive = workspace === 'settings';

  useEffect(() => {
    if (openGroup === 'receiving' && !canReceiving) setOpenGroup(null);
    if (openGroup === 'ims' && !(canInventory && canStocktake)) setOpenGroup(null);
  }, [openGroup, canReceiving, canInventory, canStocktake]);

  useEffect(() => {
    if (!openGroup) return;

    const handleOutsideClick = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenGroup(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openGroup]);

  const handleSelectReceiving = (view: AppActiveView) => {
    setWorkspace('receiving');
    setActiveView(view);
    setOpenGroup(null);
  };

  const handleSelectWorkspace = (target: AppWorkspaceTab) => {
    setWorkspace(target);
    setOpenGroup(null);
  };

  const toggleGroup = (group: Exclude<NavGroupKey, null>) => {
    setOpenGroup((prev) => (prev === group ? null : group));
  };

  const receivingSubLabel =
    isReceivingGroupActive && activeView === 'report'
      ? t('navReport')
      : isReceivingGroupActive && (activeView === 'orders' || activeView === 'items')
      ? t('navOrders')
      : t('navReceivingGroup');

  const imsSubLabel =
    canInventory && !canStocktake
      ? t('workspaceInventory')
      : !canInventory && canStocktake
      ? t('workspaceStocktake')
      : workspace === 'stocktake'
      ? t('workspaceStocktake')
      : workspace === 'inventory'
      ? t('navInventory')
      : t('navInventoryGroup');

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 right-0 z-50 transform-gpu bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg px-1 sm:px-4 pt-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] select-none"
      aria-label="底部导航与进销存菜单"
    >
      {/* Upward Drawer for Combined Groups — single-column stacked layout */}
      <div
        id="bottom-nav-group-drawer"
        aria-hidden={!openGroup}
        className={`max-w-md sm:max-w-lg lg:max-w-xl mx-auto overflow-hidden transition-all duration-200 ease-out ${
          openGroup
            ? 'max-h-60 opacity-100 pb-2 mb-1.5 border-b border-slate-100'
            : 'max-h-0 opacity-0 pointer-events-none'
        }`}
      >
        {openGroup === 'receiving' && canReceiving && (
          <div className="grid grid-cols-1 gap-2 pt-1 px-1">
            <button
              type="button"
              data-testid="nav-sub-orders"
              onClick={() => handleSelectReceiving('orders')}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
                workspace === 'receiving' && (activeView === 'orders' || activeView === 'items')
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Boxes className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('navOrders')}</span>
              {activeOrdersCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 bg-rose-500 text-white text-[10px] font-bold rounded-full leading-tight">
                  {activeOrdersCount}
                </span>
              )}
            </button>
            <button
              type="button"
              data-testid="nav-sub-report"
              onClick={() => handleSelectReceiving('report')}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
                workspace === 'receiving' && activeView === 'report'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <FileCheck2 className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('navReport')}</span>
            </button>
          </div>
        )}

        {openGroup === 'ims' && canInventory && canStocktake && (
          <div className="grid grid-cols-1 gap-2 pt-1 px-1">
            <button
              type="button"
              data-testid="nav-sub-inventory"
              onClick={() => handleSelectWorkspace('inventory')}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
                workspace === 'inventory'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Package className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('workspaceInventory')}</span>
            </button>
            <button
              type="button"
              data-testid="nav-sub-stocktake"
              onClick={() => handleSelectWorkspace('stocktake')}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 ${
                workspace === 'stocktake'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <ClipboardCheck className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('workspaceStocktake')}</span>
            </button>
          </div>
        )}

        {openGroup === 'settings' && canSettings && (
          <div className="grid grid-cols-1 gap-2 pt-1 px-1">
            <button
              type="button"
              data-testid="nav-sub-settings"
              onClick={() => handleSelectWorkspace('settings')}
              className={`w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-all active:scale-95 whitespace-nowrap ${
                workspace === 'settings'
                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200 shadow-2xs'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('workspaceSettings')}</span>
            </button>
            <button
              type="button"
              data-testid="nav-sub-switch-store"
              onClick={() => {
                setOpenGroup(null);
                if (onOpenStoreSwitch) {
                  onOpenStoreSwitch();
                } else {
                  selectStore(null);
                }
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:text-slate-900 text-xs font-semibold text-slate-700 transition-all active:scale-95 whitespace-nowrap"
            >
              <Store className="w-4 h-4 shrink-0 text-indigo-600" />
              <span className="truncate">
                {t('authSwitchStoreBtn')}
                {currentStore ? ` · ${currentStore.storeName}` : ''}
              </span>
            </button>
            <button
              type="button"
              data-testid="nav-sub-logout"
              onClick={() => {
                setOpenGroup(null);
                logout();
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-rose-600 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-xs font-semibold text-white transition-all active:scale-95 whitespace-nowrap shadow-2xs"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="truncate">{t('authLogoutBtn')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Main permission-filtered bottom bar */}
      <div className="max-w-md sm:max-w-lg lg:max-w-xl mx-auto flex items-center justify-around">
        {/* 1. 货单工作区 + 差异审计 */}
        {canReceiving && (
          <button
            type="button"
            data-testid="nav-group-receiving"
            aria-expanded={openGroup === 'receiving'}
            aria-controls="bottom-nav-group-drawer"
            onClick={() => toggleGroup('receiving')}
            className={`relative flex flex-col items-center justify-center flex-1 min-w-0 py-1 px-1 rounded-xl transition-all duration-150 active:scale-95 ${
              isReceivingGroupActive || openGroup === 'receiving'
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
            title={`${t('navOrders')} / ${t('navReport')}`}
          >
            <div className="relative flex items-center gap-0.5">
              <Boxes
                className={`w-5 h-5 ${
                  isReceivingGroupActive || openGroup === 'receiving'
                    ? 'text-indigo-600 stroke-[2.3]'
                    : 'text-slate-400'
                }`}
              />
              {openGroup === 'receiving' ? (
                <ChevronDown className="w-3 h-3 text-indigo-600" />
              ) : (
                <ChevronUp
                  className={`w-3 h-3 ${isReceivingGroupActive ? 'text-indigo-600' : 'text-slate-400'}`}
                />
              )}
              {activeOrdersCount > 0 && (
                <span className="absolute -top-1.5 -right-2 px-1.5 py-0.2 bg-rose-500 text-white text-[10px] font-bold rounded-full min-w-[16px] text-center leading-tight shadow-2xs">
                  {activeOrdersCount}
                </span>
              )}
            </div>
            <span className="text-[11px] mt-1 tracking-tight truncate max-w-full whitespace-nowrap">
              {receivingSubLabel}
            </span>
            {isReceivingGroupActive && (
              <span className="absolute bottom-0 w-7 h-0.5 bg-indigo-600 rounded-full" />
            )}
          </button>
        )}

        {/* 2. 库存 + 盘点 */}
        {canImsGroup && (
          <button
            type="button"
            data-testid="nav-group-ims"
            aria-expanded={canInventory && canStocktake ? openGroup === 'ims' : undefined}
            aria-controls={canInventory && canStocktake ? 'bottom-nav-group-drawer' : undefined}
            onClick={() => {
              if (canInventory && !canStocktake) {
                handleSelectWorkspace('inventory');
              } else if (!canInventory && canStocktake) {
                handleSelectWorkspace('stocktake');
              } else {
                toggleGroup('ims');
              }
            }}
            className={`relative flex flex-col items-center justify-center flex-1 min-w-0 py-1 px-1 rounded-xl transition-all duration-150 active:scale-95 ${
              isImsGroupActive || openGroup === 'ims'
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
            title={imsSubLabel}
          >
            <div className="relative flex items-center gap-0.5">
              {(!canInventory && canStocktake) || workspace === 'stocktake' ? (
                <ClipboardCheck
                  className={`w-5 h-5 ${
                    isImsGroupActive || openGroup === 'ims'
                      ? 'text-indigo-600 stroke-[2.3]'
                      : 'text-slate-400'
                  }`}
                />
              ) : (
                <Package
                  className={`w-5 h-5 ${
                    isImsGroupActive || openGroup === 'ims'
                      ? 'text-indigo-600 stroke-[2.3]'
                      : 'text-slate-400'
                  }`}
                />
              )}
              {canInventory && canStocktake && (
                openGroup === 'ims' ? (
                  <ChevronDown className="w-3 h-3 text-indigo-600" />
                ) : (
                  <ChevronUp
                    className={`w-3 h-3 ${isImsGroupActive ? 'text-indigo-600' : 'text-slate-400'}`}
                  />
                )
              )}
            </div>
            <span className="text-[11px] mt-1 tracking-tight truncate max-w-full whitespace-nowrap">
              {imsSubLabel}
            </span>
            {isImsGroupActive && (
              <span className="absolute bottom-0 w-7 h-0.5 bg-indigo-600 rounded-full" />
            )}
          </button>
        )}

        {/* 3. 极速扫码 (居中凸出主扫码按钮) */}
        {canReceiving && (
          <button
            type="button"
            data-testid="nav-scan"
            onClick={() => handleSelectReceiving('scan')}
            className="relative flex flex-col items-center justify-center flex-1 min-w-0 py-0.5 px-1 group active:scale-95 transition-transform"
            title="极速扫码 (底端常驻输入框，扫码立即弹出商品信息)"
          >
            <div
              className={`w-11 h-11 -mt-4 rounded-full flex items-center justify-center shadow-md transition-all duration-150 border-2 ${
                isScanActive
                  ? 'bg-indigo-600 text-white border-white ring-2 ring-indigo-500/30 scale-105'
                  : 'bg-white text-indigo-600 border-indigo-100 hover:bg-indigo-50 shadow-sm'
              }`}
            >
              <Scan className="w-5 h-5" />
            </div>
            <span
              className={`text-[11px] mt-0.5 font-semibold tracking-tight truncate max-w-full whitespace-nowrap ${
                isScanActive ? 'text-indigo-600 font-bold' : 'text-slate-600'
              }`}
            >
              {t('navScan')}
            </span>
          </button>
        )}

        {/* 4. 销售分析 */}
        {canSales && (
          <button
            type="button"
            data-testid="nav-sales"
            onClick={() => handleSelectWorkspace('sales')}
            className={`relative flex flex-col items-center justify-center flex-1 min-w-0 py-1 px-1 rounded-xl transition-all duration-150 active:scale-95 ${
              isSalesActive
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
            title={t('workspaceSales')}
          >
            <div className="relative">
              <TrendingUp
                className={`w-5 h-5 ${isSalesActive ? 'text-indigo-600 stroke-[2.3]' : 'text-slate-400'}`}
              />
            </div>
            <span className="text-[11px] mt-1 tracking-tight truncate max-w-full whitespace-nowrap">
              {t('workspaceSales')}
            </span>
            {isSalesActive && (
              <span className="absolute bottom-0 w-7 h-0.5 bg-indigo-600 rounded-full" />
            )}
          </button>
        )}

        {/* 5. 设置 (带折叠菜单：账户设置 / 退出登录) */}
        {canSettings && (
          <button
            type="button"
            data-testid="nav-settings"
            aria-expanded={openGroup === 'settings'}
            aria-controls="bottom-nav-group-drawer"
            onClick={() => toggleGroup('settings')}
            className={`relative flex flex-col items-center justify-center flex-1 min-w-0 py-1 px-1 rounded-xl transition-all duration-150 active:scale-95 ${
              isSettingsActive || openGroup === 'settings'
                ? 'text-indigo-600 font-bold'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
            title={t('workspaceSettings')}
          >
            <div className="relative flex items-center gap-0.5">
              <Settings
                className={`w-5 h-5 ${
                  isSettingsActive || openGroup === 'settings'
                    ? 'text-indigo-600 stroke-[2.3]'
                    : 'text-slate-400'
                }`}
              />
              {openGroup === 'settings' ? (
                <ChevronDown className="w-3 h-3 text-indigo-600" />
              ) : (
                <ChevronUp
                  className={`w-3 h-3 ${isSettingsActive ? 'text-indigo-600' : 'text-slate-400'}`}
                />
              )}
            </div>
            <span className="text-[11px] mt-1 tracking-tight truncate max-w-full whitespace-nowrap">
              {t('navSettings')}
            </span>
            {isSettingsActive && (
              <span className="absolute bottom-0 w-7 h-0.5 bg-indigo-600 rounded-full" />
            )}
          </button>
        )}
      </div>
    </nav>
  );
};

// Export alias for compatibility
export const Sidebar = BottomNav;
