export async function register() {
  // The inline check lets the bundler drop this import from the edge build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundWork } = await import("@/lib/startup");
    await startBackgroundWork();
  }
}
