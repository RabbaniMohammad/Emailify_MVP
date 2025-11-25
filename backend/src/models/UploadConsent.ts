import { Schema, model } from 'mongoose';

const UploadConsentSchema = new Schema(
  {
    clientId: { type: String, required: true, index: true },
    uploadId: { type: String, required: true, index: true },
    sms_optin: { type: Boolean, default: false },
    whatsapp_optin: { type: Boolean, default: false },
    instagram_optin: { type: Boolean, default: false },
    email_optin: { type: Boolean, default: false },
    proof_file_url: { type: String },
    proof_page_url: { type: String },
    description: { type: String },
    ip_address: { type: String },
    timestamp: { type: Date, default: Date.now },
    userId: { type: String },
    userName: { type: String },
    organizationName: { type: String },
    raw_csv_preview: { type: String }, // small preview or hash if desired
  },
  { timestamps: true },
);

export const UploadConsent = model('UploadConsent', UploadConsentSchema);
