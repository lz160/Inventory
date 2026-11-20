import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  CopyCheck,
  RotateCcw,
  Save,
  PlugZap,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldCheck,
  Info,
} from 'lucide-react';
import { DbTargetStatus, useIms } from '../../context/ImsContext';

type DbTargetKey = 'sklad' | 'saledata';

interface SanitizedDbConfig {
  target: DbTargetKey;
  server: string;
  port: number;
  database: string;
  user: string;
  hasPassword: boolean;
  encrypt: boolean;
  trustServerCertificate: boolean;
  source: 'override' | 'env' | 'unconfigured';
  updatedAt?: string;
}

interface DbConfigPayload {
  dbMode: 'mssql' | 'sqlite-seed';
  sklad: SanitizedDbConfig;
  saledata: SanitizedDbConfig;
  dbStatus?: {
    sklad: DbTargetStatus;
    saledata: DbTargetStatus;
  };
}

interface DbTestResponse {
  ok: boolean;
  durationMs: number;
  reason?: string;
  errorCode?: 'UNCONFIGURED' | 'INVALID_HOST' | 'UNREACHABLE';
  targetInfo: {
    server: string;
    port: number;
    database: string;
  };
}

interface TargetFormState {
  server: string;
  port: string;
  database: string;
  user: string;
  password: string;
  hasPassword: boolean;
  encrypt: boolean;
  trustServerCertificate: boolean;
  source: 'override' | 'env' | 'unconfigured';
  updatedAt?: string;
  syncPasswordFromSklad?: boolean;
}

function toFormState(cfg: SanitizedDbConfig): TargetFormState {
  return {
    server: cfg.server || '',
    port: String(cfg.port || 1433),
    database: cfg.database || (cfg.target === 'sklad' ? 'SKLAD' : 'SaleData'),
    user: cfg.user || '',
    password: '',
    hasPassword: Boolean(cfg.hasPassword),
    encrypt: Boolean(cfg.encrypt),
    trustServerCertificate: Boolean(cfg.trustServerCertificate),
    source: cfg.source,
    updatedAt: cfg.updatedAt,
    syncPasswordFromSklad: false,
  };
}

