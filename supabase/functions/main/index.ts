console.log("Edge Functions router started");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const serviceName = url.pathname.split("/").filter(Boolean)[0];

  if (!serviceName) {
    return new Response(JSON.stringify({ msg: "missing function name in request" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const servicePath = `/home/deno/functions/${serviceName}`;
  const env = Deno.env.toObject();
  const envVars = Object.entries(env);

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath,
      memoryLimitMb: 150,
      workerTimeoutMs: 60_000,
      noModuleCache: false,
      importMapPath: null,
      envVars,
    });
    return await worker.fetch(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start ${serviceName}:`, message);
    return new Response(JSON.stringify({ msg: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});