import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import * as NavigationMenuPrimitive from '@radix-ui/react-navigation-menu';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { Menu, ChevronDown, LogOut, ArrowRight } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import BrandLogo from '@/components/BrandLogo';
import { LanguageMenu, LanguageOptionsList } from '@/components/LanguageMenu';
import { PRIMARY_NAV, CONNECTORS, type NavEntry } from '@/lib/marketingNav';
import {
  GithubLogo, SlackLogo, VercelLogo, GmailLogo, GoogleCalendarLogo,
} from '@/components/connectors/BrandLogos';

/**
 * Public marketing header.
 *
 * Rebuilt (this PR) from a two-anchor bar into the platform-level information
 * architecture Korvix actually has: Product / Solutions / Resources mega menus
 * plus Company and Pricing. The IA itself lives in `@/lib/marketingNav` so the
 * header, the footer, and the routing tests all read ONE source of truth.
 *
 * Behaviour:
 *  • Desktop menus are Radix `NavigationMenu` (the primitive already vendored in
 *    `components/ui/navigation-menu.tsx`), so hover intent, keyboard operation,
 *    Escape-to-close, click-outside, focus management and ARIA semantics come
 *    from the accessible primitive rather than a hand-rolled popover. The panel
 *    is rendered without the shared viewport so each menu positions under its
 *    own trigger with no width animation and no layout jump.
 *  • Below `lg` the desktop menus are NOT reproduced: the existing Sheet pattern
 *    hosts a nested accordion, which is the correct touch interaction.
 *  • Auth behaviour is unchanged: authenticated visitors keep a reliable route
 *    into the workspace (/chat) plus sign-out in the mobile sheet; logged-out
 *    visitors get Sign in + Get started. No public nav entry points at an
 *    authenticated-only surface.
 *
 * `variant="app"` renders only the brand + language + account controls. That is
 * what the authenticated Settings / Connectors surfaces use, so those pages keep
 * their in-app chrome instead of suddenly sprouting marketing mega menus.
 */

export type NavbarSurface = 'light' | 'dark';

const CONNECTOR_MARK: Record<string, (p: { size?: number }) => React.ReactElement> = {
  github: ({ size = 16 }) => <GithubLogo size={size} />,
  slack: ({ size = 16 }) => <SlackLogo size={size} />,
  vercel: ({ size = 16 }) => <VercelLogo size={size} />,
  gmail: ({ size = 16 }) => <GmailLogo size={size} />,
  calendar: ({ size = 16 }) => <GoogleCalendarLogo size={size} />,
};

