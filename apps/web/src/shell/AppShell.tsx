import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, LogOut, Shield } from 'lucide-react';
import { ActionDialog } from '@dentalai/ui';
import type { AuthIdentity } from '@dentalai/contracts';
import { apiClient } from '../lib/api-client';
import { getErrorMessage } from '../lib/errors';
import { t } from '../i18n';
import { displayStatus } from '../i18n/display';
import { LanguageControl } from '../i18n/LanguageControl';
import { workspaceNavigation } from './navigation';

export function AppShell({
  identity,
  refresh,
  children,
}: {
  identity: AuthIdentity;
  refresh: () => Promise<void>;
  children: ReactNode;
}) {
  const location = useLocation(),
    member = identity.activeMembership;
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const navigation = workspaceNavigation(member?.roles ?? [], !!member);
  const path = location.pathname + location.search + location.hash;
  const current =
    navigation.find((item) => item.to === path) ??
    navigation.find((item) => item.to === location.pathname);
  const nav = (mobile = false) => (
    <div className="ui-sidebar">
      <Link to="/dashboard" className="ui-brand" onClick={() => setOpen(false)}>
        <span className="ui-brand-icon">
          <Shield aria-hidden="true" size={23} />
        </span>
        {t('ui.9ffbc5261ff3b471')}
      </Link>
      <nav aria-label={t('polish.navigation')}>
        {(['work', 'manage', 'account'] as const).map((group) => (
          <div key={group}>
            {navigation.some((item) => item.group === group) && (
              <p className="ui-nav-group">
                {t(
                  group === 'work'
                    ? 'polish.workspace'
                    : group === 'manage'
                      ? 'polish.management'
                      : 'polish.account',
                )}
              </p>
            )}
            {navigation
              .filter((item) => item.group === group)
              .map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className="ui-nav-link"
                  aria-current={item === current ? 'page' : undefined}
                  onClick={() => {
                    if (mobile) setOpen(false);
                  }}
                >
                  <item.icon size={18} aria-hidden="true" />
                  <span>{t(item.label)}</span>
                </Link>
              ))}
          </div>
        ))}
      </nav>
      <div className="ui-sidebar-footer">
        {member && (
          <div className="ui-sidebar-clinic">
            <span className="ui-clinic-mark">
              <bdi>{member.brandMark ?? member.clinicName.slice(0, 2)}</bdi>
            </span>
            <p className="ui-clinic-name">
              <bdi>{member.clinicName}</bdi>
            </p>
          </div>
        )}
        <button
          className="ui-nav-action"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError('');
            void apiClient
              .logout()
              .then(() => window.location.assign('/login'))
              .catch((e: unknown) => setError(getErrorMessage(e)))
              .finally(() => setBusy(false));
          }}
        >
          <LogOut size={18} aria-hidden="true" />
          {t('ui.48f0d3d397d49f13')}
        </button>
      </div>
    </div>
  );
  return (
    <div className="app-shell">
      <a href="#workspace-content" className="ui-skip-link">
        {t('polish.skip')}
      </a>
      <aside className="ui-desktop-sidebar">{nav()}</aside>
      <div className="ui-shell-body">
        <header className="ui-topbar">
          <div className="ui-topbar-context">
            <button
              className="ui-icon-button ui-menu-toggle"
              aria-label={t('polish.openMenu')}
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu size={21} aria-hidden="true" />
            </button>
            <div>
              <p className="ui-topbar-title">
                {current ? t(current.label) : t('polish.workspace')}
              </p>
              <p className="ui-topbar-clinic">
                <bdi>{member?.clinicName ?? t('ui.45e5254085eb0ad8')}</bdi>
              </p>
            </div>
          </div>
          <div className="ui-topbar-actions">
            {identity.memberships.length > 1 && (
              <select
                aria-label={t('ui.fd077f7c65f5f772')}
                value={member?.id ?? ''}
                disabled={busy}
                onChange={(event) => {
                  const id = event.target.value;
                  setBusy(true);
                  setError('');
                  void apiClient
                    .selectMembership(id)
                    .then(refresh)
                    .catch((e: unknown) => setError(getErrorMessage(e)))
                    .finally(() => setBusy(false));
                }}
              >
                <option value="" disabled>
                  {t('ui.499d3091addb65cb')}
                </option>
                {identity.memberships.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.clinicName}
                  </option>
                ))}
              </select>
            )}
            <LanguageControl floating={false} />
            <Link to="/dashboard#account" className="ui-user-link" aria-label={t('polish.account')}>
              <span className="ui-avatar" aria-hidden="true">
                {identity.user.name.slice(0, 1)}
              </span>
              <span className="ui-user-copy">
                <span className="ui-user-name">
                  <bdi>{identity.user.name}</bdi>
                </span>
                <span className="ui-user-role block">
                  {member?.roles.map(displayStatus).join(' · ') ?? t('role.patient')}
                </span>
              </span>
            </Link>
          </div>
        </header>
        <div id="workspace-content" tabIndex={-1} className="ui-workspace">
          {error && (
            <p role="alert" className="ui-safety-notice">
              {error}
            </p>
          )}
          {children}
        </div>
      </div>
      {open && (
        <ActionDialog
          title={t('polish.navigation')}
          onClose={() => setOpen(false)}
          className="ui-mobile-drawer"
        >
          {nav(true)}
        </ActionDialog>
      )}
    </div>
  );
}
