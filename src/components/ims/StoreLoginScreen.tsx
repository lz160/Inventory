import React, { useState } from 'react';
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
  Languages,
  Building2,
} from 'lucide-react';
import { useIms } from '../../context/ImsContext';

export const StoreLoginScreen: React.FC = () => {
  const {
    lang,
    toggleLang,
    t,
    initialized,
    hasStores,
    bootstrapAccount,
    loginAccount,
    showToast,
  } = useIms();

  // First-run Admin + Store Bootstrap state
  const [bootUsername, setBootUsername] = useState('admin');
  const [bootDisplayName, setBootDisplayName] = useState(lang === 'zh' ? '系统管理员' : 'Správca');
  const [bootCode, setBootCode] = useState('STORE01');
  const [bootName, setBootName] = useState(lang === 'zh' ? '总店' : 'Centrála');
  const [bootPassword, setBootPassword] = useState('');
  const [bootConfirm, setBootConfirm] = useState('');

  // Account Login state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleBootstrap = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (bootPassword !== bootConfirm) {
      setErrorMsg(lang === 'zh' ? '两次输入的密码不一致' : 'Heslá sa nezhodujú');
      return;
    }
    setSubmitting(true);
    try {
      await bootstrapAccount({
        username: bootUsername.trim().toLowerCase(),
        displayName: bootDisplayName.trim(),
        password: bootPassword,
        ...(hasStores
          ? {}
          : {
              storeCode: bootCode.trim().toUpperCase(),
              storeName: bootName.trim(),
            }),
      });
      showToast(
        lang === 'zh' ? '管理员账户已创建并进入工作台' : 'Účet správcu vytvorený',
        'success'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || '初始化失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const uname = loginUsername.trim().toLowerCase();
    if (!uname) {
      setErrorMsg(lang === 'zh' ? '请输入登录账号' : 'Zadajte prihlasovacie meno');
      return;
    }
    setSubmitting(true);
    try {
      await loginAccount({
        username: uname,
        password: loginPassword,
      });
      setLoginPassword('');
    } catch (err: any) {
      setErrorMsg(err?.message || '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        {/* Top Brand + Language Toggle */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-2xs">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-900">{t('appTitle')}</h1>
              <p className="text-[11px] text-slate-500">Multi-Store POS & IMS</p>
            </div>
          </div>
          <button
            type="button"
            onClick={toggleLang}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            <Languages className="w-3.5 h-3.5 text-indigo-600" />
            <span>{lang === 'zh' ? '中文' : 'SK'}</span>
          </button>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-5">
          {!initialized ? (
            <form onSubmit={handleBootstrap} className="space-y-4" data-testid="account-bootstrap-form">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900">{t('authBootstrapTitle')}</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {hasStores ? t('authBootstrapUpgradeSubtitle') : t('authBootstrapSubtitle')}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {t('authUsernameLabel')}
                  </span>
                  <input
                    type="text"
                    name="bootstrap-username"
                    value={bootUsername}
                    onChange={(e) => setBootUsername(e.target.value)}
                    placeholder={t('authUsernamePlaceholder')}
                    required
                    className="w-full px-3 py-2 text-xs font-mono-numbers rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </label>

                <label className="block">
                  <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {t('authDisplayNameLabel')}
                  </span>
                  <input
                    type="text"
                    name="bootstrap-display-name"
                    value={bootDisplayName}
                    onChange={(e) => setBootDisplayName(e.target.value)}
                    placeholder={t('authDisplayNamePlaceholder')}
                    required
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </label>
              </div>

              {!hasStores && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                  <label className="block">
                    <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {t('authStoreCodeLabel')}
                    </span>
                    <input
                      type="text"
                      name="bootstrap-store-code"
                      value={bootCode}
                      onChange={(e) => setBootCode(e.target.value.toUpperCase())}
                      placeholder={t('authStoreCodePlaceholder')}
                      required
                      className="w-full px-3 py-2 text-xs font-mono-numbers uppercase rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </label>

                  <label className="block">
                    <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                      {t('authStoreNameLabel')}
                    </span>
                    <input
                      type="text"
                      name="bootstrap-store-name"
                      value={bootName}
                      onChange={(e) => setBootName(e.target.value)}
                      placeholder={t('authStoreNamePlaceholder')}
                      required
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    />
                  </label>
                </div>
              )}

              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {t('authPasswordLabel')}
                </span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="bootstrap-password"
                    value={bootPassword}
                    onChange={(e) => setBootPassword(e.target.value)}
                    placeholder={t('authPasswordPlaceholder')}
                    required
                    minLength={4}
                    autoComplete="new-password"
                    className="w-full pl-3 pr-9 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </label>

              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {t('authConfirmPasswordLabel')}
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="bootstrap-password-confirm"
                  value={bootConfirm}
                  onChange={(e) => setBootConfirm(e.target.value)}
                  placeholder={t('authConfirmPasswordPlaceholder')}
                  required
                  minLength={4}
                  autoComplete="new-password"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </label>

              {errorMsg && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                data-testid="bootstrap-submit-btn"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                <span>{t('authBootstrapSubmit')}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4" data-testid="account-login-form">
              <div className="space-y-1">
                <h2 className="text-base font-bold text-slate-900">{t('authLoginTitle')}</h2>
                <p className="text-xs text-slate-500 leading-relaxed">{t('authLoginSubtitle')}</p>
              </div>

              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {t('authUsernameLabel')}
                </span>
                <div className="relative">
                  <User className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    name="login-username"
                    value={loginUsername}
                    onChange={(e) => {
                      setLoginUsername(e.target.value);
                      setErrorMsg(null);
                    }}
                    required
                    autoComplete="username"
                    autoFocus
                    className="w-full pl-8 pr-3 py-2.5 text-xs font-mono-numbers rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                </div>
              </label>

              <label className="block">
                <span className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {t('authPasswordLabel')}
                </span>
                <div className="relative">
                  <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="login-password"
                    value={loginPassword}
                    onChange={(e) => {
                      setLoginPassword(e.target.value);
                      setErrorMsg(null);
                    }}
                    required
                    autoComplete="current-password"
                    className="w-full pl-8 pr-9 py-2.5 text-xs rounded-xl border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label="Toggle password visibility"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </label>

              {errorMsg && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                data-testid="login-submit-btn"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                <span>{t('authLoginSubmit')}</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
