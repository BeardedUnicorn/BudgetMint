// Adapted from TaskMint packages/client/src/components/pages/__tests__/SettingsPage.test.tsx @ 94318ec: BudgetMint's sections and shell, Back through the window's history, and the app's main area as what scrolls.
/**
 * Settings' layout: the list of sections beside them, and a phone's list
 * that opens each on its own screen. What the sections hold is tested
 * through the whole app (SettingsPage.test.tsx).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { setPhoneViewport } from '../../../../__tests__/setup/viewport';
import { AppExtensionsContext } from '../../../../app/extensions';
import { NavigationProvider, useNavigation } from '../../../../contexts/NavigationContext';
import type { NavigationParams } from '../../../../navigation/views';
import { setShell } from '../../../../shell';
import type { AppExtensions } from '../../../../shell/types';
import { createFakeShell } from '../../../../testing';
import { currentSection, SETTINGS_SECTIONS, SettingsPage } from '../SettingsPage';

// The sections have their own tests; here they're placeholders
vi.mock('../AccountSection', () => ({ AccountSection: () => <div>Account section</div> }));
vi.mock('../DataSection', () => ({
  // With what else a link asked for, as the section found it on opening
  DataSection: function DataSection() {
    const { params } = useNavigation();
    const [asked] = useState(params.open);
    return <div>Data section{asked ? `, asked for its ${asked}` : ''}</div>;
  },
}));
vi.mock('../ForecastSection', () => ({ ForecastSection: () => <div>Forecast section</div> }));
vi.mock('../BankAccountsSection', () => ({ BankAccountsSection: () => <div>Bank accounts section</div> }));
vi.mock('../TaskMintSection', () => ({ TaskMintSection: () => <div>TaskMint section</div> }));
vi.mock('../RemindersSection', () => ({ RemindersSection: () => <div>Reminders section</div> }));
vi.mock('../AppearanceSection', () => ({ AppearanceSection: () => <div>Appearance section</div> }));
vi.mock('../PrivacySection', () => ({ PrivacySection: () => <div>Privacy section</div> }));
vi.mock('../AboutSettingsSection', () => ({ AboutSettingsSection: () => <div>About section</div> }));

const SUBTITLE = 'Your account and data, the forecast, bank accounts, TaskMint, reminders and appearance';
const ALL_LABELS = SETTINGS_SECTIONS.map(section => section.label);

const scroll = vi.mocked(Element.prototype.scrollIntoView);

// A shell with everything (Privacy's parts too), unless a test says otherwise
beforeEach(() => {
  setShell(createFakeShell());
  scroll.mockClear();
});

/** Settings in the app's main area, where it scrolls, and a way to open it as a link does. */
function settings(extensions: AppExtensions = {}) {
  let navigation!: ReturnType<typeof useNavigation>;
  function Page() {
    navigation = useNavigation();
    return <SettingsPage />;
  }
  render(
    <NavigationProvider initialView="settings">
      <AppExtensionsContext.Provider value={extensions}>
        <main>
          <Page />
        </main>
      </AppExtensionsContext.Provider>
    </NavigationProvider>
  );
  const main = screen.getByRole('main');
  // jsdom lays nothing out: the area is as tall, and as far scrolled, as a test says
  Object.defineProperties(main, {
    scrollHeight: { value: 2000, configurable: true },
    clientHeight: { value: 500, configurable: true },
    scrollTop: { value: 0, writable: true, configurable: true },
  });
  return {
    main,
    open: (params: NavigationParams) => act(() => navigation.navigate('settings', params)),
    params: () => navigation.params,
  };
}

const list = () => screen.getByRole('navigation', { name: 'Settings sections' });
const noList = () => expect(screen.queryByRole('navigation', { name: 'Settings sections' })).not.toBeInTheDocument();
const labels = () =>
  within(list())
    .getAllByRole('button')
    .map(button => button.textContent);
const item = (name: string) => within(list()).getByRole('button', { name });
const current = () =>
  within(list())
    .getAllByRole('button')
    .find(button => button.getAttribute('aria-current') === 'location')?.textContent;
const anchor = (id: string) => document.getElementById(`settings-${id}`)!;

describe('currentSection', () => {
  it('is the last section whose top has reached the top of the window', () => {
    expect(currentSection([-900, -300, 40, 700], false)).toBe(2);
  });

  it('is the first section before anything has scrolled', () => {
    expect(currentSection([24, 500, 900], false)).toBe(0);
  });

  it('is the last section once the page is scrolled to the bottom', () => {
    expect(currentSection([-900, -300, 200, 450], true)).toBe(3);
  });
});

