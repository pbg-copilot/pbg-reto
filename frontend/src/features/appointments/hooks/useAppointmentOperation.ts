import { useRef, useState } from "react";
import type { AppointmentMutationResult } from "../../../shared/types/domain";
import type { PendingAppointment } from "./appointment-workflow-types";

/** One confirmation and write state shared by chat and the manual editor. */
export function useAppointmentOperation() {
  const [appointmentError, setAppointmentError] = useState("");
  const [appointmentConflict, setAppointmentConflict] = useState(false);
  const [appointmentBusy, setAppointmentBusy] = useState(false);
  const [pendingAppointment, setPendingAppointment] = useState<PendingAppointment>(null);
  const [appointmentResult, setAppointmentResult] = useState<AppointmentMutationResult | null>(null);
  const appointmentRequest = useRef(0);

  function invalidateReview() {
    appointmentRequest.current += 1;
    setPendingAppointment(null); setAppointmentResult(null); setAppointmentError(""); setAppointmentConflict(false);
  }

  function reset() { invalidateReview(); setAppointmentBusy(false); }

  return {
    appointmentError, setAppointmentError, appointmentConflict, setAppointmentConflict,
    appointmentBusy, setAppointmentBusy, pendingAppointment, setPendingAppointment,
    appointmentResult, setAppointmentResult, appointmentRequest, invalidateReview, reset,
  };
}

export type AppointmentOperation = ReturnType<typeof useAppointmentOperation>;
