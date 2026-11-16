// Adapted from TaskMint packages/client/src/components/pages/SettingsPage.tsx @ 94318ec: BudgetMint's sections, Back through the window's history, and the list beside them from a wider window.
/**
 * Settings: one scrolling page of sections, with a list of them alongside
 * that jumps to each and follows where you are. Opening Settings for a
 * section (the account menu's "Account settings") shows it. The shell's own
 * sections (the desktop's Updates) follow the built-in ones, and About
 * comes last.
 *
 * A phone, with no room beside the sections, lists them instead, and each
 * opens on its own screen with a way back to the list (Back too).
 */

import { type ComponentType, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, List, ListItemButton, ListItemText, Paper } from '@mui/material';
import { ArrowBack as BackIcon, ChevronRight } from '@mui/icons-material';
import { useAppExtensions } from '../../../app/extensions';
import { useBackDismiss, useNavigation } from '../../../contexts/NavigationContext';
import { useCompactLayout } from '../../../hooks/useCompactLayout';
import { availableSettingsSections, SETTINGS_SECTION_LABELS, type SettingsSectionId } from '../../../navigation/views';
import { getShell } from '../../../shell';
import { PageContainer, PageHeader } from '../../layout/PageLayout';
import { AboutSettingsSection } from './AboutSettingsSection';
import { AccountSection } from './AccountSection';
import { AppearanceSection } from './AppearanceSection';
import { BankAccountsSection } from './BankAccountsSection';
import { DataSection } from './DataSection';
import { ForecastSection } from './ForecastSection';
import { PrivacySection } from './PrivacySection';
import { RemindersSection } from './RemindersSection';
import { TaskMintSection } from './TaskMintSection';

const SECTION_COMPONENTS: Record<SettingsSectionId, ComponentType> = {
  account: AccountSection,
  data: DataSection,
  forecast: ForecastSection,
  accounts: BankAccountsSection,
  taskmint: TaskMintSection,
  reminders: RemindersSection,
  appearance: AppearanceSection,
  privacy: PrivacySection,
  about: AboutSettingsSection,
};

export const SETTINGS_SECTIONS = (Object.keys(SETTINGS_SECTION_LABELS) as SettingsSectionId[]).map(id => ({
  id,
  label: SETTINGS_SECTION_LABELS[id],
  Section: SECTION_COMPONENTS[id],
}));

const sectionElement = (id: string) => document.getElementById(`settings-${id}`);

/** Where the page scrolls: the app's main area, which holds a phone's top bar too. */
const scrollerOf = (inside: HTMLElement) => inside.closest('main')!;

/** A section is "current" once its top is this close to the top of the window. */
const CURRENT_LINE_PX = 120;
/** After a click in the list, scrolling there doesn't move the highlight. */
const CLICK_HOLD_MS = 1000;

/** A link shows its section at once: the page has only just opened, at its top. */
const JUMP: ScrollIntoViewOptions = { block: 'start' };
/** A click in the list scrolls there, past the sections between. */
const GLIDE: ScrollIntoViewOptions = { behavior: 'smooth', block: 'start' };

/** The section you're reading: the last one whose top has reached the line (the last one at the bottom). */
export function currentSection(tops: number[], atBottom: boolean): number {
  if (atBottom) return tops.length - 1;
  let current = 0;
  tops.forEach((top, index) => {
    if (top <= CURRENT_LINE_PX) current = index;
  });
  return current;
}

const NO_EXTENSION_SECTIONS: never[] = [];

interface ListedSection {
  id: string;
  label: string;
  Section: ComponentType;
}

/** This platform's sections, in Settings' order: the built-in ones, the shell's, then About. */
function useSections(): ListedSection[] {
  const { settingsSections = NO_EXTENSION_SECTIONS } = useAppExtensions();
  return useMemo(() => {
    const available = availableSettingsSections(getShell().platform);
    const builtIn = SETTINGS_SECTIONS.filter(({ id }) => available.includes(id));
    return [
      ...builtIn.filter(({ id }) => id !== 'about'),
      ...settingsSections,
      ...builtIn.filter(({ id }) => id === 'about'),
    ];
  }, [settingsSections]);
}

const SUBTITLE = 'Your account and data, the forecast, bank accounts, TaskMint, reminders and appearance';