describe('Settings', () => {
  it('lists every section, and each has its anchor', () => {
    settings();
    expect(labels()).toEqual(ALL_LABELS);
    for (const { id } of SETTINGS_SECTIONS) {
      expect(anchor(id)).toBeInTheDocument();
    }
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument();
  });

  it('starts on the first section, and marks the one clicked in the list as it scrolls there', () => {
    settings();
    expect(item('Account')).toHaveAttribute('aria-current', 'location');

    fireEvent.click(item('Reminders'));

    expect(item('Reminders')).toHaveAttribute('aria-current', 'location');
    expect(item('Account')).not.toHaveAttribute('aria-current');
    expect(scroll).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });
    expect(scroll.mock.contexts.at(-1)).toBe(anchor('reminders'));
  });

  it('leaves out Privacy where the shell has nothing for it to offer', () => {
    setShell(createFakeShell({ without: ['analytics', 'screenPrivacy'] }));
    settings();
    expect(labels()).toEqual(ALL_LABELS.filter(label => label !== 'Privacy'));
    expect(screen.queryByText('Privacy section')).not.toBeInTheDocument();
  });

  it("adds the shell's own sections after the built-in ones, with About last", () => {
    settings({ settingsSections: [{ id: 'updates', label: 'Updates', Section: () => <div>Updates section</div> }] });
    expect(labels()).toEqual([...ALL_LABELS.filter(label => label !== 'About'), 'Updates', 'About']);
    expect(anchor('updates')).toHaveTextContent('Updates section');
  });

  it('opens at the section a link asks for, at once, then forgets the request', () => {
    const { open, params } = settings();
    open({ section: 'forecast' });

    expect(current()).toBe('Forecast');
    expect(scroll).toHaveBeenLastCalledWith({ block: 'start' });
    expect(scroll.mock.contexts.at(-1)).toBe(anchor('forecast'));
    expect(params()).toEqual({});
  });

  it("stays where it is for a section this platform doesn't have", () => {
    setShell(createFakeShell({ without: ['analytics', 'screenPrivacy'] }));
    const { open, params } = settings();
    open({ section: 'privacy' });

    expect(current()).toBe('Account');
    expect(scroll).not.toHaveBeenCalled();
    expect(params()).toEqual({});
  });

  describe('following the scroll', () => {
    const tops: Record<string, number> = { account: -600, data: 40 };
    const place = () => {
      for (const { id } of SETTINGS_SECTIONS) {
        anchor(id).getBoundingClientRect = () => ({ top: tops[id] ?? 900 }) as DOMRect;
      }
    };
    const aMoment = () => new Promise(resolve => setTimeout(resolve, 50));

    it('marks the section reached, and the last one at the bottom', async () => {
      const { main } = settings();
      place();

      fireEvent.scroll(main);
      await waitFor(() => expect(current()).toBe('Your data'));

      main.scrollTop = 1500;
      fireEvent.scroll(main);
      await waitFor(() => expect(current()).toBe('About'));
    });

    it("isn't moved by something else scrolling (a menu's list over the page)", async () => {
      settings();
      place();
      const menu = document.body.appendChild(document.createElement('ul'));

      fireEvent.scroll(menu);
      fireEvent.scroll(window);
      await aMoment();
      expect(current()).toBe('Account');
      menu.remove();
    });

    it('keeps the section clicked while the page scrolls there', async () => {
      const { main } = settings();
      place();
      fireEvent.click(item('Reminders'));

      fireEvent.scroll(main);
      await aMoment();
      expect(current()).toBe('Reminders');
    });
  });

  describe('on a phone', () => {
    it('lists the sections, and opens each on its own screen with a way back', async () => {
      setPhoneViewport();
      const { main } = settings();
      expect(labels()).toEqual(ALL_LABELS);
      expect(screen.queryByText('Account section')).not.toBeInTheDocument();
      // The list names them: no line about them above it
      expect(screen.queryByText(SUBTITLE)).not.toBeInTheDocument();

      // A section opens alone, at its top
      main.scrollTop = 300;
      fireEvent.click(item('Forecast'));
      expect(screen.getByText('Forecast section')).toBeInTheDocument();
      noList();
      expect(screen.queryByText('Account section')).not.toBeInTheDocument();
      expect(main.scrollTop).toBe(0);

      // Its button goes back to the list, at its top too
      main.scrollTop = 300;
      fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
      expect(list()).toBeInTheDocument();
      expect(screen.queryByText('Forecast section')).not.toBeInTheDocument();
      expect(main.scrollTop).toBe(0);

      // And so does Back (the browser's, Android's)
      fireEvent.click(item('About'));
      expect(screen.getByText('About section')).toBeInTheDocument();
      act(() => window.history.back());
      await waitFor(() => expect(list()).toBeInTheDocument());
    });

    it('opens at the section a link asks for, which finds what else was asked of it', () => {
      setPhoneViewport();
      const { open, params } = settings();
      open({ section: 'data', open: 'backup' });
      expect(screen.getByText('Data section, asked for its backup')).toBeInTheDocument();
      noList();
      expect(params()).toEqual({});

      // From another section
      open({ section: 'forecast' });
      expect(screen.getByText('Forecast section')).toBeInTheDocument();
      expect(screen.queryByText(/Data section/)).not.toBeInTheDocument();
      expect(params()).toEqual({});

      // To the one showing
      open({ section: 'forecast' });
      expect(screen.getByText('Forecast section')).toBeInTheDocument();
      expect(params()).toEqual({});
    });

    it("stays on the list for a section this platform doesn't have", () => {
      setPhoneViewport();
      setShell(createFakeShell({ without: ['analytics', 'screenPrivacy'] }));
      const { open, params } = settings();
      open({ section: 'privacy' });

      expect(list()).toBeInTheDocument();
      expect(params()).toEqual({});
    });
  });
});
