import type { AppointmentWorkflowOptions } from "./appointment-workflow-types";
import { useAppointmentOperation } from "./useAppointmentOperation";
import { useAppointmentList } from "./useAppointmentList";
import { useAppointmentForm } from "./useAppointmentForm";
import { useAppointmentChat } from "./useAppointmentChat";

/** Composes the manual and chat workflows around one shared confirmation. */
export function useAppointmentWorkflow(options: AppointmentWorkflowOptions) {
  const isCurrent = (conversationId: string, requestId: number) =>
    requestId === options.contextRequest.current && conversationId === options.activeConversationRef.current;
  const operation = useAppointmentOperation();
  const list = useAppointmentList(options, isCurrent);
  const form = useAppointmentForm(options, operation, list.appointments, list.loadAppointments, isCurrent);
  const chat = useAppointmentChat(options, operation, list.loadAppointments, isCurrent);

  const { reset: resetOperation, appointmentRequest: _appointmentRequest, ...operationState } = operation;
  const { reset: resetList, ...listState } = list;
  const { reset: resetForm, ...formState } = form;
  const { reset: resetChat, ...chatState } = chat;
  function reset() { resetOperation(); resetList(); resetForm(); resetChat(); }
  return { ...listState, ...operationState, ...formState, ...chatState, reset };
}
