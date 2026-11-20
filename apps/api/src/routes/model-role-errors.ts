import { ClientError } from "@anviq/core";

export class ModelCreditOfferingUnavailableError extends ClientError {
  constructor() {
    super(
      "BAD_REQUEST",
      "Selected credit offering is unavailable",
      "MODEL_CREDIT_OFFERING_UNAVAILABLE",
    );
  }
}

export class UnsupportedThinkingLevelError extends ClientError {
  constructor() {
    super("BAD_REQUEST", "Unsupported thinking level", "UNSUPPORTED_THINKING_LEVEL");
  }
}
