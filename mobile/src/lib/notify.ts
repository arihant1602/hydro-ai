// Critical alerts as local phone notifications (no push service, no internet).
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let ready: Promise<boolean> | null = null;

function setup(): Promise<boolean> {
  ready ??= (async () => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === 'android')
      await Notifications.setNotificationChannelAsync('alerts', {
        name: 'Plant alerts',
        importance: Notifications.AndroidImportance.HIGH,
      });
    const { granted } = await Notifications.requestPermissionsAsync();
    return granted;
  })().catch(() => false);
  return ready;
}

export function initNotifications() {
  void setup();
}

export function notifyCritical(message: string) {
  void setup().then((ok) => {
    if (ok)
      void Notifications.scheduleNotificationAsync({
        content: { title: 'Hydro AI', body: message },
        trigger: Platform.OS === 'android' ? { channelId: 'alerts' } : null,
      });
  });
}
