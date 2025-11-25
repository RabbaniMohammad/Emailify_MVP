import { Schema, model } from 'mongoose';

const SubscriberSchema = new Schema(
  {
    clientId: { type: String, required: true, index: true },
    name: { type: String },
    email: { type: String, index: true, sparse: true },
    phone: { type: String, index: true, sparse: true },
    instagram_handle: { type: String, index: true, sparse: true },
    sms_optin: { type: Boolean, default: false },
    whatsapp_optin: { type: Boolean, default: false },
    instagram_optin: { type: Boolean, default: false },
    email_optin: { type: Boolean, default: false },
    verified: {
      sms: { type: Boolean, default: false },
      email: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
    },
    optin_source: { type: String },
    optin_ip: { type: String },
    optin_timestamp: { type: Date, default: Date.now },
    raw_payload: Schema.Types.Mixed,
  },
  { timestamps: true },
);

export const Subscriber = model('Subscriber', SubscriberSchema);
