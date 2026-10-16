export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startRoutineTicker } = await import("@/lib/routines");
    startRoutineTicker();
    try {
      const { resumeOutboxRunOnBoot } = await import("@/lib/outbox-bot");
      await resumeOutboxRunOnBoot();
    } catch (error) {
      console.error("Outbox run resume failed:", error);
    }
  }
}
