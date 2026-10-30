// jsdom cannot measure text, so the measuring APIs Mermaid calls are faked. Every layout
// value is meaningless: tests that use this check structure and acceptance, never looks.
const FAKE_CHARACTER_WIDTH = 8;
const FAKE_LINE_HEIGHT = 16;

export function installFakeSvgMeasurement(): void {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  proto.getBBox = function (this: SVGElement) {
    return {
      x: 0,
      y: 0,
      width: (this.textContent ?? "").length * FAKE_CHARACTER_WIDTH,
      height: FAKE_LINE_HEIGHT,
    };
  };
  proto.getComputedTextLength = function (this: SVGElement) {
    return (this.textContent ?? "").length * FAKE_CHARACTER_WIDTH;
  };
  proto.getTotalLength = () => FAKE_LINE_HEIGHT;
  proto.getPointAtLength = () => ({ x: 0, y: 0 });
}
