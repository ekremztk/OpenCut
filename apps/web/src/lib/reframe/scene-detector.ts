// Pixel-based scene change detection using downscaled frame comparison.
// Draws each video frame into a tiny canvas and computes average channel diff.

const COMPARE_WIDTH = 80;
const COMPARE_HEIGHT = 45;

// Average per-channel pixel difference (0–255) that triggers a scene cut.
// 25 catches hard cuts, ignores gradual lighting/motion.
const SCENE_CUT_THRESHOLD = 25;

// Minimum gap between two scene cuts (seconds) to avoid micro-cuts.
const MIN_CUT_GAP_S = 0.5;

export interface SceneCutResult {
	/** Element-local time (seconds) of detected scene cuts. */
	cutTimesS: number[];
}

export class SceneDetector {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private prevData: Uint8ClampedArray | null = null;

	constructor() {
		this.canvas = document.createElement("canvas");
		this.canvas.width = COMPARE_WIDTH;
		this.canvas.height = COMPARE_HEIGHT;
		this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;
	}

	/** Call once per frame. Returns true if this frame starts a new scene. */
	check(video: HTMLVideoElement): boolean {
		this.ctx.drawImage(video, 0, 0, COMPARE_WIDTH, COMPARE_HEIGHT);
		const curr = this.ctx.getImageData(0, 0, COMPARE_WIDTH, COMPARE_HEIGHT).data;

		if (!this.prevData) {
			this.prevData = new Uint8ClampedArray(curr);
			return false;
		}

		let totalDiff = 0;
		const len = curr.length;
		for (let i = 0; i < len; i += 4) {
			totalDiff += Math.abs(curr[i] - this.prevData[i]);
			totalDiff += Math.abs(curr[i + 1] - this.prevData[i + 1]);
			totalDiff += Math.abs(curr[i + 2] - this.prevData[i + 2]);
		}

		this.prevData.set(curr);

		const pixels = len / 4;
		const avgDiff = totalDiff / (pixels * 3);
		return avgDiff > SCENE_CUT_THRESHOLD;
	}

	reset() {
		this.prevData = null;
	}
}

/** Remove cuts too close to each other or to the clip boundaries. */
export function filterCuts(
	rawCuts: number[],
	totalDuration: number,
): number[] {
	const filtered: number[] = [];
	let lastCut = -MIN_CUT_GAP_S;

	for (const t of rawCuts) {
		if (
			t - lastCut >= MIN_CUT_GAP_S &&
			t >= MIN_CUT_GAP_S &&
			t <= totalDuration - MIN_CUT_GAP_S
		) {
			filtered.push(t);
			lastCut = t;
		}
	}
	return filtered;
}
