import { createContext } from "react";

export type RegisterNotificationClose = (button: HTMLButtonElement) => () => void;

// A notification registers its rendered close control, rather than its presence
// being inferred from a React element that may render nothing.
export const WorkspaceNotificationContext = createContext<RegisterNotificationClose | null>(null);
