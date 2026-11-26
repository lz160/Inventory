import React, { useState, useEffect, useMemo } from 'react';
import {
  PurchaseItem,
  PurchaseOrder,
  OrderMetrics,
  calculateOrderMetrics,
  calculateItemStatus,
  checkPriceDiscrepancy,
  exportToPosImportXlsx,
  exportToAuditResultXlsx,
  isOrderCompleted,
} from './utils/reconciliation';
import { Sidebar, AppActiveView, AppWorkspaceTab } from './components/Sidebar';
import { OrdersTableView } from './components/OrdersTableView';
import { ExportDropdown } from './components/ExportDropdown';
import { QuickScanView } from './components/QuickScanView';
import { MetricsOverview } from './components/MetricsOverview';
import { ScannerBar } from './components/ScannerBar';
import { PdaListView } from './components/PdaListView';
import { ImportModal } from './components/ImportModal';
import { ItemDetailDrawer } from './components/ItemDetailDrawer';
import { AuditReportView } from './components/AuditReportView';
import { ArrowLeft, Languages, Store, Loader2, ShieldAlert, User as UserIcon } from 'lucide-react';
import { ImsProvider, StoreSummary, useIms } from './context/ImsContext';
import { InventoryModule } from './components/ims/InventoryModule';
import { StocktakeModule } from './components/ims/StocktakeModule';
import { SalesAnalyticsModule } from './components/ims/SalesAnalyticsModule';
import { DbSettingsModule } from './components/ims/DbSettingsModule';
import { AdminWorkspace } from './components/ims/AdminWorkspace';
import { StoreLoginScreen } from './components/ims/StoreLoginScreen';
import { StoreSelectScreen } from './components/ims/StoreSelectScreen';
import { StoreSwitchModal } from './components/ims/StoreSwitchModal';
import { getFirstPermittedWorkspace, isWorkspacePermitted } from './core/auth/permissions';

import { useReceivingOrders } from './modules/receiving/useReceivingOrders';
import type { ReceivingChanges, ReceivingLine, ReceivingMode } from './modules/receiving/types';

type WorkspaceTab = AppWorkspaceTab;

