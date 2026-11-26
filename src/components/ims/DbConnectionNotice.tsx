import React from 'react';
import { Database, RefreshCw, AlertTriangle } from 'lucide-react';
import { DbTargetStatus, useIms } from '../../context/ImsContext';

interface DbConnectionNoticeProps {
  targets: Array<{ name: 'SKLAD' | 'SaleData'; status: DbTargetStatus }>;
}

export const DbConnectionNotice: React.FC<DbConnectionNoticeProps> = ({ targets }) => {
  const { lang, t, checkingDb, refreshContext } = useIms();
  const failed = targets.filter((item) => !item.status.ok);
  if (failed.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-amber-200 p-6 shadow-2xs max-w-2xl mx-auto my-6">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600 shrink-0">
          <Database className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{t('dbUnavailableTitle')}</span>
          </h3>

          <div className="mt-3 space-y-2.5">
            {failed.map(({ name, status }) => (
              <div
                key={name}
                className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs space-y-1"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-800">{name}</span>
                </div>
                <p className="text-rose-700 font-medium leading-relaxed">
                  {status.reason ||
                    (lang === 'zh'
                      ? `无法连接到门店 SQL Server (${name})，请联系系统管理员检查门店数据库连接配置。`
                      : `Nepodarilo sa pripojiť k SQL Serveru (${name}). Kontaktujte správcu systému.`)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-md">
              {lang === 'zh'
                ? '门店数据库连接参数仅由系统管理员（admin）在后台配置与调试，请联系管理员确认连接后重试。'
                : 'Nastavenie databázy predajne môže upravovať iba správca (admin). Po oprave pripojenia kliknite na znova otestovať.'}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                disabled={checkingDb}
                onClick={() => refreshContext(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checkingDb ? 'animate-spin' : ''}`} />
                <span>{t('dbRecheckBtn')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
