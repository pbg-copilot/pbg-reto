import type { Handlers } from "./runner.js";

// Registro tipo → handler. Las specs 005 (correo) y siguientes agregan los suyos.
export const jobHandlers: Handlers = {
  noop: { run: async () => {} },
};