function AuthenticatedWorkspace({ currentStore }: { currentStore: StoreSummary }) {
  const { lang, toggleLang, t, user, hasPerm, registerSettingsNavigator, showToast } = useIms();
  const firstPermittedWorkspace = getFirstPermittedWorkspace(user);
  const [workspace, setWorkspace] = useState<WorkspaceTab>(() => firstPermittedWorkspace || 'receiving');
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState(false);
  const { orders, loadState, refresh, saveImport, removeOrder, editLine, adjustLine } =
    useReceivingOrders(currentStore.id, workspace === 'receiving' && hasPerm('receiving'));

  // Keep workspace within permitted bounds when permissions update
  useEffect(() => {
    if (!isWorkspacePermitted(user, workspace)) {
      const next = getFirstPermittedWorkspace(user);
      if (next && next !== workspace) {
        setWorkspace(next);
      }
    }
  }, [user, workspace]);

  useEffect(() => {
    registerSettingsNavigator(() => {
      if (user) {
        setWorkspace('settings');
      }
    });
  }, [registerSettingsNavigator, user]);

  const [activeView, setActiveView] = useState<AppActiveView>('orders');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [priceBasis, setPriceBasis] = useState<'discountPrice' | 'unitPrice' | 'unitPrice2'>('discountPrice');
  const [activeFilter, setActiveFilter] = useState<'all' | 'discrepancy' | 'pending' | 'partial' | 'matched'>('all');

  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);
  const [lastScannedItem, setLastScannedItem] = useState<{
    item: PurchaseItem;
    message: string;
    timestamp: number;
  } | null>(null);

  const [selectedItemForDetail, setSelectedItemForDetail] = useState<ReceivingLine | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const allOrdersItems: ReceivingLine[] = useMemo(() => {
    return orders.flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        orderId: order.id,
        orderTitle: order.title,
      }))
    );
  }, [orders]);

  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return orders[0] || null;
    return orders.find((o) => o.id === selectedOrderId) || orders[0] || null;
  }, [orders, selectedOrderId]);

  const currentOrderItems: ReceivingLine[] = useMemo(() => {
    if (!selectedOrder) return [];
    return selectedOrder.items.map((item) => ({
      ...item,
      orderId: selectedOrder.id,
      orderTitle: selectedOrder.title,
    }));
  }, [selectedOrder]);

  const currentMetrics: OrderMetrics = useMemo(() => {
    const targetItems = activeView === 'items' ? currentOrderItems : allOrdersItems;
    return calculateOrderMetrics(targetItems, priceBasis);
  }, [activeView, currentOrderItems, allOrdersItems, priceBasis]);

  const filteredCurrentOrderItems = useMemo(() => {
    return currentOrderItems.filter((item) => {
      const status = calculateItemStatus(item.expectedQty, item.receivedQty);
      const priceCheck = checkPriceDiscrepancy(item, priceBasis);
      const hasPriceDiscrepancy = priceCheck.status === 'discrepancy';
      const hasDamaged = (item.damagedQty || 0) > 0;

      if (activeFilter === 'all') return true;
      if (activeFilter === 'discrepancy') {
        return status !== 'matched' || hasPriceDiscrepancy || hasDamaged;
      }
      if (activeFilter === 'pending') return status === 'pending';
      if (activeFilter === 'partial') return status === 'partial';
      if (activeFilter === 'matched') return status === 'matched';
      return true;
    });
  }, [currentOrderItems, activeFilter, priceBasis]);

  const currentBatchTitle = useMemo(() => {
    if (activeView === 'items' && selectedOrder) {
      return selectedOrder.title;
    }
    return `全部进货单 (${orders.length}张货单 · 共${allOrdersItems.length}款)`;
  }, [activeView, selectedOrder, orders.length, allOrdersItems.length]);

  const handleSelectOrder = (order: PurchaseOrder) => {
    setSelectedOrderId(order.id);
    setActiveView('items');
  };

  const handleUpdateItem = async (item: ReceivingLine, updates: ReceivingChanges) => {
    try {
      await editLine(item.id, updates, item.version);
      return true;
    } catch (err) {
      showToast(err instanceof Error ? err.message : '验货明细保存失败', 'error');
      return false;
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    const order = orders.find((entry) => entry.id === orderId);
    if (!order || !confirm('确定要移除此进货对货单及其包含的全部商品吗？')) return;
    try {
      await removeOrder(order);
      if (selectedOrderId === orderId) {
        setSelectedOrderId(null);
        setActiveView('orders');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '进货单删除失败', 'error');
    }
  };

  const handleAdjustQuantity = async (itemId: string, delta: number) => {
    try {
      await adjustLine(itemId, delta, false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '实收数量保存失败', 'error');
    }
  };

  const handleScanMatch = async (matchedItem: PurchaseItem, stepQty: number) => {
    let updatedItem: ReceivingLine;
    try {
      updatedItem = await adjustLine(matchedItem.id, stepQty, true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '扫码保存失败', 'error');
      return;
    }
    setSelectedItemForDetail({ ...updatedItem, orderTitle: matchedItem.orderTitle });
    const newQty = updatedItem.receivedQty;
    const isDone = newQty === matchedItem.expectedQty;
    const isEx = newQty > matchedItem.expectedQty;
    const message = isDone
      ? `已齐套到货 (+${stepQty})`
      : isEx
      ? `已超收多送 (+${stepQty}, 现${newQty}/${matchedItem.expectedQty})`
      : `已核验录入 (+${stepQty}, 尚欠${matchedItem.expectedQty - newQty}件)`;

    setLastScannedItem({
      item: updatedItem,
      message,
      timestamp: Date.now(),
    });

    setHighlightedItemId(matchedItem.id);
    setTimeout(() => {
      const el = document.getElementById(`pda-item-${matchedItem.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);

    setTimeout(() => {
      setHighlightedItemId((cur) => (cur === matchedItem.id ? null : cur));
    }, 2500);
  };

  const handleExportSingleOrderPos = (order: PurchaseOrder) => {
    const blob = exportToPosImportXlsx(order.items, order.title);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.title}_POS导入模板_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSingleOrderAudit = (order: PurchaseOrder) => {
    const blob = exportToAuditResultXlsx(order.items, order.title);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.title}_差异核对表_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAllOrdersPos = () => {
    const blob = exportToPosImportXlsx(allOrdersItems, currentBatchTitle);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `全部进货单_POS导入汇总_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAllOrdersAudit = () => {
    const blob = exportToAuditResultXlsx(allOrdersItems, currentBatchTitle);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `全部进货单_差异核验汇总_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportItems = async (items: PurchaseItem[], title: string, mode: ReceivingMode) => {
    const target = mode === 'new_order' ? undefined : selectedOrder ?? undefined;
    if (target && mode === 'replace' && !confirm(`确定替换「${target.title}」的全部明细和验货记录吗？`)) {
      return false;
    }
    const order = await saveImport(items, title, target ? mode : 'new_order', target);
    setSelectedOrderId(order.id);
    setActiveView('orders');
    return true;
  };

  const openItemDetail = (item: PurchaseItem) => {
    setSelectedItemForDetail(allOrdersItems.find((entry) => entry.id === item.id) ?? null);
  };

  const handleNavigateToItem = (itemId: string) => {
    const parentOrder = orders.find((o) => o.items.some((it) => it.id === itemId));
    if (parentOrder) {
      setSelectedOrderId(parentOrder.id);
    }
    setActiveView('items');
    setHighlightedItemId(itemId);
    setTimeout(() => {
      const el = document.getElementById(`pda-item-${itemId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };

  return (
    <div className="h-[100dvh] w-full bg-slate-50 flex flex-col text-slate-900 overflow-hidden">
      {/* Top Unified Header (Fixed height, never scrolls off screen) */}
      <header className="shrink-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-2xs">
        <div className="max-w-[1280px] mx-auto px-3 sm:px-4 lg:px-6 py-2 flex items-center justify-between gap-2">
          {/* Left: Brand Title + Current Workspace Label */}
          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
            <h1 className="text-sm font-bold text-slate-900 whitespace-nowrap truncate">
              {t('appTitle')}
            </h1>
            <span className="text-slate-300 text-xs select-none hidden sm:inline">/</span>
            <span className="text-xs font-semibold text-indigo-700 whitespace-nowrap hidden sm:inline">
              {workspace === 'receiving'
                ? t('workspaceReceiving')
                : workspace === 'inventory'
                ? t('workspaceInventory')
                : workspace === 'stocktake'
                ? t('workspaceStocktake')
                : workspace === 'settings'
                ? t('workspaceSettings')
                : t('workspaceSales')}
            </span>
          </div>

          {/* Right: User + Active Store Switcher + Bilingual Switcher */}
          <div className="flex items-center gap-2 shrink-0">
            {user && (
              <span
                data-testid="header-user-badge"
                className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-slate-600 max-w-[120px] truncate whitespace-nowrap"
                title={`${user.displayName} (${user.username})`}
              >
                <UserIcon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate">{user.displayName}</span>
              </span>
            )}

            {currentStore && (
              <span
                data-testid="header-store-badge"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 whitespace-nowrap"
                title={`${currentStore.storeName} (${currentStore.storeCode})`}
              >
                <Store className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span className="max-w-[110px] sm:max-w-[160px] truncate">
                  {currentStore.storeName}
                </span>
                <span className="font-mono-numbers text-[10px] text-slate-500 hidden md:inline">
                  ({currentStore.storeCode})
                </span>
              </span>
            )}

            <button
              type="button"
              onClick={toggleLang}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              title="Switch zh / sk"
            >
              <Languages className="w-3.5 h-3.5 text-indigo-600" />
              <span>{lang === 'zh' ? '中文' : 'SK'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Independent Scrollable Content Viewport — keeps <nav> perpetually pinned at bottom */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain pb-24">
        <main className="max-w-[1280px] w-full mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4 space-y-4 flex flex-col">
          {!firstPermittedWorkspace && (
            <div className="bg-white rounded-xl border border-amber-200 p-8 text-center space-y-2">
              <ShieldAlert className="w-7 h-7 text-amber-600 mx-auto" />
              <p className="text-sm font-bold text-slate-900">{t('userNoPermAssigned')}</p>
            </div>
          )}

          {workspace === 'inventory' && hasPerm('inventory') && <InventoryModule />}
          {workspace === 'stocktake' && hasPerm('stocktake') && <StocktakeModule />}
          {workspace === 'sales' && hasPerm('sales') && <SalesAnalyticsModule />}
          {workspace === 'settings' && <DbSettingsModule />}

          {workspace === 'receiving' && hasPerm('receiving') && loadState === 'loading' && (
            <p role="status" className="text-sm text-slate-500">正在读取门店进货单…</p>
          )}
          {workspace === 'receiving' && hasPerm('receiving') && loadState === 'error' && (
            <div role="alert" className="flex items-center gap-3 text-sm text-rose-700">
              <span>无法读取门店进货单</span>
              <button type="button" className="font-semibold underline" onClick={refresh}>重试</button>
            </div>
          )}
          {workspace === 'receiving' && hasPerm('receiving') && loadState === 'ready' && (
            <>
              {activeView === 'orders' && (
                <OrdersTableView
                  orders={orders}
                  onSelectOrder={handleSelectOrder}
                  onExportOrderPos={handleExportSingleOrderPos}
                  onExportOrderAudit={handleExportSingleOrderAudit}
                  onAddNewOrder={() => setIsImportModalOpen(true)}
                  onDeleteOrder={handleDeleteOrder}
                />
              )}

              {activeView === 'items' && selectedOrder && (
                <div className="space-y-3 sm:space-y-4">
                  <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveView('orders')}
                        className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1 text-xs font-semibold"
                        title="返回货单列表"
                      >
                        <ArrowLeft className="w-4 h-4" />
                        <span>返回货单列表</span>
                      </button>
                      <span className="text-slate-300">|</span>
                      <div>
                        <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                          <span>{selectedOrder.title}</span>
                          {isOrderCompleted(selectedOrder) ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              已全数齐套
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              核验中
                            </span>
                          )}
                        </h2>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          供应商: {selectedOrder.supplier || '-'} · 共 {selectedOrder.items.length} 款货物
                          {selectedOrder.completedAt && ` · 完成时间: ${selectedOrder.completedAt}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <ExportDropdown
                        onExportPos={() => handleExportSingleOrderPos(selectedOrder)}
                        onExportAudit={() => handleExportSingleOrderAudit(selectedOrder)}
                        label="导出此单 (.xlsx)"
                        align="right"
                      />
                    </div>
                  </div>

                  <MetricsOverview
                    metrics={currentMetrics}
                    priceBasis={priceBasis}
                    onChangePriceBasis={setPriceBasis}
                    activeFilter={activeFilter}
                    onChangeFilter={setActiveFilter}
                  />

                  <ScannerBar
                    items={currentOrderItems}
                    onScanMatch={handleScanMatch}
                    onOpenItemModal={openItemDetail}
                    lastScannedItem={lastScannedItem}
                  />

                  <PdaListView
                    items={filteredCurrentOrderItems}
                    priceBasis={priceBasis}
                    onUpdateItem={handleUpdateItem}
                    onAdjustQuantity={handleAdjustQuantity}
                    onSelectItemForDetail={setSelectedItemForDetail}
                    highlightedItemId={highlightedItemId}
                  />
                </div>
              )}

              {activeView === 'scan' && (
                <QuickScanView
                  items={allOrdersItems}
                  onScanMatch={handleScanMatch}
                  onOpenItemModal={openItemDetail}
                  lastScannedItem={lastScannedItem}
                  onBackToOrders={() => setActiveView('orders')}
                />
              )}

              {activeView === 'report' && (
                <AuditReportView
                  items={allOrdersItems}
                  metrics={currentMetrics}
                  priceBasis={priceBasis}
                  onNavigateToItem={handleNavigateToItem}
                  onExportPos={handleExportAllOrdersPos}
                  onExportAudit={handleExportAllOrdersAudit}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Bottom Navigation Menu — Perpetually Pinned */}
      <Sidebar
        activeOrdersCount={orders.filter((o) => !isOrderCompleted(o)).length}
        workspace={workspace}
        setWorkspace={setWorkspace}
        activeView={activeView}
        setActiveView={setActiveView}
        onOpenStoreSwitch={() => setIsSwitchModalOpen(true)}
      />

      {/* Modals & Drawers */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportItems={handleImportItems}
      />

      {selectedItemForDetail && <ItemDetailDrawer
        key={selectedItemForDetail.id}
        item={selectedItemForDetail}
        onClose={() => setSelectedItemForDetail(null)}
        onSave={handleUpdateItem}
        priceBasis={priceBasis}
      />}

      {currentStore && (
        <StoreSwitchModal
          isOpen={isSwitchModalOpen}
          onClose={() => setIsSwitchModalOpen(false)}
        />
      )}
    </div>
  );
}

function AppGate() {
  const { authReady, user, currentStore, t } = useIms();

  if (!authReady) {
    return (
      <div className="min-h-[100dvh] bg-slate-50 flex items-center justify-center text-xs text-slate-500 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
        <span>{t('loading')}</span>
      </div>
    );
  }

  if (!user) {
    return <StoreLoginScreen />;
  }

  if (user.role === 'admin') {
    return <AdminWorkspace />;
  }

  if (!currentStore) {
    return <StoreSelectScreen />;
  }

  return <AuthenticatedWorkspace key={currentStore.id} currentStore={currentStore} />;
}

export default function App() {
  return (
    <ImsProvider>
      <AppGate />
    </ImsProvider>
  );
}
