import { create } from "zustand";

interface YouTubeData {
	title: string;
	description: string;
}

interface YouTubeStore {
	title: string;
	description: string;
	currentProjectId: string | null;
	setTitle: (title: string) => void;
	setDescription: (description: string) => void;
	loadForProject: (projectId: string, defaults?: Partial<YouTubeData>) => void;
	saveForProject: (projectId: string) => void;
}

function storageKey(projectId: string) {
	return `prognot-yt-${projectId}`;
}

function readFromStorage(projectId: string): YouTubeData | null {
	try {
		const raw = localStorage.getItem(storageKey(projectId));
		if (raw) return JSON.parse(raw) as YouTubeData;
	} catch {}
	return null;
}

function writeToStorage(projectId: string, data: YouTubeData) {
	try {
		localStorage.setItem(storageKey(projectId), JSON.stringify(data));
	} catch {}
}

export const useYouTubeStore = create<YouTubeStore>((set, get) => ({
	title: "",
	description: "",
	currentProjectId: null,

	setTitle: (title) => {
		set({ title });
		const { currentProjectId } = get();
		if (currentProjectId) writeToStorage(currentProjectId, { title, description: get().description });
	},

	setDescription: (description) => {
		set({ description });
		const { currentProjectId } = get();
		if (currentProjectId) writeToStorage(currentProjectId, { title: get().title, description });
	},

	loadForProject: (projectId, defaults = {}) => {
		const stored = readFromStorage(projectId);
		set({
			currentProjectId: projectId,
			title: stored?.title ?? defaults.title ?? "",
			description: stored?.description ?? defaults.description ?? "",
		});
	},

	saveForProject: (projectId) => {
		const { title, description } = get();
		writeToStorage(projectId, { title, description });
	},
}));
