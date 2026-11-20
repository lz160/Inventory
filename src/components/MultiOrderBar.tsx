import React, { useState } from 'react';
import { PurchaseOrder } from '../utils/reconciliation';
import { Layers, Plus, CheckSquare, Square, Trash2, Edit3, Check } from 'lucide-react';

interface MultiOrderBarProps {
  orders: PurchaseOrder[];
  onToggleOrderActive: (orderId: string) => void;
  onSelectAllOrders: (selectAll: boolean) => void;
  onAddNewOrder: () => void;
  onDeleteOrder: (orderId: string) => void;
  onRenameOrder: (orderId: string, newTitle: string) => void;
}

export const MultiOrderBar: React.FC<MultiOrderBarProps> = ({
  orders,
  onToggleOrderActive,
  onSelectAllOrders,
  onAddNewOrder,
  onDeleteOrder,
  onRenameOrder,
}) => {
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const activeCount = orders.filter((o) => o.isActive).length;

  const handleStartRename = (order: PurchaseOrder, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingOrderId(order.id);
    setEditingTitle(order.title);
  };

  const handleSaveRename = (orderId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (editingTitle.trim()) {
      onRenameOrder(orderId, editingTitle.trim());
    }
    setEditingOrderId(null);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-2.5 shadow-2xs">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-slate-100 pb-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-800">
            多单据同时核对工作区
          </span>
          <span className="text-[11px] text-slate-500">
            (已激活 <strong className="text-indigo-600 font-mono-numbers">{activeCount}</strong> / {orders.length} 张单据，扫码将全单联合匹配)
          </span>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-xs">
          <button
            onClick={() => onSelectAllOrders(activeCount < orders.length)}
            className="text-[11px] text-slate-600 hover:text-indigo-600 font-medium transition-colors"
          >
            {activeCount === orders.length ? '取消全选' : '全选所有单据'}
          </button>
          <span className="text-slate-300">|</span>
          <button
            onClick={onAddNewOrder}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>新建/导入新单据</span>
          </button>
        </div>
      </div>

      {/* Orders List / Toggles */}
      <div className="flex flex-wrap items-center gap-2">
        {orders.map((order, idx) => {
          const totalExpected = order.items.reduce((s, it) => s + it.expectedQty, 0);
          const totalReceived = order.items.reduce((s, it) => s + it.receivedQty, 0);
          const isDone = totalExpected > 0 && totalReceived >= totalExpected;

          return (
            <div
              key={order.id}
              onClick={() => onToggleOrderActive(order.id)}
              className={`group px-3 py-1.5 rounded-lg border text-xs cursor-pointer select-none transition-all flex items-center gap-2 ${
                order.isActive
                  ? 'bg-indigo-50/80 border-indigo-300 text-indigo-950 font-medium shadow-2xs ring-1 ring-indigo-400/20'
                  : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100/80'
              }`}
            >
              {order.isActive ? (
                <CheckSquare className="w-4 h-4 text-indigo-600 shrink-0" />
              ) : (
                <Square className="w-4 h-4 text-slate-400 shrink-0" />
              )}

              {editingOrderId === order.id ? (
                <form
                  onSubmit={(e) => handleSaveRename(order.id, e)}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center gap-1"
                >
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    autoFocus
                    className="px-1.5 py-0.5 text-xs bg-white border border-indigo-400 rounded focus:outline-none"
                  />
                  <button type="submit" className="p-0.5 text-indigo-600">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold truncate max-w-[150px]" title={order.title}>
                    {order.title}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono-numbers">
                    ({order.items.length}款 · {totalReceived}/{totalExpected}件)
                  </span>
                  {isDone && (
                    <span className="text-[10px] text-emerald-600 font-bold font-mono">
                      [齐]
                    </span>
                  )}
                </div>
              )}

              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity ml-1">
                <button
                  type="button"
                  onClick={(e) => handleStartRename(order, e)}
                  className="p-0.5 text-slate-400 hover:text-slate-700"
                  title="重命名单据"
                >
                  <Edit3 className="w-3 h-3" />
                </button>
                {orders.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteOrder(order.id);
                    }}
                    className="p-0.5 text-slate-400 hover:text-rose-600"
                    title="删除此单据"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
