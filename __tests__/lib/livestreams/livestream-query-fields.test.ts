import { describe, expect, it } from 'vitest';
import {
  livestreamQueryFieldsFromDocumentJson,
  livestreamQueryFieldsFromStoredDocument,
} from '@/lib/livestreams/livestream-query-fields';

describe('livestreamQueryFieldsFromStoredDocument', () => {
  it('derives indexed fields from parsed document payload', () => {
    expect(
      livestreamQueryFieldsFromStoredDocument({
        status: 'ended',
        targets: ['youtube'],
        youtubeBroadcastId: ' broadcast-1 ',
        youtubeLifecycleStatus: ' complete ',
      })
    ).toEqual({
      status: 'ended',
      hasYoutubeTarget: true,
      youtubeBroadcastId: 'broadcast-1',
      youtubeLifecycleStatus: 'complete',
    });
  });
});

describe('livestreamQueryFieldsFromDocumentJson', () => {
  it('parses query fields from a stored document JSON string', () => {
    const documentJson = JSON.stringify({
      status: 'failed',
      title: 'Service',
      description: '',
      tags: [],
      visibility: 'public',
      targets: ['youtube'],
      platforms: {},
      youtubeBroadcastId: 'abc123',
    });

    expect(livestreamQueryFieldsFromDocumentJson(documentJson)).toEqual({
      status: 'failed',
      hasYoutubeTarget: true,
      youtubeBroadcastId: 'abc123',
      youtubeLifecycleStatus: '',
    });
  });

  it('defaults invalid or missing status to draft', () => {
    expect(
      livestreamQueryFieldsFromDocumentJson(
        JSON.stringify({
          title: 'Draft row',
          targets: ['facebook'],
        })
      )
    ).toEqual({
      status: 'draft',
      hasYoutubeTarget: false,
      youtubeBroadcastId: '',
      youtubeLifecycleStatus: '',
    });
  });
});
