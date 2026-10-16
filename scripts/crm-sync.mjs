import { pathToFileURL } from "node:url";

export async function main({ env, fetchFn }) {
  const port = env.PORT || 43177;
  let response;
  try {
    response = await fetchFn(`http://127.0.0.1:${port}/api/crm-sync`, { method: "POST" });
  } catch {
    return { exitCode: 2, output: "Homestead is not reachable. Is it running?\n" };
  }
  if (!response.ok) {
    return {
      exitCode: 2,
      output: `Homestead CRM sync failed with status ${response.status}.\n`,
    };
  }
  const counts = await response.json();
  return {
    exitCode: counts.failed > 0 || counts.ambiguous > 0 ? 1 : 0,
    output: `${JSON.stringify(counts)}\n`,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await main({ env: process.env, fetchFn: fetch });
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
}
