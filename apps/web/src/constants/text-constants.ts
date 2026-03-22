import type { TextElement, TextStroke, TextShadow } from "@/types/timeline";
import {
	DEFAULT_OPACITY,
	DEFAULT_TRANSFORM,
	TIMELINE_CONSTANTS,
} from "./timeline-constants";

export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 300;

/**
 * higher value: smaller font size
 * lower value: larger font size
 */
export const FONT_SIZE_SCALE_REFERENCE = 90;

export const DEFAULT_LETTER_SPACING = 0;
export const DEFAULT_LINE_HEIGHT = 1.2;

export const CORNER_RADIUS_MIN = 0;
export const CORNER_RADIUS_MAX = 100;

export const DEFAULT_TEXT_BACKGROUND = {
	enabled: false,
	color: "#000000",
	cornerRadius: 0,
	paddingX: 30,
	paddingY: 42,
	offsetX: 0,
	offsetY: 0,
};

export const DEFAULT_TEXT_STROKE: TextStroke = {
	enabled: false,
	color: "#000000",
	width: 4,
	outsideOnly: true,
};

export const DEFAULT_TEXT_SHADOW: TextShadow = {
	enabled: false,
	color: "#000000",
	offsetX: 3,
	offsetY: 3,
	blur: 6,
	opacity: 0.8,
};

export const DEFAULT_TEXT_ELEMENT: Omit<TextElement, "id"> = {
	type: "text",
	name: "Text",
	content: "Default text",
	fontSize: 15,
	fontFamily: "Arial",
	color: "#ffffff",
	background: DEFAULT_TEXT_BACKGROUND,
	textAlign: "center",
	fontWeight: "normal",
	fontStyle: "normal",
	textDecoration: "none",
	letterSpacing: DEFAULT_LETTER_SPACING,
	lineHeight: DEFAULT_LINE_HEIGHT,
	duration: TIMELINE_CONSTANTS.DEFAULT_ELEMENT_DURATION,
	startTime: 0,
	trimStart: 0,
	trimEnd: 0,
	transform: DEFAULT_TRANSFORM,
	opacity: DEFAULT_OPACITY,
	stroke: DEFAULT_TEXT_STROKE,
	shadow: DEFAULT_TEXT_SHADOW,
};
