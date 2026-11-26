import React, { useState } from 'react';
import { Lock, Eye, EyeOff, Loader2, CheckCircle2, KeyRound } from 'lucide-react';
import { useIms } from '../../context/ImsContext';

export const DbSettingsModule: React.FC = () => {
  const { lang, t, apiCall, showToast, user, currentStore } = useIms();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const roleLabel =
    user?.role === 'admin'
      ? t('userRoleAdmin')
      : user?.role === 'manager'
      ? t('userRoleManager')
      : t('userRoleStaff');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!currentPassword) {
      setErrorMsg(lang === 'zh' ? '请输入当前密码' : 'Zadajte aktuálne heslo');
      return;
    }
    if (newPassword.length < 4 || newPassword.length > 128) {
      setErrorMsg(lang === 'zh' ? '新密码长度需为 4–128 位字符' : 'Nové heslo musí mať 4–128 znakov');
      return;
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg(t('changePwMismatchError'));
      return;
    }

    setSubmitting(true);
    try {
      await apiCall('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      const msg = t('changePwSuccessToast');
      setSuccessMsg(msg);
      showToast(msg, 'success');
    } catch (err: any) {
      const msg = err?.message || (lang === 'zh' ? '修改密码失败' : 'Zmena hesla zlyhala');
      setErrorMsg(msg);
      showToast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg w-full mx-auto py-2">
      <section
        data-testid="change-password-panel"
        className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 space-y-5"
      >
        <div className="flex items-start gap-3 pb-4 border-b border-slate-100">
          <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-bold text-slate-900">{t('changePwTitle')}</h2>
            <p className="text-xs text-slate-500 leading-relaxed">{t('changePwSubtitle')}</p>
            {user && (
              <div className="pt-1 text-xs text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-semibold text-slate-900">{user.displayName}</span>
                <span className="font-mono-numbers text-slate-500">{user.username}</span>
                <span className="text-slate-300">·</span>
                <span>{roleLabel}</span>
                {currentStore && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono-numbers">
                      {currentStore.storeName} ({currentStore.storeCode})
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-700 mb-1">
              {t('changePwCurrentLabel')}
            </span>
            <div className="relative">
              <Lock className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type={showPasswords ? 'text' : 'password'}
                name="current-password"
                data-testid="change-pw-current"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                required
                autoComplete="current-password"
                className="w-full pl-8 pr-9 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((p) => !p)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                aria-label="Toggle password visibility"
              >
                {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-700 mb-1">
              {t('changePwNewLabel')}
            </span>
            <input
              type={showPasswords ? 'text' : 'password'}
              name="new-password"
              data-testid="change-pw-new"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              placeholder={t('authPasswordPlaceholder')}
              required
              minLength={4}
              maxLength={128}
              autoComplete="new-password"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </label>

          <label className="block">
            <span className="block text-[11px] font-semibold text-slate-700 mb-1">
              {t('changePwConfirmLabel')}
            </span>
            <input
              type={showPasswords ? 'text' : 'password'}
              name="confirm-password"
              data-testid="change-pw-confirm"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              placeholder={t('authConfirmPasswordPlaceholder')}
              required
              minLength={4}
              maxLength={128}
              autoComplete="new-password"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
            />
          </label>

          {errorMsg && (
            <div className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="flex items-center gap-1.5 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="pt-1 flex justify-end">
            <button
              type="submit"
              data-testid="change-pw-submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
            >
              {submitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <KeyRound className="w-3.5 h-3.5" />
              )}
              <span>{submitting ? t('changePwSubmittingBtn') : t('changePwSubmitBtn')}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};
