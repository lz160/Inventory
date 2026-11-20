import React, { useState, useEffect, useMemo } from 'react';
import {
  PurchaseItem,
  PurchaseOrder,
  OrderMetrics,
  calculateOrderMetrics,
  calculateItemStatus,
  checkPriceDiscrepancy,
  exportToCsv,
  exportToXlsx,
  exportToPosImportXlsx,
  exportToAuditResultXlsx,
  getSamplePurchaseOrders,
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
import { ArrowLeft, Languages } from 'lucide-react';
import { ImsProvider, useIms } from './context/ImsContext';
import { InventoryModule } from './components/ims/InventoryModule';
import { StocktakeModule } from './components/ims/StocktakeModule';
import { SalesAnalyticsModule } from './components/ims/SalesAnalyticsModule';
import { DbSettingsModule } from './components/ims/DbSettingsModule';

const STORAGE_ORDERS_KEY = 'purchase_reconciliation_v2_orders';
type WorkspaceTab = AppWorkspaceTab;

function AppContent() {
  const { lang, toggleLang, t, registerSettingsNavigator } = useIms();
  const [workspace, setWorkspace] = useState<WorkspaceTab>('receiving');

  useEffect(() => {
    registerSettingsNavigator(() => setWorkspace('settings'));
  }, [registerSettingsNavigator]);

  // Multiple purchase orders state
  const [orders, setOrders] = useState<PurchaseOrder[]>(() => {
    try {
      const savedOrders = localStorage.getItem(STORAGE_ORDERS_KEY);
      if (savedOrders) {
        const parsed = JSON.parse(savedOrders);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // fallback to sample
    }
    return getSamplePurchaseOrders();
  });

  // Navigation View: 'orders' (货单表格列表) | 'items' (货物明细) | 'scan' (只有Input框界面) | 'report' (差异审计)
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

  const [selectedItemForDetail, setSelectedItemForDetail] = useState<PurchaseItem | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Sync state with localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(orders));
    } catch {}
  }, [orders]);

  // Combined items from all orders (for global search / scan)
  const allOrdersItems: PurchaseItem[] = useMemo(() => {
    return orders.flatMap((order) =>
      order.items.map((item) => ({
        ...item,
        orderId: order.id,
        orderTitle: order.title,
      }))
    );
  }, [orders]);

  // Currently selected order for items drill-down
  const selectedOrder = useMemo(() => {
    if (!selectedOrderId) return orders[0] || null;
    return orders.find((o) => o.id === selectedOrderId) || orders[0] || null;
  }, [orders, selectedOrderId]);

  // Items of the selected order
  const currentOrderItems: PurchaseItem[] = useMemo(() => {
    if (!selectedOrder) return [];
    return selectedOrder.items.map((item) => ({
      ...item,
      orderId: selectedOrder.id,
      orderTitle: selectedOrder.title,
    }));
  }, [selectedOrder]);

  // Metrics of current view
  const currentMetrics: OrderMetrics = useMemo(() => {
    const targetItems = activeView === 'items' ? currentOrderItems : allOrdersItems;
    return calculateOrderMetrics(targetItems, priceBasis);
  }, [activeView, currentOrderItems, allOrdersItems, priceBasis]);

  // Filtered items of current order
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

  // Title for display in Sidebar
  const currentBatchTitle = useMemo(() => {
    if (activeView === 'items' && selectedOrder) {
      return selectedOrder.title;
    }
    return `全部进货单 (${orders.length}张货单 · 共${allOrdersItems.length}款)`;
  }, [activeView, selectedOrder, orders.length, allOrdersItems.length]);

  // Drill down from orders table to an order's items
  const handleSelectOrder = (order: PurchaseOrder) => {
    setSelectedOrderId(order.id);
    setActiveView('items');
  };

  // Update a single item within its parent order
  const handleUpdateItem = (id: string, updates: Partial<PurchaseItem>) => {
    setOrders((prevOrders) =>
      prevOrders.map((order) => {
        const itemExists = order.items.some((it) => it.id === id);
        if (!itemExists) return order;

        const updatedItems = order.items.map((item) => {
          if (item.id !== id) return item;
          return { ...item, ...updates };
        });

        // Check if this order has just completed
        const wasDone = isOrderCompleted(order);
        const nextOrder: PurchaseOrder = {
          ...order,
          items: updatedItems,
        };
        const isNowDone = isOrderCompleted(nextOrder);

        if (!wasDone && isNowDone) {
          nextOrder.completedAt = new Date().toLocaleString();
        } else if (wasDone && !isNowDone) {
          nextOrder.completedAt = undefined;
        }

        return nextOrder;
      })
    );

    setSelectedItemForDetail((current) => {
      if (current && current.id === id) {
        return { ...current, ...updates };
      }
      return current;
    });
  };

  // Delete an order
  const handleDeleteOrder = (orderId: string) => {
    if (confirm('确定要移除此进货对货单及其包含的全部商品吗？')) {
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      if (selectedOrderId === orderId) {
        setSelectedOrderId(null);
        setActiveView('orders');
      }
    }
  };

  // Barcode / Query Scan Match
  const handleScanMatch = (matchedItem: PurchaseItem, stepQty: number) => {
    const newQty = matchedItem.receivedQty + stepQty;
    const now = new Date().toLocaleTimeString();

    // Update item in order
    handleUpdateItem(matchedItem.id, {
      receivedQty: newQty,
      lastScannedAt: now,
    });

    const isDone = newQty === matchedItem.expectedQty;
    const isEx = newQty > matchedItem.expectedQty;
    const message = isDone
      ? `已齐套到货 (+${stepQty})`
      : isEx
      ? `已超收多送 (+${stepQty}, 现${newQty}/${matchedItem.expectedQty})`
      : `已核验录入 (+${stepQty}, 尚欠${matchedItem.expectedQty - newQty}件)`;

    const updatedItem = { ...matchedItem, receivedQty: newQty };
    setLastScannedItem({
      item: updatedItem,
      message,
      timestamp: Date.now(),
    });

    // Highlight row
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

  // 1. Export POS Import file (.xlsx) for a specific single order
  const handleExportSingleOrderPos = (order: PurchaseOrder) => {
    const blob = exportToPosImportXlsx(order.items, order.title);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.title}_POS导入模板_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 2. Export Audit Result file (.xlsx) for a specific single order
  const handleExportSingleOrderAudit = (order: PurchaseOrder) => {
    const blob = exportToAuditResultXlsx(order.items, order.title);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.title}_差异核对表_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 3. Export POS Import file (.xlsx) for all orders
  const handleExportAllOrdersPos = () => {
    const blob = exportToPosImportXlsx(allOrdersItems, currentBatchTitle);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `全部进货单_POS导入汇总_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 4. Export Audit Result file (.xlsx) for all orders
  const handleExportAllOrdersAudit = () => {
    const blob = exportToAuditResultXlsx(allOrdersItems, currentBatchTitle);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `全部进货单_差异核验汇总_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import items handler
  const handleImportItems = (
    newItems: PurchaseItem[],
    newBatchTitle: string,
    mode: 'new_order' | 'replace' | 'append'
  ) => {
    const newOrderId = `order-${Date.now()}`;
    const mappedItems: PurchaseItem[] = newItems.map((it) => ({
      ...it,
      orderId: newOrderId,
      orderTitle: newBatchTitle,
    }));

    if (mode === 'new_order') {
      const newOrder: PurchaseOrder = {
        id: newOrderId,
        title: newBatchTitle || `进货对货单 ${orders.length + 1}`,
        createdAt: new Date().toISOString().split('T')[0],
        isActive: true,
        items: mappedItems,
      };
      setOrders((prev) => [...prev, newOrder]);
      setSelectedOrderId(newOrderId);
      setActiveView('orders');
    } else if (mode === 'replace') {
      const newOrder: PurchaseOrder = {
        id: newOrderId,
        title: newBatchTitle,
        createdAt: new Date().toISOString().split('T')[0],
        isActive: true,
        items: mappedItems,
      };
      setOrders([newOrder]);
      setSelectedOrderId(newOrderId);
      setActiveView('orders');
    } else {
      setOrders((prev) => {
        if (prev.length === 0) {
          return [
            {
              id: newOrderId,
              title: newBatchTitle,
              createdAt: new Date().toISOString().split('T')[0],
              isActive: true,
              items: mappedItems,
            },
          ];
        }
        return prev.map((order, idx) => {
          if (idx === 0) {
            const maxSeq = order.items.reduce((max, it) => Math.max(max, it.seq || 0), 0);
            const reindexed = newItems.map((it, i) => ({
              ...it,
              seq: maxSeq + i + 1,
              orderId: order.id,
              orderTitle: order.title,
            }));
            return {
              ...order,
              items: [...order.items, ...reindexed],
            };
          }
          return order;
        });
      });
      setActiveView('orders');
    }
  };

  // Jump from report view to item view
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
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 pb-20">
      {/* Top Unified Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-2xs">
        <div className="max-w-[1280px] mx-auto px-3 sm:px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
          {/* Left: Brand Title + Current Workspace Label */}
          <div className="flex items-center gap-2 overflow-x-auto">
            <h1 className="text-sm font-bold text-slate-900 whitespace-nowrap">
              {t('appTitle')}
            </h1>
            <span className="text-slate-300 text-xs select-none">/</span>
            <span className="text-xs font-semibold text-indigo-700 whitespace-nowrap">
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

          {/* Right: Bilingual Switcher */}
          <div className="flex items-center gap-2">
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

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4 space-y-4 flex flex-col">
        {workspace === 'inventory' && <InventoryModule />}
        {workspace === 'stocktake' && <StocktakeModule />}
        {workspace === 'sales' && <SalesAnalyticsModule />}
        {workspace === 'settings' && <DbSettingsModule />}

        {workspace === 'receiving' && (
          <>
            {/* VIEW 1: 货单表格列表 (未完成在先，已完成按完成时间早到晚排序) */}
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

            {/* VIEW 2: 对应货单中的货物信息 */}
            {activeView === 'items' && selectedOrder && (
              <div className="space-y-3 sm:space-y-4">
                {/* Top Order Breadcrumb / Header */}
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

                {/* KPIs for this specific order */}
                <MetricsOverview
                  metrics={currentMetrics}
                  priceBasis={priceBasis}
                  onChangePriceBasis={setPriceBasis}
                  activeFilter={activeFilter}
                  onChangeFilter={setActiveFilter}
                />

                {/* Search / Scan Bar */}
                <ScannerBar
                  items={currentOrderItems}
                  onScanMatch={handleScanMatch}
                  onOpenItemModal={(item) => setSelectedItemForDetail(item)}
                  lastScannedItem={lastScannedItem}
                />

                {/* Items List */}
                <PdaListView
                  items={filteredCurrentOrderItems}
                  priceBasis={priceBasis}
                  onUpdateItem={handleUpdateItem}
                  onSelectItemForDetail={setSelectedItemForDetail}
                  highlightedItemId={highlightedItemId}
                />
              </div>
            )}

            {/* VIEW 3: 极速扫码查验 (只有这个Input框) */}
            {activeView === 'scan' && (
              <QuickScanView
                items={allOrdersItems}
                onScanMatch={handleScanMatch}
                onOpenItemModal={(item) => setSelectedItemForDetail(item)}
                lastScannedItem={lastScannedItem}
                onBackToOrders={() => setActiveView('orders')}
              />
            )}

            {/* VIEW 4: 差异审计报告 */}
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

      {/* Bottom Navigation Menu with Collapsible IMS Modules */}
      <Sidebar
        activeOrdersCount={orders.filter((o) => !isOrderCompleted(o)).length}
        workspace={workspace}
        setWorkspace={setWorkspace}
        activeView={activeView}
        setActiveView={setActiveView}
      />

      {/* Modals & Drawers */}
      <ImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportItems={handleImportItems}
      />

      <ItemDetailDrawer
        item={selectedItemForDetail}
        onClose={() => setSelectedItemForDetail(null)}
        onSave={handleUpdateItem}
        priceBasis={priceBasis}
      />
    </div>
  );
}

export default function App() {
  return (
    <ImsProvider>
      <AppContent />
    </ImsProvider>
  );
}
