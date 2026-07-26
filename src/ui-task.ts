export function runUiTask(
  task: () => Promise<unknown>,
  onFailure: (error: unknown) => void,
): void {
  const handleFailure = (error: unknown): void => {
    try {
      onFailure(error);
    } catch {
      // A UI error boundary must never create a second unhandled error.
    }
  };
  try {
    void task().catch(handleFailure);
  } catch (error) {
    handleFailure(error);
  }
}
