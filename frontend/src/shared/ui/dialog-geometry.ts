export type DialogRect = { left: number; top: number; width: number; height: number };
export type DialogBounds = DialogRect;

const MIN_WIDTH = 360;
const MIN_HEIGHT = 320;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

export function fitDialogRect(rect: DialogRect, bounds: DialogBounds): DialogRect {
  const width = clamp(rect.width, Math.min(MIN_WIDTH, bounds.width), bounds.width);
  const height = clamp(rect.height, Math.min(MIN_HEIGHT, bounds.height), bounds.height);
  return {
    width, height,
    left: clamp(rect.left, bounds.left, bounds.left + bounds.width - width),
    top: clamp(rect.top, bounds.top, bounds.top + bounds.height - height),
  };
}

export function resizeDialogRect(rect: DialogRect, width: number, height: number, bounds: DialogBounds): DialogRect {
  const current = fitDialogRect(rect, bounds);
  const availableWidth = bounds.left + bounds.width - current.left;
  const availableHeight = bounds.top + bounds.height - current.top;
  return {
    ...current,
    width: clamp(width, Math.min(MIN_WIDTH, availableWidth), availableWidth),
    height: clamp(height, Math.min(MIN_HEIGHT, availableHeight), availableHeight),
  };
}
