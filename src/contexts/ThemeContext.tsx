import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  setTheme: () => {},
  resolvedTheme: 'dark',
  toggleTheme: () => {},
});

const STORAGE_KEY = 'korvix-theme';

// Routes that should always be dark (workspace, chat, etc.)
const DARK_ROUTES = [
  '/chat',
  '/workspace',
  '/home',
  '/agents',
  '/agents/builder',
  '/tools',
  '/settings',
  '/credits',
  '/login',
  '/signup',
];

// Check if a route should force dark mode
function isDarkRoute(pathname: string): boolean {
  return DARK_ROUTES.some((route) => pathname === route || pathname.startsWith(route + '/'));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isWorkspace = isDarkRoute(location.pathname);

  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch { /* ignore */ }
    return 'system';
  });

  // Resolve theme: workspace routes are always dark
  const resolvedTheme: 'light' | 'dark' = isWorkspace
    ? 'dark'
    : theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch { /* ignore */ }
  }, []);

  const toggleTheme = useCallback(() => {
    if (isWorkspace) return; // Can't toggle in workspace
    setTheme(theme === 'light' ? 'dark' : 'light');
  }, [isWorkspace, theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
