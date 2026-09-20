import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { UiImageView } from '@tr-file/ui';

/**
 * PRD 001, §7.3.1 — the image viewer: contain by default, five icon controls,
 * wheel zoom, drag to pan, double click back to contain.
 *
 * jsdom lays nothing out and decodes nothing, so the viewport's size and the
 * image's natural size are both supplied here. That is exactly the pair the
 * component computes every fit from, so the arithmetic under test is real.
 */

/**
 * A square image in a landscape viewport, so `contain` and `cover` differ:
 * 400/1000 fits it whole, 800/1000 fills the frame and crops the height.
 */
const NATURAL = { width: 1000, height: 1000 };
const VIEWPORT = { width: 800, height: 400 };

describe('UiImageView', () => {
  let fixture: ComponentFixture<UiImageView>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiImageView] }).compileComponents();
    fixture = TestBed.createComponent(UiImageView);
    fixture.componentRef.setInput('src', 'blob:fake/1');
    fixture.componentRef.setInput('label', 'photos/beach.jpg');
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();

    host = fixture.nativeElement;
    size(viewport(), VIEWPORT);
    loadImage(NATURAL);
  });

  afterEach(() => fixture.nativeElement.remove());

  const viewport = (): HTMLElement => host.querySelector('.viewport') as HTMLElement;
  const image = (): HTMLImageElement => host.querySelector('.image') as HTMLImageElement;
  const buttons = (): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll('.controls button'));
  const button = (label: string): HTMLButtonElement =>
    buttons().find((candidate) => candidate.getAttribute('aria-label') === label) as HTMLButtonElement;
  const zoomLabel = (): string => (host.querySelector('.zoom-label') as HTMLElement).textContent ?? '';

  /** jsdom reports 0 for every box, so the measured size is defined here. */
  function size(element: HTMLElement, box: { width: number; height: number }): void {
    Object.defineProperty(element, 'clientWidth', { value: box.width, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: box.height, configurable: true });
    element.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: box.width, height: box.height, right: box.width, bottom: box.height }) as DOMRect;
  }

  /** Reports the image as decoded at `box`, the way a real `load` would. */
  function loadImage(box: { width: number; height: number }): void {
    Object.defineProperty(image(), 'naturalWidth', { value: box.width, configurable: true });
    Object.defineProperty(image(), 'naturalHeight', { value: box.height, configurable: true });
    image().dispatchEvent(new Event('load'));
    fixture.detectChanges();
  }

  /** The `scale(n)` out of the image's transform. */
  const scale = (): number => {
    const match = /scale\(([-\d.]+)\)/.exec(image().style.transform);
    return match ? Number(match[1]) : Number.NaN;
  };

  /** The `translate(x, y)` out of the image's transform. */
  const translate = (): { x: number; y: number } => {
    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(image().style.transform);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: Number.NaN, y: Number.NaN };
  };

  const wheel = (deltaY: number, at = { x: 400, y: 200 }): void => {
    viewport().dispatchEvent(
      new WheelEvent('wheel', { deltaY, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  };

  const drag = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const options = { pointerId: 3, button: 0, bubbles: true, cancelable: true };
    viewport().dispatchEvent(new PointerEvent('pointerdown', { ...options, clientX: from.x, clientY: from.y }));
    viewport().dispatchEvent(new PointerEvent('pointermove', { ...options, clientX: to.x, clientY: to.y }));
    viewport().dispatchEvent(new PointerEvent('pointerup', { ...options, clientX: to.x, clientY: to.y }));
    fixture.detectChanges();
  };

  describe('the default', () => {
    /** 1000x1000 inside 800x400 fits on the short axis: 400/1000. */
    it('is contain', () => {
      expect(scale()).toBeCloseTo(0.4, 5);
      expect(button('Fit whole image').getAttribute('aria-pressed')).toBe('true');
      expect(zoomLabel()).toBe('40%');
    });

    it('names the image for a screen reader', () => {
      expect(viewport().getAttribute('aria-label')).toBe('photos/beach.jpg');
      expect(viewport().getAttribute('role')).toBe('img');
    });
  });

  describe('the controls', () => {
    /** The PRD asks for icons, not text: every one is icon-only and labelled. */
    it('are five icon buttons, each with an accessible name', () => {
      expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
        'Zoom out',
        'Zoom in',
        'Actual size (100%)',
        'Fit whole image',
        'Fill the frame',
      ]);
      expect(buttons().every((b) => b.textContent?.trim() === '')).toBe(true);
    });

    it('fill the frame on cover, which crops the long axis', () => {
      button('Fill the frame').click();
      fixture.detectChanges();

      // 800/1000 is the larger of the two ratios.
      expect(scale()).toBeCloseTo(0.8, 5);
      expect(button('Fill the frame').getAttribute('aria-pressed')).toBe('true');
    });

    it('show the image pixel for pixel at 100%', () => {
      button('Actual size (100%)').click();
      fixture.detectChanges();

      expect(scale()).toBe(1);
      expect(zoomLabel()).toBe('100%');
    });

    it('step in and out by a fixed ratio', () => {
      button('Actual size (100%)').click();
      fixture.detectChanges();

      button('Zoom in').click();
      fixture.detectChanges();
      expect(scale()).toBeCloseTo(1.25, 5);

      button('Zoom out').click();
      fixture.detectChanges();
      expect(scale()).toBeCloseTo(1, 5);
      // Back at 100% by arithmetic, but no longer a *fit*.
      expect(button('Actual size (100%)').getAttribute('aria-pressed')).toBeNull();
    });
  });

  describe('the wheel', () => {
    it('zooms in on a scroll up and out on a scroll down', () => {
      const fit = scale();

      wheel(-200);
      const zoomedIn = scale();
      expect(zoomedIn).toBeGreaterThan(fit);

      wheel(200);
      expect(scale()).toBeLessThan(zoomedIn);
    });

    it('claims the event, so the panel does not scroll behind it', () => {
      const event = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
      viewport().dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    });

    /** Zooming at a corner must not recentre the picture on that corner. */
    it('holds the point under the pointer still', () => {
      button('Actual size (100%)').click();
      fixture.detectChanges();

      // The centre is anchored: zooming there moves nothing.
      wheel(-100, { x: 400, y: 200 });
      expect(translate()).toEqual({ x: 0, y: 0 });

      button('Actual size (100%)').click();
      fixture.detectChanges();
      // Off-centre: the pan has to shift to keep that pixel in place.
      wheel(-100, { x: 700, y: 350 });
      expect(translate().x).toBeLessThan(0);
      expect(translate().y).toBeLessThan(0);
    });
  });

  describe('dragging', () => {
    it('pans a zoomed image', () => {
      button('Actual size (100%)').click();
      fixture.detectChanges();

      drag({ x: 400, y: 200 }, { x: 340, y: 160 });

      expect(translate()).toEqual({ x: -60, y: -40 });
    });

    /** Nothing to pan: an image that fits stays centred however far it is dragged. */
    it('does nothing while the whole image is visible', () => {
      drag({ x: 400, y: 200 }, { x: 100, y: 100 });

      expect(translate()).toEqual({ x: 0, y: 0 });
    });

    /** Otherwise a hard drag would fling the picture off the screen. */
    it('cannot push the image out of the viewport', () => {
      button('Actual size (100%)').click();
      fixture.detectChanges();

      drag({ x: 400, y: 200 }, { x: 4000, y: 4000 });

      // 1000px image in an 800x400 frame: at most 100px and 300px of slack.
      expect(translate()).toEqual({ x: 100, y: 300 });
    });
  });

  it('returns to contain on a double click', () => {
    button('Actual size (100%)').click();
    fixture.detectChanges();
    drag({ x: 400, y: 200 }, { x: 300, y: 150 });
    expect(scale()).toBe(1);

    viewport().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();

    expect(scale()).toBeCloseTo(0.4, 5);
    expect(translate()).toEqual({ x: 0, y: 0 });
    expect(button('Fit whole image').getAttribute('aria-pressed')).toBe('true');
  });

  /** A panel asked to focus its body needs something here to focus (§6.3). */
  it('offers the viewport as the body tab stop', () => {
    expect(viewport().getAttribute('tabindex')).toBe('0');
  });
});
