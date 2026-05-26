export function actionLabel(name: string | undefined): string {
  switch (name) {
    case "pokemon_navigate": return "이동";
    case "pokemon_interact": return "상호작용";
    case "pokemon_wait": return "대기";
    case "pokemon_battle": return "전투";
    case "pokemon_dialog": return "대화";
    case "pokemon_memory_read": return "기록 읽기";
    case "pokemon_memory_write": return "기록 추가";
    default:
      if (name === undefined) return "대기";
      return name.startsWith("pokemon_") ? "내부 기록" : name;
  }
}
