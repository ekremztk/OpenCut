import { create } from "zustand";

/**
 * Stores metadata passed from the Prognot dashboard when opening a clip
 * in the editor. Used by the reframe engine to fetch diarization data.
 */
interface ReframeMetadataStore {
	jobId: string | null;
	setJobId: (id: string | null) => void;
}

export const useReframeMetadataStore = create<ReframeMetadataStore>((set) => ({
	jobId: null,
	setJobId: (id) => set({ jobId: id }),
}));
