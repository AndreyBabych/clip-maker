export type Profile = {
  id: string;
  name: string;
  description: string;
  appearance: string;
  clothing: string;
  notes: string;
  variants: { name: string; description: string }[];
  approved: boolean;
  assetId: string | null;
};
export type Scene = {
  id: string;
  title: string;
  start: number;
  end: number;
  description: string;
  prompt: string;
  videoPrompt: string;
  framing: string;
  movement: string;
  characterIds: string[];
  locationId: string | null;
  approved: boolean;
  imageId: string | null;
  videoId: string | null;
};
export type Doc = {
  title: string;
  idea: string;
  lyrics: string;
  concept: string;
  conceptApproved: boolean;
  storyboardApproved: boolean;
  stylePrompt: string;
  styleId: string | null;
  audioId: string | null;
  ratio: string;
  resolution: string;
  fps: number;
  budget: number | null;
  paused: boolean;
  archived: boolean;
  scenes: Scene[];
  characters: Profile[];
  locations: Profile[];
  beats: number[];
  sections: { name: string; start: number; end: number }[];
};
export type Project = {
  id: string;
  revision: number;
  updated_at: string;
  document: Doc;
};
export type Asset = {
  id: string;
  project_id: string;
  target_id: string;
  kind: string;
  source: string;
  state: string;
  name: string;
  mime: string;
  bytes: number;
  created_at: string;
  metadata: {
    duration?: number;
    waveform?: number[];
    prompt?: string;
    error?: string;
  };
  demoUrl?: string;
};
export type Job = {
  id: string;
  target_id: string;
  kind: string;
  state: string;
  provider: string;
  model: string;
  attempts: number;
  estimated: number | null;
  confirmed: number | null;
  error: string | null;
  external_id: string | null;
  result?: {
    assetId?: string;
    draft?: { concept: string; scenes: Partial<Scene>[] };
  };
  created_at: string;
  prompt?: string;
};
export type Detail = Project & {
  assets: Asset[];
  jobs: Job[];
  statuses: Record<string, string>;
};
export type Config = {
  storage: string;
  fal: boolean;
  screenplay: boolean;
  local: boolean;
  models: Record<string, { name: string; min?: number; max?: number }>;
};
export type Quote = {
  id: string;
  estimated: number | null;
  pricingSource: string;
  count: number;
  models: string[];
};
export const empty = (): Doc => ({
  title: "Новый клип",
  idea: "",
  lyrics: "",
  concept: "",
  conceptApproved: false,
  storyboardApproved: false,
  stylePrompt: "",
  styleId: null,
  audioId: null,
  ratio: "16:9",
  resolution: "1080p",
  fps: 25,
  budget: null,
  paused: false,
  archived: false,
  scenes: [],
  characters: [],
  locations: [],
  beats: [],
  sections: [],
});
export const newScene = (start = 0): Scene => ({
  id: crypto.randomUUID(),
  title: "Новая сцена",
  start,
  end: start + 5,
  description: "",
  prompt: "",
  videoPrompt: "",
  framing: "",
  movement: "",
  characterIds: [],
  locationId: null,
  approved: false,
  imageId: null,
  videoId: null,
});
export const newProfile = (): Profile => ({
  id: crypto.randomUUID(),
  name: "Новый образ",
  description: "",
  appearance: "",
  clothing: "",
  notes: "",
  variants: [],
  approved: false,
  assetId: null,
});
