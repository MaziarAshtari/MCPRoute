import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

/** Read by the inline script in index.html, which applies the theme before the first paint. */
export const THEME_STORAGE_KEY = 'mcproute-theme';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const ThemeContext = createContext<ThemeContextValue | null>(null);

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Switches the `dark` class without animating every color transition on the page. */
function applyTheme(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(style);
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  window.getComputedStyle(document.body).getPropertyValue('opacity');
  setTimeout(() => style.remove(), 1);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(storedTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => applyTheme(resolvedTheme), [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable (private mode); the choice then lasts for this page view.
    }
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>');
  return context;
}
