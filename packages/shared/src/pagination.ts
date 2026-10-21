import { z } from "zod";

export const MAX_PAGE_SIZE = 50;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int(),
  });
}

export type Paginated<T> = {
  items: T[];
  page: number;
  page_size: number;
  total: number;
};