/** A phone's Settings: the list of sections, or the one picked from it. */
function PhoneSettings({ sections }: { sections: ListedSection[] }) {
  const [open, setOpen] = useState<ListedSection | null>(null);
  const top = useRef<HTMLDivElement>(null);

  // Opened for a section: show it (a link may name one this platform doesn't have). What else
  // the link asks for (Your data's backup) is the section's to read, so the request is
  // forgotten only once the section is showing: its effects run before this one
  const { params, clearParams } = useNavigation();
  const linked = params.section;
  useEffect(() => {
    if (!linked) return;
    const section = sections.find(({ id }) => id === linked);
    if (section && section.id !== open?.id) {
      setOpen(section);
      return;
    }
    clearParams();
  }, [linked, open, sections, clearParams]);

  // Back to the list, with Back too
  const close = () => setOpen(null);
  useBackDismiss(open !== null, close);

  // Each screen starts at its top (under the top bar, which scrolls with the page's area)
  useLayoutEffect(() => {
    scrollerOf(top.current!).scrollTop = 0;
  }, [open]);

  return (
    <PageContainer>
      <div ref={top} />
      {/* The list below names the sections: no line about them */}
      <PageHeader title="Settings" />
      {open ? (
        <>
          <Button startIcon={<BackIcon />} onClick={close} sx={{ mb: 1, ml: -1 }}>
            Settings
          </Button>
          <open.Section />
        </>
      ) : (
        <Paper component="nav" aria-label="Settings sections">
          <List disablePadding>
            {sections.map((section, index) => (
              <ListItemButton
                key={section.id}
                divider={index < sections.length - 1}
                onClick={() => setOpen(section)}
                sx={{ minHeight: 56 }}
              >
                <ListItemText primary={section.label} slotProps={{ primary: { sx: { fontWeight: 500 } } }} />
                <ChevronRight sx={{ color: 'text.secondary' }} />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
    </PageContainer>
  );
}

export function SettingsPage() {
  const sections = useSections();
  const compact = useCompactLayout();
  return compact ? <PhoneSettings sections={sections} /> : <WideSettings sections={sections} />;
}

/** Settings beside a list of its sections, on one scrolling page. */
function WideSettings({ sections }: { sections: ListedSection[] }) {
  const [active, setActive] = useState(sections[0].id);
  const clickedAtRef = useRef(0);
  const row = useRef<HTMLDivElement>(null);

  const goTo = useCallback((id: string, how: ScrollIntoViewOptions) => {
    clickedAtRef.current = Date.now();
    setActive(id);
    // (Every listed section is rendered below, with its anchor)
    sectionElement(id)!.scrollIntoView(how);
  }, []);

  // Opened for a section: show it (a link may name one this platform doesn't have). Every
  // section is on the page, so what else the link asks for (Your data's backup) is read by now
  const { params, clearParams } = useNavigation();
  const linked = params.section;
  useEffect(() => {
    if (!linked) return;
    if (sections.some(({ id }) => id === linked)) goTo(linked, JUMP);
    clearParams();
  }, [linked, sections, clearParams, goTo]);

  // The list follows the section you're reading. The page scrolls inside the app's main
  // area: only its scrolls count, not a menu's or a dialog's over the page
  useEffect(() => {
    const scroller = scrollerOf(row.current!);
    let frame = 0;
    const onScroll = () => {
      if (Date.now() - clickedAtRef.current < CLICK_HOLD_MS) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const tops = sections.map(({ id }) => sectionElement(id)!.getBoundingClientRect().top);
        const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
        setActive(sections[currentSection(tops, atBottom)].id);
      });
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [sections]);

  return (
    <PageContainer>
      <PageHeader title="Settings" subtitle={SUBTITLE} />
      <Box ref={row} sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
        {/* From `lg`, not TaskMint's `md`: beside the list at 900px, Bank accounts' rows had no room for the names */}
        <Box
          component="nav"
          aria-label="Settings sections"
          sx={{ display: { xs: 'none', lg: 'block' }, width: 200, flexShrink: 0, position: 'sticky', top: 24 }}
        >
          <List dense disablePadding>
            {sections.map(({ id, label }) => (
              <ListItemButton
                key={id}
                selected={active === id}
                aria-current={active === id ? 'location' : undefined}
                onClick={() => goTo(id, GLIDE)}
                sx={{ borderRadius: 1, minHeight: 36 }}
              >
                <ListItemText primary={label} />
              </ListItemButton>
            ))}
          </List>
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {sections.map(({ id, Section }) => (
            <Box key={id} id={`settings-${id}`} sx={{ scrollMarginTop: 24 }}>
              <Section />
            </Box>
          ))}
        </Box>
      </Box>
    </PageContainer>
  );
}
