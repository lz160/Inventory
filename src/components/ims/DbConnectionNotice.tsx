import React from 'react';
import { Database, RefreshCw, AlertTriangle, Settings } from 'lucide-react';
import { DbTargetStatus, useIms } from '../../context/ImsContext';

interface DbConnectionNoticeProps {
  targets: Array<{ name: 'SKLAD' | 'SaleData'; status: DbTargetStatus }>;
}

export const DbConnectionNotice: React.FC<DbConnectionNoticeProps> = ({ targets }) => {
  const { lang, t, checkingDb, refreshContext, openSettings } = useIms();
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
                  {status.targetInfo && (
                    <span className="font-mono-numbers text-[11px] text-slate-500">
                      {t('dbTargetLabel')}: {status.targetInfo.server || '—'}:
                      {status.targetInfo.port || 1433} / {status.targetInfo.database || name}
                    </span>
                  )}
                </div>
                <p className="text-rose-700 font-medium leading-relaxed">
                  {status.reason ||
                    (lang === 'zh'
                      ? `无法连接到门店 SQL Server (${name})，请检查数据库主机地址、端口与网络连通性。`
                      : `Nepodarilo sa pripojiť k SQL Serveru (${name}). Skontrolujte hostiteľa a port.`)}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-slate-500 leading-relaxed max-w-md">
              {lang === 'zh'
                ? '可点击「前往连接设置」直接修改 SKLAD / SaleData 的 IP 地址、端口与账号密码，或在运行时环境变量中配置后重新检测。'
                : 'Kliknite na «Nastaviť pripojenie» pre manuálnu úpravu adresy a účtu SQL Servera, alebo aktualizujte premenné prostredia.'}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={openSettings}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 whitespace-nowrap"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>{t('dbGoToSettingsBtn')}</span>
              </button>
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
