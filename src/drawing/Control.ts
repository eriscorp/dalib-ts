import { ControlType } from '../enums.js';

/** A bounding rect with left/top/right/bottom in pixel coordinates. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * A UI control parsed from a ControlFile (.txt).
 * Controls define the layout of the game's UI panels.
 */
export class Control {
  name: string = '';
  type: ControlType = ControlType.Anchor;
  rect: Rect | undefined;
  returnValue: number | undefined;
  colorIndexes: number[] | undefined;
  /** Ordered list of (imageName, frameIndex) pairs to render for this control. */
  images: Array<{ imageName: string; frameIndex: number }> | undefined;
}
