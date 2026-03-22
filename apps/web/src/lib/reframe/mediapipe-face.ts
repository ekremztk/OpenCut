import {
	FaceLandmarker,
	FilesetResolver,
	type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";

export interface DetectedFace {
	/** 0..1 normalized, left=0 right=1. Computed from face oval bounding box. */
	centerX: number;
	/** 0..1 normalized, top=0 bottom=1. */
	centerY: number;
	/** 0..1, higher = mouth more open → likely speaking */
	mouthOpenRatio: number;
	/**
	 * Normalized width of the face oval bounding box.
	 * Larger = face is closer to the camera (useful for dominant-face detection).
	 */
	bboxWidth: number;
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

// Mouth landmarks
const UPPER_LIP_IDX = 13;
const LOWER_LIP_IDX = 14;
const NOSE_TIP_IDX = 1;
const CHIN_IDX = 152;

/**
 * Face oval contour landmarks (36 points, official MediaPipe set).
 * Spans from ear to ear — gives accurate head WIDTH even when face is turned sideways.
 * Landmark 234 ≈ right ear, 454 ≈ left ear.
 */
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

		// Head center: bounding box of face oval landmarks
		// This works correctly whether the face is frontal or turned sideways
		let minX = Infinity, maxX = -Infinity;
		let minY = Infinity, maxY = -Infinity;

		for (const idx of FACE_OVAL_INDICES) {
			const lm = landmarks[idx];
			if (!lm) continue;
			if (lm.x < minX) minX = lm.x;
			if (lm.x > maxX) maxX = lm.x;
			if (lm.y < minY) minY = lm.y;
			if (lm.y > maxY) maxY = lm.y;
		}

		if (!isFinite(minX)) continue;

		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;
		const bboxWidth = maxX - minX;

		// Mouth open ratio relative to face height (nose tip → chin)
		const faceH = Math.abs(
			(chin?.y ?? lowerLip.y + 0.05) - (noseTip?.y ?? upperLip.y - 0.05),
		);
		const mouthOpen = Math.abs(lowerLip.y - upperLip.y);
		const mouthOpenRatio = faceH > 0 ? mouthOpen / faceH : 0;

		faces.push({ centerX, centerY, mouthOpenRatio, bboxWidth });
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
