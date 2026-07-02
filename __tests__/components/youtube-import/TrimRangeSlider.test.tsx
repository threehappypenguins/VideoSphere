import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TrimRangeSlider, pickClosestKeyframe } from '@/components/youtube-import/TrimRangeSlider';

const VIDEO_ID = 'dQw4w9WgXcQ';

function TrimRangeSliderHarness(
  props: Omit<ComponentProps<typeof TrimRangeSlider>, 'value' | 'onChange'> & {
    initialValue: { startSeconds: number; endSeconds: number };
    onChange?: (value: { startSeconds: number; endSeconds: number }) => void;
  }
) {
  const { initialValue, onChange, ...rest } = props;
  const [value, setValue] = useState(initialValue);

  return (
    <TrimRangeSlider
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function renderSlider(
  props: Partial<ComponentProps<typeof TrimRangeSlider>> & {
    onChange?: (value: { startSeconds: number; endSeconds: number }) => void;
  } = {}
) {
  const onChange = props.onChange ?? vi.fn();
  const initialValue = props.value ?? { startSeconds: 10, endSeconds: 100 };
  const view = render(
    <TrimRangeSliderHarness
      durationSeconds={props.durationSeconds ?? 300}
      youtubeVideoId={props.youtubeVideoId ?? VIDEO_ID}
      initialValue={initialValue}
      onChange={onChange}
      playerHandle={props.playerHandle}
    />
  );
  return { onChange, ...view };
}

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('pickClosestKeyframe', () => {
  it('returns the closest candidate timestamp', () => {
    expect(pickClosestKeyframe(11, [5, 12, 20])).toBe(12);
    expect(pickClosestKeyframe(19, [5, 12, 20])).toBe(20);
  });

  it('returns the raw value when no candidates are returned', () => {
    expect(pickClosestKeyframe(42.5, [])).toBe(42.5);
  });
});

describe('TrimRangeSlider', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('fetch', vi.fn());
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not request keyframes until the handle stops moving', async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { keyframeSeconds: [12] } }), { status: 200 })
    );
    renderSlider({ onChange });

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('debounces rapid handle moves into a single keyframe request', async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { keyframeSeconds: [12] } }), { status: 200 })
    );
    renderSlider({ onChange });

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    expect(global.fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [url] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/api/youtube-import/keyframes');
    expect(String(url)).toContain(`youtubeVideoId=${VIDEO_ID}`);
  });

  it('snaps the moved handle to the closest returned keyframe', async () => {
    const onChange = vi.fn();
    renderSlider({ onChange, value: { startSeconds: 10, endSeconds: 100 } });

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { keyframeSeconds: [5, 12, 20] } }), { status: 200 })
    );

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    await vi.advanceTimersByTimeAsync(250);

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0];
      expect(lastCall?.startSeconds).toBe(12);
    });
  });

  it('leaves the handle at the raw dragged value when keyframes are empty', async () => {
    const onChange = vi.fn();
    renderSlider({ onChange, value: { startSeconds: 10, endSeconds: 100 } });

    vi.mocked(global.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { keyframeSeconds: [] } }), { status: 200 })
    );

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    const rawValue = onChange.mock.calls.at(-1)?.[0];
    expect(rawValue).toBeDefined();

    await vi.advanceTimersByTimeAsync(250);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const finalValue = onChange.mock.calls.at(-1)?.[0];
    expect(finalValue?.startSeconds).toBe(rawValue?.startSeconds);
    expect(screen.queryByTestId('trim-start-loading')).not.toBeInTheDocument();
  });

  it('seeks the preview player while dragging when a player handle is provided', async () => {
    const playerHandle = {
      previewAt: vi.fn(),
      getCurrentTime: vi.fn().mockReturnValue(0),
    };
    const onChange = vi.fn();

    renderSlider({ onChange, playerHandle });

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    await vi.advanceTimersByTimeAsync(200);

    expect(playerHandle.previewAt).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('shows a loading indicator on the handle being snapped', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(global.fetch).mockReturnValueOnce(fetchPromise);

    renderSlider({ value: { startSeconds: 10, endSeconds: 100 } });

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    await vi.advanceTimersByTimeAsync(250);

    await waitFor(() => {
      expect(screen.getByTestId('trim-start-loading')).toBeInTheDocument();
    });

    resolveFetch(
      new Response(JSON.stringify({ data: { keyframeSeconds: [12] } }), { status: 200 })
    );

    await waitFor(() => {
      expect(screen.queryByTestId('trim-start-loading')).not.toBeInTheDocument();
    });
  });
});
