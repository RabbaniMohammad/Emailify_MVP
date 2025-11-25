import { Subscriber } from '@src/models/Subscriber';

/**
 * Check whether a subscriber is allowed to receive a message for a given channel
 * @param clientId
 * @param contact - object with possible keys: email, phone, instagram_handle
 * @param channel - 'sms'|'whatsapp'|'instagram'|'email'
 */
export async function isSubscriberAllowed(clientId: string, contact: { email?: string; phone?: string; instagram_handle?: string }, channel: string) {
  if (!clientId) return false;
  const q: any = { clientId };
  if (contact.phone) q.phone = contact.phone;
  if (contact.email) q.email = contact.email;
  if (contact.instagram_handle) q.instagram_handle = contact.instagram_handle;

  const sub = await Subscriber.findOne(q).lean();
  if (!sub) return false;

  switch (channel) {
    case 'sms':
      return Boolean(sub.sms_optin);
    case 'whatsapp':
      return Boolean(sub.whatsapp_optin);
    case 'instagram':
      return Boolean(sub.instagram_optin);
    case 'email':
      return Boolean(sub.email_optin);
    default:
      return false;
  }
}
