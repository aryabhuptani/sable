class CancellationError extends Error {
  constructor(message = "Request cancelled.") {
    super(message);
    this.name = "CancellationError";
  }
}

function isCancellationError(error) {
  return error instanceof CancellationError || error?.name === "CancellationError";
}

function createJobControl(sender) {
  return {
    sender,
    cancelled: false,
    reason: null,
    handlers: new Set(),
  };
}

function registerCancellationHandler(jobControl, handler) {
  if (!jobControl || typeof handler !== "function") {
    return () => {};
  }

  if (jobControl.cancelled) {
    handler(jobControl.reason || new CancellationError());
    return () => {};
  }

  jobControl.handlers.add(handler);
  return () => {
    jobControl.handlers.delete(handler);
  };
}

function cancelJobControl(jobControl, message = "Cancelled by /cancel.", options = {}) {
  if (!jobControl || jobControl.cancelled) {
    return false;
  }

  const logger = options.logger || console;
  const timestamp = options.timestamp || (() => new Date().toISOString());
  const reason = new CancellationError(message);
  jobControl.cancelled = true;
  jobControl.reason = reason;

  for (const handler of [...jobControl.handlers]) {
    try {
      handler(reason);
    } catch (error) {
      logger.error?.(`[${timestamp()}] Cancellation handler failed: ${error.message}`);
    }
  }

  return true;
}

module.exports = {
  CancellationError,
  cancelJobControl,
  createJobControl,
  isCancellationError,
  registerCancellationHandler,
};
