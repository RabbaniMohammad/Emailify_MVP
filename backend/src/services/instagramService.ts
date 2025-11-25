/**
 * Instagram Messaging Service (Meta Graph API)
 * Minimal, single-file implementation that uses global environment variables
 * for configuration. This intentionally keeps the implementation simple so the
 * rest of the app can call it; later we can extend for multi-tenant tokens.
 */

export interface InstagramMessage {
	recipientId: string; // Instagram user ID (page-scoped)
	message: string;
	mediaUrl?: string;
}

export interface InstagramSendResult {
	success: boolean;
	recipientId: string;
	messageId?: string;
	error?: string;
}

export interface InstagramBatchResult {
	successful: InstagramSendResult[];
	failed: InstagramSendResult[];
	totalSent: number;
	totalFailed: number;
}

export class InstagramService {
	private readonly accessToken: string;
	private readonly pageOrIgUserId: string;
	private readonly apiVersion: string;

	constructor() {
		this.accessToken = process.env.INSTAGRAM_ACCESS_TOKEN || '';
		// Some projects use INSTAGRAM_IG_USER_ID, others INSTAGRAM_PAGE_ID
		this.pageOrIgUserId = process.env.INSTAGRAM_IG_USER_ID || process.env.INSTAGRAM_PAGE_ID || '';
		this.apiVersion = process.env.META_API_VERSION || '17.0';
	}

	isConfigured(): boolean {
		return Boolean(this.accessToken && this.pageOrIgUserId);
	}

	private messagesUrl() {
		return `https://graph.facebook.com/v${this.apiVersion}/${this.pageOrIgUserId}/messages`;
	}

	async sendTextMessage(recipientId: string, text: string): Promise<InstagramSendResult> {
		try {
			if (!this.isConfigured()) throw new Error('Instagram not configured. Set INSTAGRAM_ACCESS_TOKEN and INSTAGRAM_IG_USER_ID/INSTAGRAM_PAGE_ID');

			const payload = { recipient: { id: recipientId }, message: { text } };
			const res = await fetch(this.messagesUrl() + `?access_token=${encodeURIComponent(this.accessToken)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			const data = await res.json();
			if (!res.ok) throw new Error(data?.error?.message || `Instagram API error: ${res.status}`);

			return { success: true, recipientId, messageId: (data && (data.message_id || data.id)) || undefined };
		} catch (err: any) {
			return { success: false, recipientId, error: err?.message || String(err) };
		}
	}

	async sendMediaMessage(recipientId: string, mediaUrl: string, caption?: string): Promise<InstagramSendResult> {
		try {
			if (!this.isConfigured()) throw new Error('Instagram not configured');

			const payload: any = {
				recipient: { id: recipientId },
				message: {
					attachment: { type: 'image', payload: { url: mediaUrl } },
				},
			};
			if (caption) payload.message.text = caption;

			const res = await fetch(this.messagesUrl() + `?access_token=${encodeURIComponent(this.accessToken)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			const data = await res.json();
			if (!res.ok) throw new Error(data?.error?.message || 'Instagram media send failed');

			return { success: true, recipientId, messageId: (data && (data.message_id || data.id)) || undefined };
		} catch (err: any) {
			return { success: false, recipientId, error: err?.message || String(err) };
		}
	}

	async sendBatch(messages: InstagramMessage[]): Promise<InstagramBatchResult> {
		const results = await Promise.allSettled(
			messages.map((m) => (m.mediaUrl ? this.sendMediaMessage(m.recipientId, m.mediaUrl, m.message) : this.sendTextMessage(m.recipientId, m.message)))
		);
		const successful: InstagramSendResult[] = [];
		const failed: InstagramSendResult[] = [];
		results.forEach((r, i) => {
			if (r.status === 'fulfilled' && (r as any).value && (r as any).value.success) successful.push((r as any).value);
			else {
				const msg = messages[i];
				const error = r.status === 'rejected' ? String(r.reason) : (r as any).value?.error;
				failed.push({ success: false, recipientId: msg.recipientId, error });
			}
		});
		return { successful, failed, totalSent: successful.length, totalFailed: failed.length };
	}
}

export const instagramService = new InstagramService();

