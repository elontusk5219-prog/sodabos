"use client";
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface DrawerContext {
  open: boolean;
  contextMessage: string | null;
  openDrawer: (context?: string) => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

const AgentDrawerContext = createContext<DrawerContext>({
  open: false,
  contextMessage: null,
  openDrawer: () => {},
  closeDrawer: () => {},
  toggleDrawer: () => {},
});

export function AgentDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [contextMessage, setContextMessage] = useState<string | null>(null);

  const openDrawer = useCallback((context?: string) => {
    if (context) setContextMessage(context);
    setOpen(true);
  }, []);

  const closeDrawer = useCallback(() => {
    setOpen(false);
    setContextMessage(null);
  }, []);

  const toggleDrawer = useCallback(() => {
    setOpen((prev) => {
      if (prev) setContextMessage(null);
      return !prev;
    });
  }, []);

  return (
    <AgentDrawerContext.Provider value={{ open, contextMessage, openDrawer, closeDrawer, toggleDrawer }}>
      {children}
    </AgentDrawerContext.Provider>
  );
}

export function useAgentDrawer() {
  return useContext(AgentDrawerContext);
}
