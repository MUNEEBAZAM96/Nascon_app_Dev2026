import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { clearToken, decodeToken, getToken, setToken, type TokenClaims } from './token';

interface SessionValue {
  isLoaded: boolean;
  token: string | null;
  claims: TokenClaims | null;
  signIn: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [token, setTokenState] = useState<string | null>(null);

  useEffect(() => {
    getToken()
      .then(setTokenState)
      .finally(() => setIsLoaded(true));
  }, []);

  const signIn = useCallback(async (next: string) => {
    await setToken(next);
    setTokenState(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setTokenState(null);
  }, []);

  const value = useMemo(
    () => ({ isLoaded, token, claims: decodeToken(token), signIn, signOut }),
    [isLoaded, token, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
