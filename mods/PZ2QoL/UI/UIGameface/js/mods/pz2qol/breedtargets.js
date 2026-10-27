// From the game's animals.fdb and its wildlife reserves' release groups (Steam build 26106647); a game
// update that changes a species' lifecycle, mating or reserves wants these rows refreshed.
// Habitat species a reserve releases, not fish, whose male takes more than one mate, living 25+ years
// and rated hard to breed by the game (BreedingScore 0.3 or less). Years are game years; litter is the average;
// releaseAnimals: the animals one release of each of its group types takes; reserves: how many release it.
export const BREED_TARGETS = Object.freeze([
    Object.freeze({"id": "Elephant_Indian", "lifespan": 62.5, "mature": 11.0, "gestation": 1.83, "interBirth": 8.0, "litter": 1.0, "breedingScore": 0.06, "reserves": 1, "releaseAnimals": 9}),
    Object.freeze({"id": "Elephant_AfricanSavannah", "lifespan": 73.0, "mature": 10.0, "gestation": 1.83, "interBirth": 9.0, "litter": 1.0, "breedingScore": 0.07, "reserves": 2, "releaseAnimals": 5}),
    Object.freeze({"id": "Orangutan_Sumatran", "lifespan": 51.0, "mature": 10.0, "gestation": 0.73, "interBirth": 8.72, "litter": 1.0, "breedingScore": 0.08, "reserves": 1, "releaseAnimals": 2}),
    Object.freeze({"id": "Rhinoceros_Black", "lifespan": 37.5, "mature": 7.0, "gestation": 1.25, "interBirth": 0.75, "litter": 1.0, "breedingScore": 0.14, "reserves": 2, "releaseAnimals": 4}),
    Object.freeze({"id": "Hippopotamus_Common", "lifespan": 47.5, "mature": 7.0, "gestation": 0.667, "interBirth": 1.333, "litter": 1.0, "breedingScore": 0.16, "reserves": 2, "releaseAnimals": 8}),
    Object.freeze({"id": "Crocodile_Saltwater", "lifespan": 92.0, "mature": 14.0, "gestation": 0.083, "interBirth": 0.917, "litter": 2.5, "breedingScore": 0.17, "reserves": 1, "releaseAnimals": 2}),
    Object.freeze({"id": "Giraffe_Masai", "lifespan": 31.0, "mature": 4.0, "gestation": 1.18, "interBirth": 1.82, "litter": 1.0, "breedingScore": 0.19, "reserves": 2, "releaseAnimals": 14}),
    Object.freeze({"id": "Giraffe_Reticulated", "lifespan": 27.5, "mature": 4.0, "gestation": 1.18, "interBirth": 1.82, "litter": 1.0, "breedingScore": 0.2, "reserves": 2, "releaseAnimals": 14}),
    Object.freeze({"id": "Bear_Sun", "lifespan": 27.5, "mature": 4.0, "gestation": 0.57, "interBirth": 2.43, "litter": 2.0, "breedingScore": 0.23, "reserves": 1, "releaseAnimals": 2}),
    Object.freeze({"id": "Zebra_Plains", "lifespan": 30.0, "mature": 4.0, "gestation": 1.083, "interBirth": 0.917, "litter": 1.0, "breedingScore": 0.28, "reserves": 2, "releaseAnimals": 7}),
]);
