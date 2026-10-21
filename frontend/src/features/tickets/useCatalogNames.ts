import { useMemo } from "react";
import { useCategories, usePriorities } from "./api";

// Traduce códigos de categoría y prioridad a sus nombres en español.
export function useCatalogNames() {
  const categories = useCategories();
  const priorities = usePriorities();
  return useMemo(() => {
    const categoryNames = new Map((categories.data ?? []).map((c) => [c.code, c.name]));
    const priorityNames = new Map((priorities.data ?? []).map((p) => [p.code, p.name]));
    return {
      categories: categories.data ?? [],
      priorities: priorities.data ?? [],
      categoryName: (code: string) => categoryNames.get(code) ?? code,
      priorityName: (code: string) => priorityNames.get(code) ?? code,
    };
  }, [categories.data, priorities.data]);
}
