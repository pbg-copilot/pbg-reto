import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Attachment, ChatAttachment, RemoveAttachmentBody, UploadResponse } from "@reto/shared";
import { api, apiUpload } from "@/lib/api";
import { ticketKeys } from "@/features/tickets/api";

export const downloadUrl = (path: string, inline = false) => `/api${path}${inline ? "?inline=1" : ""}`;

// Subida a un ticket con progreso (0–1). Al terminar se refresca el detalle (lista y eventos).
export function useUploadTicketAttachments(ticketId: string) {
  const client = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: ({ files, fields, idempotencyKey }: { files: File[]; fields?: Record<string, string>; idempotencyKey: string }) =>
      apiUpload<UploadResponse>(`/tickets/${ticketId}/attachments`, files, { fields, idempotencyKey, onProgress: setProgress }),
    onSettled: () => {
      setProgress(null);
      void client.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) });
    },
  });
  return { ...mutation, progress };
}

export function useRemoveAttachment(ticketId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RemoveAttachmentBody }) => api<Attachment>(`/attachments/${id}`, { method: "DELETE", body }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ticketKeys.detail(ticketId) }),
  });
}

export function uploadChatAttachments(conversationId: string, files: File[], idempotencyKey: string, onProgress?: (value: number) => void) {
  return apiUpload<{ attachments: ChatAttachment[] }>(`/support/conversations/${conversationId}/attachments`, files, { idempotencyKey, onProgress });
}
