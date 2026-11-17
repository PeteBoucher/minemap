// Biome colours and how hard each biome is to cross. Ported from the prototype.
import type { PaceKey } from "./travel";

export const BIOMES: Record<string, string> = {
  plains: "#7fb24a", forest: "#3f8a3a", birch_forest: "#6fa860", dark_forest: "#2a5a2a", taiga: "#2f6f5a",
  jungle: "#4fa81f", swamp: "#5a6f3a", savanna: "#b5a84a", desert: "#e0c070", badlands: "#c8743a",
  beach: "#e8cf5a", stony_shore: "#9a9a86", windswept_hills: "#7d8a6a", stony_peaks: "#8a8a8a",
  snowy_plains: "#e3e5f2", snowy_slopes: "#9fb8d8", snowy_taiga: "#4f8f86", frozen_river: "#6fa8e8",
  river: "#4f90e0", ocean: "#3f76c4", cherry_grove: "#f0a0c8", mushroom_fields: "#b070b0",
  dappled_forest: "#f08c2e", bamboo_jungle: "#4f8f5a", lush_caves: "#4f8f5a", dripstone_caves: "#6f6f5a",
  pale_garden: "#c0c0e0",
};

export const biomeCol = (b: string): string => BIOMES[b] ?? "#888888";

/** Which travel pace each biome counts as when pace is "auto". Unlisted biomes use UNKNOWN_PACE. */
export const BIOME_PACE: Record<string, PaceKey> = {
  plains: "open", snowy_plains: "open", savanna: "open", desert: "open", beach: "open", frozen_river: "open",
  mushroom_fields: "open",
  forest: "mixed", birch_forest: "mixed", taiga: "mixed", snowy_taiga: "mixed", stony_shore: "mixed",
  cherry_grove: "mixed", river: "mixed", dappled_forest: "mixed",
  jungle: "rough", bamboo_jungle: "rough", dark_forest: "rough", pale_garden: "rough", swamp: "rough",
  windswept_hills: "rough", stony_peaks: "rough", snowy_slopes: "rough", badlands: "rough", lush_caves: "rough",
  dripstone_caves: "rough",
  ocean: "boat",
};
