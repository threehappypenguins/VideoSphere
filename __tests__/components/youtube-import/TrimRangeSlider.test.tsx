import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState, type ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  TrimRangeSlider,
  applyTrimHandleSeconds,
  nudgeTrimHandleValue,
  pickClosestKeyframe,
} from '@/components/youtube-import/TrimRangeSlider';

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
      enableKeyframeSnap={props.enableKeyframeSnap}
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

  it('returns the raw value when the closest candidate is too far away', () => {
    expect(pickClosestKeyframe(4683, [2829, 2833])).toBe(4683);
  });
});

describe('nudgeTrimHandleValue', () => {
  it('moves the start handle earlier and later without crossing the end handle', () => {
    const value = { startSeconds: 10, endSeconds: 100 };
    expect(nudgeTrimHandleValue(value, 'start', 1, 300)).toEqual({
      startSeconds: 10 + 1 / 30,
      endSeconds: 100,
    });
    expect(nudgeTrimHandleValue(value, 'start', -1, 300)).toEqual({
      startSeconds: 10 - 1 / 30,
      endSeconds: 100,
    });
  });

  it('returns null when a handle cannot move further', () => {
    expect(nudgeTrimHandleValue({ startSeconds: 0, endSeconds: 100 }, 'start', -1, 300)).toBeNull();
    expect(nudgeTrimHandleValue({ startSeconds: 10, endSeconds: 300 }, 'end', 1, 300)).toBeNull();
  });
});

describe('applyTrimHandleSeconds', () => {
  it('clamps the start handle within the trim range', () => {
    expect(
      applyTrimHandleSeconds({ startSeconds: 10, endSeconds: 100 }, 'start', 150, 300)
    ).toEqual({
      startSeconds: 100,
      endSeconds: 100,
    });
  });

  it('clamps the end handle within the trim range', () => {
    expect(applyTrimHandleSeconds({ startSeconds: 10, endSeconds: 100 }, 'end', 5, 300)).toEqual({
      startSeconds: 10,
      endSeconds: 10,
    });
  });
});

describe('TrimRangeSlider', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { keyframeSeconds: [] } }), { status: 200 })
        )
    );
    Object.defineProperty(Element.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(Element.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => {},
    });
    Object.defineProperty(Element.prototype, 'releasePointerCapture', {
      configurable: true,
      value: () => {},
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests keyframes when the slider handle is released via keyboard and snapping is enabled', async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { keyframeSeconds: [12] } }), { status: 200 })
    );
    renderSlider({ onChange });

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });
    fireEvent.keyUp(startThumb);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [url] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/api/youtube-import/keyframes');
    expect(onChange).toHaveBeenCalled();
  });

  it('does not request keyframes when the slider handle is released and snapping is disabled', async () => {
    const onChange = vi.fn();
    renderSlider({ onChange, enableKeyframeSnap: false });

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });
    fireEvent.keyUp(startThumb);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('requests keyframes when a frame nudge button is clicked', async () => {
    const onChange = vi.fn();
    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { keyframeSeconds: [12] } }), { status: 200 })
    );
    renderSlider({ onChange });

    fireEvent.click(screen.getByTestId('trim-start-frame-later'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [url] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(String(url)).toContain('/api/youtube-import/keyframes');
    expect(String(url)).toContain(`youtubeVideoId=${VIDEO_ID}`);
  });

  it('does not request keyframes when snapping is disabled', async () => {
    const onChange = vi.fn();
    renderSlider({ onChange, enableKeyframeSnap: false });

    fireEvent.click(screen.getByTestId('trim-start-frame-later'));

    expect(global.fetch).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('snaps the moved handle to the closest returned keyframe after a frame nudge', async () => {
    const onChange = vi.fn();
    renderSlider({ onChange, value: { startSeconds: 10, endSeconds: 100 } });

    vi.mocked(global.fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { keyframeSeconds: [5, 12, 20] } }), { status: 200 })
    );

    fireEvent.click(screen.getByTestId('trim-start-frame-later'));

    await waitFor(() => {
      const lastCall = onChange.mock.calls.at(-1)?.[0];
      expect(lastCall?.startSeconds).toBe(12);
    });
  });

  it('nudges the start handle by the selected jump amount', () => {
    const onChange = vi.fn();
    renderSlider({ onChange, enableKeyframeSnap: false });

    fireEvent.click(screen.getByTestId('trim-start-jump-later'));

    expect(onChange).toHaveBeenCalledWith({
      startSeconds: 15,
      endSeconds: 100,
    });
  });

  it('uses the selected jump step amount', () => {
    const onChange = vi.fn();
    renderSlider({ onChange, enableKeyframeSnap: false });

    fireEvent.click(screen.getByTestId('trim-jump-step-10'));
    fireEvent.click(screen.getByTestId('trim-start-jump-later'));

    expect(onChange).toHaveBeenCalledWith({
      startSeconds: 20,
      endSeconds: 100,
    });
  });

  it('nudges the start handle from on-screen frame buttons', () => {
    const onChange = vi.fn();
    renderSlider({ onChange, enableKeyframeSnap: false });

    fireEvent.click(screen.getByTestId('trim-start-frame-later'));

    expect(onChange).toHaveBeenCalledWith({
      startSeconds: 10 + 1 / 30,
      endSeconds: 100,
    });
  });

  it('commits a typed start timestamp', async () => {
    const onChange = vi.fn();
    renderSlider({
      onChange,
      enableKeyframeSnap: false,
      value: { startSeconds: 10, endSeconds: 100 },
    });

    fireEvent.click(screen.getByTestId('trim-start-time-display'));
    const input = screen.getByTestId('trim-start-time-input');
    fireEvent.change(input, { target: { value: '1:30' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith({
      startSeconds: 90,
      endSeconds: 100,
    });
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

    await vi.advanceTimersByTimeAsync(100);

    expect(playerHandle.previewAt).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('seeks immediately when the slider handle is released', async () => {
    const playerHandle = {
      previewAt: vi.fn(),
      getCurrentTime: vi.fn().mockReturnValue(0),
    };

    renderSlider({ playerHandle, value: { startSeconds: 10, endSeconds: 100 } });

    const [startThumb] = screen.getAllByRole('slider');
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });
    fireEvent.keyUp(startThumb);

    expect(playerHandle.previewAt).toHaveBeenCalled();
  });

  it('shows a loading indicator on the handle being snapped', async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(global.fetch).mockReturnValueOnce(fetchPromise);

    renderSlider({ value: { startSeconds: 10, endSeconds: 100 } });

    fireEvent.click(screen.getByTestId('trim-start-frame-later'));

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