/** One mega-menu panel (groups + optional single featured row). */
function MenuPanel({ entry }: { entry: Extract<NavEntry, { kind: 'menu' }> }) {
  const { t } = useLanguageStore();
  const cols = String(entry.groups.length) as '1' | '2' | '3';

  return (
    <div className="mkt-menupanel" style={{ width: entry.size === 'wide' ? 'min(760px, 92vw)' : 'min(340px, 92vw)' }}>
      <div className="mkt-menugrid" data-cols={cols}>
        {entry.groups.map((group) => (
          <div key={group.titleKey}>
            <p className="mkt-menugroup-title">{t(group.titleKey)}</p>
            <ul className="list-none p-0 m-0">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavigationMenuPrimitive.Link asChild>
                    <Link to={item.to} className="mkt-menulink">
                      <span className="t">{t(item.labelKey)}</span>
                      {item.descKey && <span className="d">{t(item.descKey)}</span>}
                    </Link>
                  </NavigationMenuPrimitive.Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {entry.featured && (
        <div className="mkt-menufeatured">
          <div className="fx">
            <div className="ft">{t(entry.featured.titleKey)}</div>
            <div className="fb">{t(entry.featured.bodyKey)}</div>
          </div>
          <div className="mkt-menumarks" aria-hidden="true">
            {CONNECTORS.map((c) => {
              const Mark = CONNECTOR_MARK[c.id];
              return <span key={c.id} title={c.name}>{Mark ? <Mark size={16} /> : null}</span>;
            })}
          </div>
          <NavigationMenuPrimitive.Link asChild>
            <Link to={entry.featured.to} className="mkt-textlink">
              {t(entry.featured.ctaKey)}
              <ArrowRight aria-hidden="true" />
            </Link>
          </NavigationMenuPrimitive.Link>
        </div>
      )}
    </div>
  );
}

function DesktopNav() {
  const { t } = useLanguageStore();
  const location = useLocation();

  return (
    <NavigationMenuPrimitive.Root
      delayDuration={120}
      skipDelayDuration={280}
      className="relative hidden lg:flex"
    >
      <NavigationMenuPrimitive.List className="m-0 flex list-none items-center gap-0.5 p-0">
        {PRIMARY_NAV.map((entry) => {
          if (entry.kind === 'link') {
            const active = location.pathname === entry.to;
            return (
              <NavigationMenuPrimitive.Item key={entry.id}>
                <NavigationMenuPrimitive.Link asChild active={active}>
                  <Link to={entry.to} className="mkt-navitem" aria-current={active ? 'page' : undefined}>
                    {t(entry.labelKey)}
                  </Link>
                </NavigationMenuPrimitive.Link>
              </NavigationMenuPrimitive.Item>
            );
          }
          return (
            <NavigationMenuPrimitive.Item key={entry.id}>
              <NavigationMenuPrimitive.Trigger className="mkt-navitem">
                {t(entry.labelKey)}
                <ChevronDown className="chev" aria-hidden="true" />
              </NavigationMenuPrimitive.Trigger>
              <NavigationMenuPrimitive.Content
                className="absolute left-0 top-full pt-2 data-[motion=from-end]:animate-in data-[motion=from-start]:animate-in data-[motion^=from-]:fade-in data-[motion^=to-]:fade-out data-[motion^=to-]:animate-out"
              >
                <MenuPanel entry={entry} />
              </NavigationMenuPrimitive.Content>
            </NavigationMenuPrimitive.Item>
          );
        })}
      </NavigationMenuPrimitive.List>
    </NavigationMenuPrimitive.Root>
  );
}

function MobileNav({ surface }: { surface: NavbarSurface }) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguageStore();
  const { isAuthenticated, logout } = useAuthStore();
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild className="lg:hidden">
        <button
          type="button"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${
            surface === 'dark'
              ? 'text-slate-200 hover:bg-white/10'
              : 'text-[color:var(--mkt-body)] hover:bg-[rgba(11,16,32,0.05)]'
          }`}
          aria-label={open ? t('menuClose') : t('menuOpen')}
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="mkt w-[min(360px,88vw)] overflow-y-auto bg-white p-0"
      >
        <SheetTitle className="sr-only">{t('menuOpen')}</SheetTitle>
        <div className="border-b border-[color:var(--mkt-border)] px-4 py-3.5">
          <Link to="/" onClick={close} className="mkt-brandlink">
            <BrandLogo wordSize={16} />
          </Link>
        </div>

        <nav className="p-3" aria-label={t('navPrimaryLabel')}>
          <Accordion type="multiple" className="w-full">
            {PRIMARY_NAV.map((entry) =>
              entry.kind === 'link' ? (
                <Link
                  key={entry.id}
                  to={entry.to}
                  onClick={close}
                  className="mkt-mnav-item px-3 py-3"
                >
                  {t(entry.labelKey)}
                </Link>
              ) : (
                <AccordionItem key={entry.id} value={entry.id} className="border-0">
                  <AccordionTrigger className="mkt-mnav-item px-3 py-3 hover:no-underline">
                    {t(entry.labelKey)}
                  </AccordionTrigger>
                  <AccordionContent className="pb-1">
                    {entry.groups.map((group) => (
                      <div key={group.titleKey}>
                        {entry.groups.length > 1 && (
                          <p className="mkt-mnav-group px-3 pb-1 pl-6 pt-2.5">{t(group.titleKey)}</p>
                        )}
                        {group.items.map((item) => (
                          <Link
                            key={item.to}
                            to={item.to}
                            onClick={close}
                            className="mkt-mnav-sub py-2.5 pl-6 pr-3"
                          >
                            {t(item.labelKey)}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              ),
            )}
          </Accordion>

          <hr className="mkt-rule my-3" />
          <LanguageOptionsList onSelect={close} />
          <hr className="mkt-rule my-3" />

          <div className="flex flex-col gap-2 px-1 pb-4">
            {isAuthenticated ? (
              <>
                <Link to="/chat" onClick={close} className="mkt-btn mkt-btn-primary w-full">
                  {t('navOpenWorkspace')}
                </Link>
                <button
                  type="button"
                  onClick={() => { logout(); close(); }}
                  className="mkt-btn mkt-btn-ghost w-full"
                >
                  <LogOut aria-hidden="true" className="h-4 w-4" /> {t('signOut')}
                </button>
              </>
            ) : (
              <>
                <Link to="/signup" onClick={close} className="mkt-btn mkt-btn-primary w-full">
                  {t('ctaGetStarted')}
                </Link>
                <Link to="/login" onClick={close} className="mkt-btn mkt-btn-outline w-full">
                  {t('signIn')}
                </Link>
              </>
            )}
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export default function Navbar({
  surface = 'light',
  variant = 'marketing',
  announcement = null,
}: {
  surface?: NavbarSurface;
  variant?: 'marketing' | 'app';
  /** Optional strip rendered above the nav row, inside the fixed header. */
  announcement?: React.ReactNode;
}) {
  const [scrolled, setScrolled] = useState(false);
  const { isAuthenticated, user } = useAuthStore();
  const { t } = useLanguageStore();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const isDark = surface === 'dark';

  return (
    <header className="mkt mkt-header">
      {announcement}
      <div
        className="mkt-headbar"
        data-scrolled={scrolled ? 'true' : 'false'}
        data-surface={surface}
      >
      <div className="mkt-wrap mkt-headrow">
        <Link to="/" className="mkt-brandlink" aria-label="KorvixAI">
          <BrandLogo tone={isDark ? 'onDark' : 'onLight'} wordSize={17} markSize={28} />
        </Link>

        {variant === 'marketing' && (
          <>
            <div className="ml-3 flex-1">
              <DesktopNav />
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <LanguageMenu surface={surface} />
              {isAuthenticated ? (
                <>
                  <Link to="/chat" className="mkt-btn mkt-btn-primary mkt-btn-sm">
                    {t('navOpenWorkspace')}
                  </Link>
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-full border text-[10px] font-semibold ${
                      isDark
                        ? 'border-white/15 bg-white/10 text-slate-100'
                        : 'border-[color:var(--mkt-border)] bg-[color:var(--mkt-section)] text-[color:var(--mkt-muted)]'
                    }`}
                    title={user?.name || 'You'}
                    aria-hidden="true"
                  >
                    {(user?.name || 'U').slice(0, 2).toUpperCase()}
                  </span>
                </>
              ) : (
                <>
                  <Link to="/login" className="mkt-btn mkt-btn-ghost mkt-btn-sm">
                    {t('signIn')}
                  </Link>
                  <Link to="/signup" className="mkt-btn mkt-btn-primary mkt-btn-sm">
                    {t('ctaGetStarted')}
                  </Link>
                </>
              )}
            </div>

            {/* Compact CTA kept visible on small screens: the primary action
                should not be hidden behind the menu button. */}
            <Link
              to={isAuthenticated ? '/chat' : '/signup'}
              className="mkt-btn mkt-btn-primary mkt-btn-sm ml-auto max-w-[46vw] truncate lg:hidden"
            >
              {isAuthenticated ? t('navOpenWorkspace') : t('ctaGetStarted')}
            </Link>
            <MobileNav surface={surface} />
          </>
        )}

        {variant === 'app' && (
          <div className="ml-auto flex items-center gap-2">
            <LanguageMenu surface={surface} />
            {isAuthenticated ? (
              <Link to="/chat" className="mkt-btn mkt-btn-primary mkt-btn-sm">
                {t('navOpenWorkspace')}
              </Link>
            ) : (
              <Link to="/login" className="mkt-btn mkt-btn-outline mkt-btn-sm">
                {t('signIn')}
              </Link>
            )}
          </div>
        )}
        </div>
      </div>
    </header>
  );
}
