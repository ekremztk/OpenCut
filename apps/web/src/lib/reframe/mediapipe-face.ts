import {
	FaceLandmarker,
	FilesetResolver,
	type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

export interface DetectedFace {
	/** 0..1 normalized, left=0 right=1. Uses full landmark bbox for head centering. */
	centerX: number;
	/** 0..1 normalized, top=0 bottom=1. */
	centerY: number;
	/** 0..1, higher = mouth more open → speaking */
	mouthOpenRatio: number;
}

let faceLandmarker: FaceLandmarker | null = null;
let loadingPromise: Promise<FaceLandmarker> | null = null;

export async function loadFaceLandmarker(
	onProgress?: (msg: string) => void,
): Promise<FaceLandmarker> {
	if (faceLandmarker) return faceLandmarker;
	if (loadingPromise) return loadingPromise;

	loadingPromise = (async () => {
		onProgress?.("Loading face detection model...");
		const vision = await FilesetResolver.forVisionTasks(
			"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.33/wasm",
		);
		onProgress?.("Initializing face detector...");
		const landmarker = await FaceLandmarker.createFromOptions(vision, {
			baseOptions: {
				modelAssetPath:
					"https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
				delegate: "CPU",
			},
			runningMode: "VIDEO",
			numFaces: 2,
			minFaceDetectionConfidence: 0.5,
			minTrackingConfidence: 0.5,
		});
		faceLandmarker = landmarker;
		return landmarker;
	})();

	return loadingPromise;
}

// Key landmark indices
const UPPER_LIP_IDX = 13;
const LOWER_LIP_IDX = 14;
const NOSE_TIP_IDX = 1;
const CHIN_IDX = 152;

// Face oval boundary landmarks — used for accurate HEAD width (not just face front)
const FACE_OVAL_INDICES = [
	10, 338, 297, 332, 284, 251, 389, 356, 454,
	323, 361, 288, 397, 365, 379, 378, 400, 377,
	152, 148, 176, 149, 150, 136, 172, 58, 132,
	93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export function extractFaces(result: FaceLandmarkerResult): DetectedFace[] {
	const faces: DetectedFace[] = [];

	for (const landmarks of result.faceLandmarks) {
		const upperLip = landmarks[UPPER_LIP_IDX];
		const lowerLip = landmarks[LOWER_LIP_IDX];
		const noseTip = landmarks[NOSE_TIP_IDX];
		const chin = landmarks[CHIN_IDX];

		if (!upperLip || !lowerLip) continue;

		// Head center X: use face oval bounding box.
		// This correctly centers the head even when turned sideways —
		// the oval spans from ear to ear rather than just eye-to-eye.
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;

		for (const idx of FACE_OVAL_INDICES) {
			const lm = landmarks[idx];
			if (!lm) continue;
			if (lm.x < minX) minX = lm.x;
			if (lm.x > maxX) maxX = lm.x;
			if (lm.y < minY) minY = lm.y;
			if (lm.y > maxY) maxY = lm.y;
		}

		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		// Mouth open ratio relative to face height
		const faceHeight = Math.abs(
			(chin?.y ?? lowerLip.y + 0.05) - (noseTip?.y ?? upperLip.y - 0.05),
		);
		const mouthOpen = Math.abs(lowerLip.y - upperLip.y);
		const mouthOpenRatio = faceHeight > 0 ? mouthOpen / faceHeight : 0;

		faces.push({ centerX, centerY, mouthOpenRatio });
	}

	return faces;
}

export async function detectFacesInFrame(
	landmarker: FaceLandmarker,
	video: HTMLVideoElement,
	timestampMs: number,
): Promise<DetectedFace[]> {
	const result = landmarker.detectForVideo(video, timestampMs);
	return extractFaces(result);
}
