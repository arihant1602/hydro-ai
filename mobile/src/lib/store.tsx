// App-wide state: runs the control loop against the ESP32 while the app is open and exposes the latest status.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { bindToWifi, localAddresses, unbindWifi } from '../../modules/wifi-bind/src/WifiBindModule';
import { getSettings } from './db';
import { cycle, status, type LinkState, type Status } from './hydro';
import { initNotifications } from './notify';
import { speech } from './speech';

interface Ctx {
  status: Status | null;
  link: LinkState;
  /** Re-read status from the database (after a settings change, photo, observation...). */
  refresh: () => Promise<void>;
  /** Run a control cycle now instead of waiting for the next tick. */
  pollNow: () => Promise<void>;
  /** Pause automatic control (the demo's relay test drives the board by hand). Resolves once no cycle is
   *  in flight, so a cycle can't overwrite the first manual command; turning it off runs a cycle at once. */
  setManual: (on: boolean) => Promise<void>;
}

const INITIAL_LINK: LinkState = { online: false, host: null, lastSeen: null, error: null, report: null, rttMs: null };
const HydroContext = createContext<Ctx | null>(null);

export function HydroProvider({ children }: { children: ReactNode }) {
  const [st, setStatus] = useState<Status | null>(null);
  const [link, setLink] = useState<LinkState>(INITIAL_LINK);
  const linkRef = useRef(link);
  const busy = useRef(false);
  const failures = useRef(0);
  const bound = useRef(false);
  const manual = useRef(false);

  const refresh = useCallback(async () => setStatus(await status()), []);

  const pollNow = useCallback(async () => {
    if (busy.current || manual.current) return;
    busy.current = true;
    try {
      // On the board's own WiFi (no internet) Android may send our traffic over mobile data, which binding the
      // app to WiFi fixes; but binding breaks reaching the board through this phone's hotspot, and on a WiFi
      // with a login page it gets hijacked. So bind only while the phone has a 192.168.4.x address (it has
      // joined the board's network). Only when the phone's addresses are unknown (older app build), guess:
      // if a cycle fails, try the other way once.
      const setBound = async (on: boolean) => {
        if (on === bound.current) return;
        bound.current = on;
        if (on) await bindToWifi();
        else await unbindWifi();
      };
      const addrs = await localAddresses();
      if (addrs.length) await setBound(addrs.some((a) => !a.tether && a.address.startsWith('192.168.4.')));
      let next = await cycle(linkRef.current);
      if (!next.online && !addrs.length) {
        await setBound(!bound.current);
        next = await cycle(linkRef.current);
      }
      failures.current = next.online ? 0 : failures.current + 1;
      linkRef.current = next;
      setLink(next);
      setStatus(await status());
    } catch (e) {
      console.warn('control cycle failed', e);
    } finally {
      busy.current = false;
    }
  }, []);

  const setManual = useCallback(
    async (on: boolean) => {
      manual.current = on;
      if (!on) return pollNow();
      while (busy.current) await new Promise((r) => setTimeout(r, 100));
    },
    [pollNow],
  );

  useEffect(() => {
    initNotifications();
    speech.warmUp(); // start the text-to-speech engine now, so the first "Listen" doesn't wait for it
    // Show what's stored on the phone straight away. The first network cycle can take 15 s or more when the
    // board isn't reachable (timeouts, WiFi bind), and the screens must not wait on it.
    void status().then(setStatus, (e) => console.warn('status load failed', e));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;
    const loop = async () => {
      if (!active) return;
      await pollNow();
      const s = await getSettings();
      timer = setTimeout(loop, Math.max(3, s.poll_s) * 1000);
    };
    void loop();
    // JS timers pause in the background; poll immediately on return so the backlog is pulled in.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pollNow();
    });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [pollNow]);

  return <HydroContext.Provider value={{ status: st, link, refresh, pollNow, setManual }}>{children}</HydroContext.Provider>;
}

export function useHydro(): Ctx {
  const c = useContext(HydroContext);
  if (!c) throw new Error('useHydro outside HydroProvider');
  return c;
}
