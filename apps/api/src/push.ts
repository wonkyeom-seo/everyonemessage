import webPush from "web-push";
import type { AppConfig } from "./config";
import type { Db } from "./db";
import { queryMany } from "./db";

export async function sendWebPush(
  db: Db,
  config: AppConfig,
  userId: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY) {
    return;
  }

  webPush.setVapidDetails(config.VAPID_SUBJECT, config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY);
  const subscriptions = await queryMany<{ endpoint: string; p256dh: string; auth: string }>(
    db,
    "SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
    [userId]
  );

  await Promise.allSettled(
    subscriptions.map((subscription) =>
      webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        },
        JSON.stringify(payload)
      )
    )
  );
}