export const DbSettingsModule: React.FC = () => {
  const { lang, t, apiCall, showToast, dbMode, dbStatus, updateDbStatus } = useIms();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const [sklad, setSklad] = useState<TargetFormState>(() =>
    toFormState({
      target: 'sklad',
      server: '',
      port: 1433,
      database: 'SKLAD',
      user: '',
      hasPassword: false,
      encrypt: false,
      trustServerCertificate: true,
      source: 'unconfigured',
    })
  );
  const [saledata, setSaledata] = useState<TargetFormState>(() =>
    toFormState({
      target: 'saledata',
      server: '',
      port: 1433,
      database: 'SaleData',
      user: '',
      hasPassword: false,
      encrypt: false,
      trustServerCertificate: true,
      source: 'unconfigured',
    })
  );

  const [showPassword, setShowPassword] = useState<Record<DbTargetKey, boolean>>({
    sklad: false,
    saledata: false,
  });

  const [testingTarget, setTestingTarget] = useState<Record<DbTargetKey, boolean>>({
    sklad: false,
    saledata: false,
  });

  const [testResults, setTestResults] = useState<Partial<Record<DbTargetKey, DbTestResponse>>>({});

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall<DbConfigPayload>('/api/ims/db-config');
      setSklad(toFormState(res.sklad));
      setSaledata(toFormState(res.saledata));
    } catch (err: any) {
      showToast(err?.message || '读取数据库连接配置失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [apiCall, showToast]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSyncFromSklad = () => {
    setSaledata((prev) => ({
      ...prev,
      server: sklad.server,
      port: sklad.port,
      user: sklad.user,
      password: sklad.password,
      encrypt: sklad.encrypt,
      trustServerCertificate: sklad.trustServerCertificate,
      hasPassword: Boolean(sklad.password) || sklad.hasPassword,
      syncPasswordFromSklad: !sklad.password && sklad.hasPassword,
    }));
    setTestResults((prev) => ({ ...prev, saledata: undefined }));
    showToast(
      lang === 'zh'
        ? '已将 SKLAD 主机、端口、认证及安全开关同步至 SaleData（请测试或保存）'
        : 'Hostiteľ a prihlasovacie údaje zo SKLAD boli skopírované do SaleData',
      'info'
    );
  };

  const buildPayloadForTarget = (form: TargetFormState) => ({
    server: form.server.trim(),
    port: Number(form.port || 1433),
    database: form.database.trim(),
    user: form.user.trim(),
    ...(form.password !== '' ? { password: form.password } : {}),
    ...(form.syncPasswordFromSklad ? { syncPasswordFromSklad: true } : {}),
    encrypt: form.encrypt,
    trustServerCertificate: form.trustServerCertificate,
  });

  const handleTestTarget = async (target: DbTargetKey) => {
    const form = target === 'sklad' ? sklad : saledata;
    setTestingTarget((prev) => ({ ...prev, [target]: true }));
    try {
      const res = await apiCall<DbTestResponse>('/api/ims/db-config/test', {
        method: 'POST',
        body: JSON.stringify({
          target,
          config: buildPayloadForTarget(form),
        }),
      });
      setTestResults((prev) => ({ ...prev, [target]: res }));
      if (res.ok) {
        showToast(
          lang === 'zh'
            ? `${target === 'sklad' ? 'SKLAD' : 'SaleData'} 连接测试成功 (${res.durationMs}ms)`
            : `${target === 'sklad' ? 'SKLAD' : 'SaleData'} test pripojenia úspešný (${res.durationMs}ms)`,
          'success'
        );
      } else {
        showToast(res.reason || '连接测试失败', 'error');
      }
    } catch (err: any) {
      showToast(err?.message || '连接测试请求失败', 'error');
    } finally {
      setTestingTarget((prev) => ({ ...prev, [target]: false }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiCall<DbConfigPayload>('/api/ims/db-config', {
        method: 'PUT',
        body: JSON.stringify({
          sklad: buildPayloadForTarget(sklad),
          saledata: buildPayloadForTarget(saledata),
        }),
      });
      setSklad(toFormState(res.sklad));
      setSaledata(toFormState(res.saledata));
      setTestResults({});
      if (res.dbStatus) {
        updateDbStatus(res.dbStatus, {
          sklad: Boolean(res.sklad.server && res.sklad.user),
          saledata: Boolean(res.saledata.server && res.saledata.user),
        });
      }
      const allOk = res.dbStatus ? res.dbStatus.sklad.ok && res.dbStatus.saledata.ok : true;
      showToast(
        allOk
          ? lang === 'zh'
            ? '配置已保存并立即连接成功'
            : 'Nastavenia uložené a pripojenie je aktívne'
          : lang === 'zh'
          ? '配置已保存至本地配置库，但部分数据库仍暂不可达'
          : 'Nastavenia uložené, ale niektorá databáza nie je dostupná',
        allOk ? 'success' : 'info'
      );
    } catch (err: any) {
      showToast(err?.message || '保存数据库配置失败', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    setResetting(true);
    try {
      const res = await apiCall<DbConfigPayload>('/api/ims/db-config', {
        method: 'DELETE',
      });
      setSklad(toFormState(res.sklad));
      setSaledata(toFormState(res.saledata));
      setTestResults({});
      setConfirmReset(false);
      if (res.dbStatus) {
        updateDbStatus(res.dbStatus, {
          sklad: Boolean(res.sklad.server && res.sklad.user),
          saledata: Boolean(res.saledata.server && res.saledata.user),
        });
      }
      showToast(
        lang === 'zh'
          ? '已清除手动覆盖并恢复为环境变量默认配置'
          : 'Lokálne nastavenia odstránené, obnovené predvolené z ENV',
        'success'
      );
    } catch (err: any) {
      showToast(err?.message || '恢复默认失败', 'error');
    } finally {
      setResetting(false);
    }
  };

  const renderSourceText = (source: TargetFormState['source']) => {
    if (source === 'override') return t('dbSourceOverride');
    if (source === 'env') return t('dbSourceEnv');
    return t('dbSourceUnconfigured');
  };

  const renderCard = (
    target: DbTargetKey,
    form: TargetFormState,
    setForm: React.Dispatch<React.SetStateAction<TargetFormState>>,
    title: string,
    desc: string,
    liveStatus: DbTargetStatus
  ) => {
    const testResult = testResults[target];
    const isTesting = testingTarget[target];
    const isVisible = showPassword[target];

    const passwordPlaceholder = form.syncPasswordFromSklad
      ? t('dbPasswordSyncedHint')
      : form.hasPassword
      ? t('dbPasswordSavedPlaceholder')
      : t('dbPasswordEmptyPlaceholder');

    return (
      <section
        key={target}
        data-testid={`db-card-${target}`}
        className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-2xs flex flex-col justify-between gap-4"
      >
        <div className="space-y-4">
          {/* Card Header */}
          <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-100">
            <div className="flex items-start gap-2.5">
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 shrink-0 mt-0.5">
                <Database className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">{title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              </div>
            </div>
            <div className="text-right text-[11px] font-medium text-slate-500 whitespace-nowrap">
              {renderSourceText(form.source)}
            </div>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="sm:col-span-2 block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('dbFieldServer')}
              </span>
              <input
                type="text"
                name={`${target}-server`}
                value={form.server}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((prev) => ({ ...prev, server: value }));
                  setTestResults((prev) => ({ ...prev, [target]: undefined }));
                }}
                placeholder="192.168.1.100 或 sql.store.sk"
                autoComplete="off"
                className="w-full px-3 py-2 text-xs font-mono-numbers rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('dbFieldPort')}
              </span>
              <input
                type="number"
                name={`${target}-port`}
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((prev) => ({ ...prev, port: value }));
                  setTestResults((prev) => ({ ...prev, [target]: undefined }));
                }}
                className="w-full px-3 py-2 text-xs font-mono-numbers tabular-nums rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('dbFieldDatabase')}
              </span>
              <input
                type="text"
                name={`${target}-database`}
                value={form.database}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((prev) => ({ ...prev, database: value }));
                  setTestResults((prev) => ({ ...prev, [target]: undefined }));
                }}
                placeholder={target === 'sklad' ? 'SKLAD' : 'SaleData'}
                className="w-full px-3 py-2 text-xs font-mono-numbers rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </label>

            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('dbFieldUser')}
              </span>
              <input
                type="text"
                name={`${target}-user`}
                value={form.user}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((prev) => ({ ...prev, user: value }));
                  setTestResults((prev) => ({ ...prev, [target]: undefined }));
                }}
                placeholder="sa"
                autoComplete="off"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </label>
          </div>

          <div>
            <label className="block">
              <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                {t('dbFieldPassword')}
              </span>
              <div className="relative">
                <input
                  type={isVisible ? 'text' : 'password'}
                  name={`${target}-password`}
                  value={form.password}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      password: value,
                      syncPasswordFromSklad: false,
                    }));
                    setTestResults((prev) => ({ ...prev, [target]: undefined }));
                  }}
                  placeholder={passwordPlaceholder}
                  autoComplete="new-password"
                  className="w-full pl-3 pr-9 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => ({ ...prev, [target]: !prev[target] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-0.5"
                  aria-label="Toggle password visibility"
                >
                  {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </label>
          </div>

          {/* TLS Security Toggles */}
          <div className="pt-1 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-700">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                name={`${target}-encrypt`}
                checked={form.encrypt}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((prev) => ({ ...prev, encrypt: checked }));
                  setTestResults((prev) => ({ ...prev, [target]: undefined }));
                }}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-medium">{t('dbFieldEncrypt')}</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                name={`${target}-trust-cert`}
                checked={form.trustServerCertificate}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setForm((prev) => ({ ...prev, trustServerCertificate: checked }));
                  setTestResults((prev) => ({ ...prev, [target]: undefined }));
                }}
                className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="font-medium flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                <span>{t('dbFieldTrustCert')}</span>
              </span>
            </label>
          </div>
        </div>

        {/* Footer: Test status + Test button */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
          <div className="flex-1 min-w-0 text-xs">
            {testResult ? (
              testResult.ok ? (
                <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="truncate font-mono-numbers tabular-nums">
                    {lang === 'zh'
                      ? `测试连接成功 (${testResult.durationMs}ms)`
                      : `Pripojenie OK (${testResult.durationMs}ms)`}
                  </span>
                </div>
              ) : (
                <div className="flex items-start gap-1.5 text-rose-700 font-medium leading-snug">
                  <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="break-words">{testResult.reason}</span>
                </div>
              )
            ) : liveStatus.ok ? (
              <div className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>
                  {dbMode === 'sqlite-seed'
                    ? lang === 'zh'
                      ? '当前沙盒演示运行中'
                      : 'Sandbox aktívny'
                    : lang === 'zh'
                    ? '当前连接状态正常'
                    : 'Pripojenie aktívne'}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-1.5 text-amber-700 font-medium leading-snug">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="break-words">
                  {liveStatus.reason ||
                    (lang === 'zh' ? '当前连接未就绪' : 'Pripojenie nie je aktívne')}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            data-testid={`test-btn-${target}`}
            disabled={isTesting || saving || resetting}
            onClick={() => handleTestTarget(target)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            {isTesting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
            ) : (
              <PlugZap className="w-3.5 h-3.5 text-indigo-600" />
            )}
            <span>{isTesting ? t('dbTestingConnBtn') : t('dbTestConnBtn')}</span>
          </button>
        </div>
      </section>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
        <span>{t('loading')}</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Header Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h2 className="text-base font-bold text-slate-900">{t('dbSettingsTitle')}</h2>
          <p className="text-xs text-slate-500 leading-relaxed">{t('dbSettingsSubtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            data-testid="sync-sklad-btn"
            onClick={handleSyncFromSklad}
            disabled={saving || resetting}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <CopyCheck className="w-3.5 h-3.5 text-indigo-600" />
            <span>{t('dbSyncFromSkladBtn')}</span>
          </button>

          {confirmReset ? (
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                data-testid="confirm-reset-db-btn"
                disabled={resetting || saving}
                onClick={handleResetDefaults}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap"
              >
                {resetting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                <span>{t('dbResetConfirmBtn')}</span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="px-2.5 py-2 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 whitespace-nowrap"
              >
                {t('cancel')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              data-testid="reset-db-btn"
              onClick={() => setConfirmReset(true)}
              disabled={saving || resetting}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
              <span>{t('dbResetDefaultBtn')}</span>
            </button>
          )}

          <button
            type="submit"
            data-testid="save-db-config-btn"
            disabled={saving || resetting}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{saving ? t('dbSavingBtn') : t('dbSaveApplyBtn')}</span>
          </button>
        </div>
      </div>

      {dbMode === 'sqlite-seed' && (
        <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <span>{t('dbSandboxNotice')}</span>
        </div>
      )}

      {/* Two-column SKLAD + SaleData Config Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {renderCard(
          'sklad',
          sklad,
          setSklad,
          t('dbCardSkladTitle'),
          t('dbCardSkladDesc'),
          dbStatus.sklad
        )}
        {renderCard(
          'saledata',
          saledata,
          setSaledata,
          t('dbCardSaleDataTitle'),
          t('dbCardSaleDataDesc'),
          dbStatus.saledata
        )}
      </div>
    </form>
  );
};
