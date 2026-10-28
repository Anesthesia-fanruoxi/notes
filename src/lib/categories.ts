import type { Category } from "./types";

export interface FlatCategory {
  category: Category;
  depth: number;
}

/** 深度优先拍平分类树，供下拉与侧栏渲染使用。 */
export function flattenCategories(categories: Category[]): FlatCategory[] {
  const result: FlatCategory[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = categories
      .filter((item) => item.parentId === parentId)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    for (const category of children) {
      result.push({ category, depth });
      walk(category.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

export function isDescendant(
  categories: Category[],
  candidate: string,
  ancestor: string,
): boolean {
  let current = categories.find((item) => item.id === candidate)?.parentId ?? null;
  while (current) {
    if (current === ancestor) return true;
    current = categories.find((item) => item.id === current)?.parentId ?? null;
  }
  return false;
}
