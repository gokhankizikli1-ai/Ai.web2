import { useState, useEffect } from 'react';

const STORAGE_KEY = 'korvixai_onboarding_dismissed';

export function useOnboarding() {
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      // Show onboarding after a brief delay so the UI loads first
      const timer = setTimeout(() => setShowOnboarding(true), 300);
      return () => clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setShowOnboarding(false);
  };

  return { showOnboarding, dismiss };
}
