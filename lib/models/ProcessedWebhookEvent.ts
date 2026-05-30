import mongoose, { Schema } from 'mongoose';

/**
 * Webhook providers currently persisted in `processed_webhook_events`.
 */
export type WebhookProvider = 'stripe';

/**
 * Durable webhook processing state values.
 */
export type WebhookEventStatus =
  | 'processing'
  | 'completed'
  | 'failed'
  | 'completed_with_bookkeeping_error'
  | 'failed_non_retryable';

/**
 * Raw MongoDB document shape for the `processed_webhook_events` collection.
 */
export interface ProcessedWebhookEventDocument {
  _id: string;
  eventId: string;
  provider: WebhookProvider;
  eventType: string;
  status: WebhookEventStatus;
  lastError: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProcessedWebhookEventSchema = new Schema<ProcessedWebhookEventDocument>(
  {
    _id: { type: String },
    eventId: { type: String, required: true, index: true, trim: true },
    provider: { type: String, enum: ['stripe'], required: true },
    eventType: { type: String, required: true },
    status: {
      type: String,
      enum: [
        'processing',
        'completed',
        'failed',
        'completed_with_bookkeeping_error',
        'failed_non_retryable',
      ],
      default: 'processing',
      index: true,
    },
    lastError: { type: String, default: '' },
  },
  { timestamps: true }
);

ProcessedWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export const ProcessedWebhookEventModel =
  (mongoose.models.ProcessedWebhookEvent as
    | mongoose.Model<ProcessedWebhookEventDocument>
    | undefined) ||
  mongoose.model<ProcessedWebhookEventDocument>(
    'ProcessedWebhookEvent',
    ProcessedWebhookEventSchema,
    'processed_webhook_events'
  );
