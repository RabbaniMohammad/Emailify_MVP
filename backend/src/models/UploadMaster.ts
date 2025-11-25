import mongoose from 'mongoose';

const UploadMasterSchema = new mongoose.Schema({
  clientId: { type: String, required: true, index: true },
  uploadId: { type: String, required: true, unique: true, index: true },
  originalName: { type: String },
  storedPath: { type: String },
  userId: { type: String },
  userName: { type: String },
  organizationName: { type: String },
  rawPreview: { type: mongoose.Schema.Types.Mixed }, // small preview / first N rows
  parsedCount: { type: Number, default: 0 },
  validationSummary: { type: mongoose.Schema.Types.Mixed }, // new/existing/excluded summary
  consentId: { type: mongoose.Schema.Types.ObjectId, ref: 'UploadConsent' },
  parsedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

export const UploadMaster = mongoose.model('UploadMaster', UploadMasterSchema);

export default UploadMaster;
