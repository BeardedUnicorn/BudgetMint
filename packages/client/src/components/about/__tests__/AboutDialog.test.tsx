import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../../App';
import { BudgetSession } from '../../../cloud/session';
import { setShell } from '../../../shell';
import { createFakeShell, createFakeStore, TEST_NOW, testCore } from '../../../testing';
import { startBudget } from '../../../__tests__/setup/budget';
import { APP_VERSION } from '../../../utils/appVersion';
import {
  PRIVACY_URL,
  RELEASE_NOTES_URL,
  releaseNotesFor,
  reportProblemUrl,
  systemName,
  TERMS_URL,
  versionInfo,
  WhatsNew,
} from '../AboutDialog';

async function openAbout(seed: Parameters<typeof startBudget>[0] = {}) {
  const started = await startBudget(seed);
  await started.user.click(screen.getByRole('button', { name: 'Settings' }));
  await started.user.click(screen.getByRole('button', { name: 'About BudgetMint…' }));
  return { ...started, about: await screen.findByRole('dialog', { name: 'About BudgetMint' }) };
}

describe('About BudgetMint', () => {
  it('says which version this is, what’s new in it, and where to look further', async () => {
    const { about, user } = await openAbout();
    expect(about).toHaveTextContent(`Version ${APP_VERSION}`);
    expect(within(about).getByRole('heading', { name: `What’s new in ${APP_VERSION}` })).toBeInTheDocument();
    const link = (name: string) => within(about).getByRole('link', { name });
    expect(link('Release notes')).toHaveAttribute('href', RELEASE_NOTES_URL);
    expect(link('Privacy policy')).toHaveAttribute('href', PRIVACY_URL);
    expect(link('Terms of use')).toHaveAttribute('href', TERMS_URL);
    expect(link('Source code')).toHaveAttribute('href', 'https://github.com/BeardedUnicorn/BudgetMint');
    expect(link('MIT license')).toHaveAttribute('target', '_blank');
    // A report comes with the version filled in
    expect(link('Report a problem').getAttribute('href')).toBe(reportProblemUrl());
    expect(decodeURIComponent(reportProblemUrl())).toContain(versionInfo());
    // The desktop says nothing of updating without its own word (the shell's AboutUpdates)
    expect(about).not.toHaveTextContent(/newest version each time|install over this one/);

    await user.click(within(about).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('copies the version info for a report, and says when it can’t', async () => {
    const { about, user } = await openAbout();
    // userEvent's own clipboard replaces setupTests'
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(within(about).getByRole('button', { name: 'Copy version info' }));
    expect(writeText).toHaveBeenCalledWith(versionInfo());
    expect(versionInfo()).toMatch(new RegExp(`^BudgetMint ${APP_VERSION.replace(/\./g, '\\.')} · desktop · `));
    expect(await screen.findByText('Version info copied')).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error('denied'));
    await user.click(within(about).getByRole('button', { name: 'Copy version info' }));
    expect(await screen.findByText('Couldn’t copy the version info')).toBeInTheDocument();
  });

  it('has the shell’s word on updates, or says how Android and the web update', async () => {
    const AboutUpdates = () => <div>BudgetMint is up to date</div>;
    const desktop = await openAbout({ extensions: { AboutUpdates } });
    expect(desktop.about).toHaveTextContent('BudgetMint is up to date');
    desktop.unmount();

    const android = await openAbout({ shell: createFakeShell({ runtime: 'mobile' }) });
    expect(android.about).toHaveTextContent('Each release has an Android app to install over this one');
    expect(within(android.about).getByRole('link', { name: 'Releases' })).toHaveAttribute(
      'href',
      'https://github.com/BeardedUnicorn/BudgetMint/releases'
    );
    android.unmount();

    const web = await openAbout({ shell: createFakeShell({ runtime: 'web' }) });
    expect(web.about).toHaveTextContent('The web app is the newest version each time it opens online.');
  });

  it('opens from the menu bar before anyone has signed in', async () => {
    const shell = createFakeShell();
    setShell(shell);
    const core = testCore();
    const session = new BudgetSession(createFakeStore(), core, 'desk', null, {
      historyDays: 400,
      clock: () => TEST_NOW,
      restart: vi.fn(),
    });
    render(<App session={session} core={core} />);
    session.start();
    expect(await screen.findByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
    act(() => shell.clickMenu('about'));
    expect(await screen.findByRole('dialog', { name: 'About BudgetMint' })).toBeInTheDocument();
    // The budget's own items wait for it
    act(() => shell.clickMenu('go-bills'));
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Sign in to BudgetMint' })).toBeInTheDocument();
  });

  it('says nothing of what’s new for a version the changelog hasn’t yet', () => {
    const changelog = '# Changelog\n\n## 1.0.0 – 2026-11-10\n\n### Added\n\n- The first release.\n';
    expect(releaseNotesFor(changelog, '1.0.0')?.groups[0].items).toEqual(['The first release.']);
    expect(releaseNotesFor(changelog, '9.9.9')).toBeNull();
    const { container } = render(<WhatsNew release={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the system for a report', () => {
    const agents: [string, string][] = [
      ['Mozilla/5.0 (Linux; Android 15; Pixel 8)', 'Android'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iOS'],
      ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macOS'],
      ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows'],
      ['Mozilla/5.0 (X11; Linux x86_64)', 'Linux'],
      ['Something else', 'another system'],
    ];
    for (const [agent, name] of agents) expect(systemName(agent)).toBe(name);
  });
});
