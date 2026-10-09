const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|[@-_])/g;

export function parsePreviewPort(output: string): number | undefined {
  const plainOutput = output.replace(ANSI_ESCAPE, '');
  const match = plainOutput.match(/Local:\s+https?:\/\/127\.0\.0\.1:(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}
