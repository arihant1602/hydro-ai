import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface LocalAddress {
  iface: string;
  address: string;
  prefix: number;
  /** The phone's own hotspot / USB tethering rather than a network it has joined. */
  tether: boolean;
}

declare class WifiBindModule extends NativeModule<{}> {
  bindToWifi(): Promise<boolean>;
  unbind(): Promise<void>;
  localAddresses(): Promise<LocalAddress[]>;
}

// Android only; elsewhere (iOS, Expo Go) local-subnet traffic already goes over WiFi, so this is a no-op.
const native = Platform.OS === 'android' ? requireOptionalNativeModule<WifiBindModule>('WifiBind') : null;

export async function bindToWifi(): Promise<boolean> {
  return native ? native.bindToWifi() : true;
}

export async function unbindWifi(): Promise<void> {
  await native?.unbind();
}

/** Empty where unknown (iOS, Expo Go, an app build from before this function existed). */
export async function localAddresses(): Promise<LocalAddress[]> {
  try {
    return (await native?.localAddresses?.()) ?? [];
  } catch {
    return [];
  }
}
