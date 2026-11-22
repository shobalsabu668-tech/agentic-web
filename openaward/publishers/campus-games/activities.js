export const ACTIVITIES = [
  { id: "quick-cards", title: "Quick card-table round", description: "Learn a fast, friendly card game. No experience or team needed.", duration: 20, cost: 0, moods: ["meet"], setting: "Student lounge" },
  { id: "co-op-puzzle", title: "Co-op puzzle sprint", description: "Work together on a small puzzle and see how far you get in twenty minutes.", duration: 20, cost: 0, moods: ["meet", "make"], setting: "Student lounge" },
  { id: "photo-bingo", title: "Photo scavenger sprint", description: "Pick a bingo card of campus details and find a few before the timer ends.", duration: 20, cost: 0, moods: ["move", "make"], setting: "Around campus" },
  { id: "courtyard-walk", title: "Courtyard micro-walk", description: "Take a short reset walk with a playful look-and-notice challenge.", duration: 15, cost: 0, moods: ["move", "meet"], setting: "Around campus" },
  { id: "campus-trivia", title: "Campus trivia dash", description: "Trade quick campus-themed questions in a short, friendly team round.", duration: 15, cost: 2, moods: ["meet", "move"], setting: "Student lounge" },
  { id: "puzzle-snack", title: "Puzzle and snack break", description: "Solve a small co-op puzzle with a simple snack to share.", duration: 20, cost: 4, moods: ["meet", "make"], setting: "Student lounge" },
  { id: "photo-challenge", title: "Photo challenge cards", description: "Pick a playful photo challenge and see what you can find around campus.", duration: 20, cost: 3, moods: ["move", "make"], setting: "Around campus" },
  { id: "mystery-round", title: "Mini mystery team round", description: "Solve a short clue-based mystery together in a student lounge.", duration: 25, cost: 6, moods: ["meet", "make"], setting: "Student lounge" },
  { id: "trail-challenge", title: "Trail challenge with a drink", description: "Follow a quick campus trail challenge, with a drink for the walk.", duration: 25, cost: 5, moods: ["move", "meet"], setting: "Around campus" },
];

export function getActivities() {
  return { source: "Campus Games", updated: "Demo listings", activities: ACTIVITIES.map((item) => ({ ...item, moods: [...item.moods] })) };
}
